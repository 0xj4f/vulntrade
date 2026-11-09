package com.vulntrade.service;

import com.vulntrade.model.Order;
import com.vulntrade.model.Symbol;
import com.vulntrade.model.User;
import com.vulntrade.repository.OrderRepository;
import com.vulntrade.repository.PositionRepository;
import com.vulntrade.repository.SymbolRepository;
import com.vulntrade.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.*;

/**
 * The house as a market maker. One pass per second, per symbol, under the matching lock:
 * <ol>
 *   <li><b>Sweep</b> — resting user LIMIT orders that the live quote now crosses
 *       (BUY ≥ ask, SELL ≤ bid) are filled against the house at their limit price.
 *       Without this, a limit order only fills when another order arrives.</li>
 *   <li><b>Re-quote</b> (every 10th pass) — the house's ladder (5 levels a side, tagged
 *       {@code HOUSE-MM-<symbol>-<side>-<level>}) is re-priced in place around the live quote,
 *       so the book follows the price instead of going stale. Missing levels (filled, or
 *       cancelled by someone through the IDOR) are replaced with new tagged orders.</li>
 * </ol>
 * VULN is left alone (no re-quote): its predictable sine price and the static house ladder
 * seeded for it are part of the predictable-price lesson. Halted symbols are skipped.
 */
@Service
public class HouseMarketMakerService {

    private static final Logger logger = LoggerFactory.getLogger(HouseMarketMakerService.class);

    static final String TAG_PREFIX = "HOUSE-MM-";
    private static final int LEVELS = 5;
    private static final BigDecimal STEP = new BigDecimal("0.0005");          // 5 bps between levels
    private static final BigDecimal LEVEL_SHARE_OF_POSITION = new BigDecimal("0.02");
    private static final BigDecimal LEVEL_SHARE_OF_CASH = new BigDecimal("0.002");
    private static final int REQUOTE_EVERY_PASSES = 2;
    private static final Set<String> NOT_QUOTED = Set.of("VULN");

    private final SymbolRepository symbolRepository;
    private final OrderRepository orderRepository;
    private final PositionRepository positionRepository;
    private final UserRepository userRepository;
    private final LiquidityProviderService liquidityProvider;
    private final MatchingEngineService matchingEngine;
    private final MatchingCoordinator coordinator;
    private final PriceSimulatorService priceSimulator;
    private final TradingEvents events;

    private long pass = 0;
    private volatile boolean ready = false;

    public HouseMarketMakerService(SymbolRepository symbolRepository,
                                   OrderRepository orderRepository,
                                   PositionRepository positionRepository,
                                   UserRepository userRepository,
                                   LiquidityProviderService liquidityProvider,
                                   MatchingEngineService matchingEngine,
                                   MatchingCoordinator coordinator,
                                   PriceSimulatorService priceSimulator,
                                   TradingEvents events) {
        this.symbolRepository = symbolRepository;
        this.orderRepository = orderRepository;
        this.positionRepository = positionRepository;
        this.userRepository = userRepository;
        this.liquidityProvider = liquidityProvider;
        this.matchingEngine = matchingEngine;
        this.coordinator = coordinator;
        this.priceSimulator = priceSimulator;
        this.events = events;
    }

    /** Startup: check the house account and clear MARKET orders left resting by older builds. */
    @EventListener(ApplicationReadyEvent.class)
    public void reconcile() {
        Long houseId = liquidityProvider.getHouseUserId();
        Optional<User> house = userRepository.findById(houseId);
        if (house.isEmpty() || !"ADMIN".equalsIgnoreCase(house.get().getRole())) {
            logger.warn("House account (user {}) is missing or not ADMIN — market making may misbehave", houseId);
        }
        try {
            coordinator.run(() -> {
                for (Order o : orderRepository.findRestingMarketOrders()) {
                    if (Objects.equals(o.getUserId(), houseId)) {
                        o.setStatus("CANCELLED");
                        o.setStatusReason(MatchingEngineService.NO_LIQUIDITY);
                        orderRepository.save(o);
                        events.bookChanged(o.getSymbol());
                    } else {
                        matchingEngine.cancelForReason(o, MatchingEngineService.NO_LIQUIDITY);
                    }
                }
            });
        } catch (Exception e) {
            logger.warn("Startup reconcile failed: {}", e.getMessage());
        }
        ready = true;
    }

    @Scheduled(fixedDelay = 1000, initialDelay = 3000)
    public void run() {
        if (!ready || !liquidityProvider.isEnabled()) return;
        boolean requote = pass++ % REQUOTE_EVERY_PASSES == 0;
        for (Symbol listed : symbolRepository.findAll()) {
            String symbol = listed.getSymbol();
            if (priceSimulator.isHalted(symbol) || "FX".equals(listed.getAssetClass())) continue;  // FX: fx-internals
            try {
                coordinator.run(() -> {
                    Symbol sym = symbolRepository.findById(symbol).orElse(null);
                    if (sym == null || !Boolean.TRUE.equals(sym.getIsTradable())) return;
                    matchingEngine.sweepCrossedLimits(sym);
                    if (!NOT_QUOTED.contains(symbol)) {
                        requote(sym, requote);
                    }
                });
            } catch (Exception e) {
                logger.warn("Market-maker pass failed for {}: {}", symbol, e.getMessage());
            }
        }
    }

    /**
     * Re-price the house ladder of one symbol around its live quote — on the regular cadence,
     * or right away when the ladder is "through" the live quote (a bid above where the house
     * would buy, or an ask below where it would sell — e.g. after a manual price change), so
     * stale quotes don't sit in the book.
     */
    private void requote(Symbol sym, boolean scheduled) {
        Long houseId = liquidityProvider.getHouseUserId();
        BigDecimal bestAsk = liquidityProvider.fillPrice(sym, "BUY");   // house sells here
        BigDecimal bestBid = liquidityProvider.fillPrice(sym, "SELL");  // house buys here
        if (bestAsk == null || bestBid == null) return;

        BigDecimal held = positionRepository.findQuantity(houseId, sym.getSymbol());
        BigDecimal cash = userRepository.findBalanceById(houseId);
        held = held != null ? held : BigDecimal.ZERO;
        cash = cash != null ? cash : BigDecimal.ZERO;

        List<Order> quotes = orderRepository.findOpenHouseQuotes(houseId, sym.getSymbol());
        if (!scheduled && !quotes.isEmpty()) {
            boolean stale = quotes.stream().anyMatch(o -> o.getPrice() != null && ("BUY".equals(o.getSide())
                    ? o.getPrice().compareTo(bestBid) > 0
                    : o.getPrice().compareTo(bestAsk) < 0));
            if (!stale) return;
        }

        Map<String, Order> existing = new HashMap<>();
        List<Order> duplicates = new ArrayList<>();
        for (Order o : quotes) {
            if (existing.putIfAbsent(o.getClientOrderId(), o) != null) duplicates.add(o);
        }

        int priceScale = bestBid.compareTo(BigDecimal.ONE) >= 0 ? 2 : 8;
        BigDecimal minTick = BigDecimal.ONE.movePointLeft(priceScale);
        BigDecimal step = bestAsk.multiply(STEP).max(minTick);
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);
        boolean changed = false;

        for (int level = 0; level < LEVELS; level++) {
            BigDecimal offset = step.multiply(BigDecimal.valueOf(level));
            BigDecimal askPrice = bestAsk.add(offset).setScale(priceScale, RoundingMode.CEILING);
            BigDecimal bidPrice = bestBid.subtract(offset).setScale(priceScale, RoundingMode.FLOOR);

            BigDecimal askQty = roundQty(held.multiply(LEVEL_SHARE_OF_POSITION), askPrice);
            BigDecimal bidQty = bidPrice.signum() > 0
                    ? roundQty(askQty.min(cash.multiply(LEVEL_SHARE_OF_CASH).divide(bidPrice, 8, RoundingMode.DOWN)), bidPrice)
                    : BigDecimal.ZERO;

            changed |= quote(sym.getSymbol(), "SELL", level, askPrice, askQty, existing, now);
            if (bidPrice.signum() > 0) {
                changed |= quote(sym.getSymbol(), "BUY", level, bidPrice, bidQty, existing, now);
            }
        }
        // Anything left in `existing` is a tag we no longer quote; close it, and any duplicates.
        for (Order stale : existing.values()) duplicates.add(stale);
        for (Order o : duplicates) {
            o.setStatus("CANCELLED");
            orderRepository.save(o);
            changed = true;
        }
        if (changed) events.bookChanged(sym.getSymbol());
    }

    /** Re-price one ladder level in place, or create it. Returns true if the book changed. */
    private boolean quote(String symbol, String side, int level, BigDecimal price, BigDecimal qty,
                          Map<String, Order> existing, LocalDateTime now) {
        String tag = TAG_PREFIX + symbol + "-" + side + "-" + level;
        Order o = existing.remove(tag);
        if (qty.signum() <= 0) {
            if (o != null) {
                o.setStatus("CANCELLED");
                orderRepository.save(o);
                return true;
            }
            return false;
        }
        if (o == null) {
            o = new Order();
            o.setUserId(liquidityProvider.getHouseUserId());
            o.setSymbol(symbol);
            o.setSide(side);
            o.setOrderType("LIMIT");
            o.setStatus("NEW");
            o.setFilledQty(BigDecimal.ZERO);
            o.setClientOrderId(tag);
        } else {
            BigDecimal filled = o.getFilledQty() != null ? o.getFilledQty() : BigDecimal.ZERO;
            BigDecimal remaining = o.getQuantity().subtract(filled);
            if (o.getPrice() != null && o.getPrice().compareTo(price) == 0 && remaining.compareTo(qty) == 0) {
                return false;   // already where it should be
            }
        }
        BigDecimal filled = o.getFilledQty() != null ? o.getFilledQty() : BigDecimal.ZERO;
        o.setPrice(price);
        o.setQuantity(filled.add(qty));     // top the remaining quantity back up to the level size
        o.setCreatedAt(now);                // a re-priced quote loses its time priority
        orderRepository.save(o);
        return true;
    }

    /** Whole shares for most prices; fractional only where the unit price is large. */
    private static BigDecimal roundQty(BigDecimal qty, BigDecimal price) {
        int scale = price.compareTo(new BigDecimal("1000")) >= 0 ? 4 : price.compareTo(BigDecimal.ONE) >= 0 ? 2 : 0;
        return qty.max(BigDecimal.ZERO).setScale(scale, RoundingMode.DOWN);
    }
}
