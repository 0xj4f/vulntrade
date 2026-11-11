package com.vulntrade.crypto;

import com.vulntrade.model.Order;
import com.vulntrade.model.Symbol;
import com.vulntrade.money.Accounts;
import com.vulntrade.money.Balances;
import com.vulntrade.repository.OrderRepository;
import com.vulntrade.repository.SymbolRepository;
import com.vulntrade.service.MatchingCoordinator;
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
 * The house market-maker bot: keeps buy and sell orders on every crypto book so it is never empty.
 * Once a second, per pair, under the crypto lock:
 *
 *   1. sweep    resting client LIMIT orders that the index price moved through are taken by the bot
 *   2. requote  a ladder of 5 bids and 5 asks (tagged HOUSE-MM-<pair>-<side>-<level>) around a centre
 *
 * VULN CR-2 (spoofing): the bot leans its quotes up to 1% toward the side with more BIG client
 * orders (>= $10,000) resting near the price. A spoofer posts a big bid that is never meant to fill,
 * the bot raises its quotes, the spoofer sells to the bot at the raised bid, then cancels the bid.
 * Ordinary orders don't move it. The ladder never crosses a client order (the book is never crossed).
 */
@Service
public class MarketMakerBot {

    private static final Logger logger = LoggerFactory.getLogger(MarketMakerBot.class);
    static final String TAG_PREFIX = "HOUSE-MM-";
    private static final int LEVELS = 5;
    private static final BigDecimal SPREAD = new BigDecimal("0.0001");       // +0.01% outside the index quote
    private static final BigDecimal STEP = new BigDecimal("0.0005");         // 5 bps between levels
    private static final BigDecimal LEVEL_SHARE_OF_COINS = new BigDecimal("0.02");
    private static final BigDecimal LEVEL_SHARE_OF_CASH = new BigDecimal("0.002");
    private static final List<String> OPEN = List.of("NEW", "PARTIAL");
    private static final BigDecimal BIG_ORDER_USD = new BigDecimal("10000");  // what the bot treats as "big"
    private static final BigDecimal NEAR = new BigDecimal("0.01");            // within 1% of the price
    private static final BigDecimal MAX_LEAN = new BigDecimal("0.01");        // leans at most 1%

    private final SymbolRepository symbolRepository;
    private final OrderRepository orderRepository;
    private final MatchingEngineService matchingEngine;
    private final MatchingCoordinator coordinator;
    private final PriceSimulatorService priceSimulator;
    private final TradingEvents events;
    private final House house;
    private final Balances balances;
    private volatile boolean ready = false;

    public MarketMakerBot(SymbolRepository symbolRepository, OrderRepository orderRepository,
                          MatchingEngineService matchingEngine, MatchingCoordinator coordinator,
                          PriceSimulatorService priceSimulator, TradingEvents events, House house, Balances balances) {
        this.symbolRepository = symbolRepository;
        this.orderRepository = orderRepository;
        this.matchingEngine = matchingEngine;
        this.coordinator = coordinator;
        this.priceSimulator = priceSimulator;
        this.events = events;
        this.house = house;
        this.balances = balances;
    }

    /** Startup: close MARKET orders a crash may have left open. */
    @EventListener(ApplicationReadyEvent.class)
    public void reconcile() {
        try {
            coordinator.run(() -> {
                for (Order o : orderRepository.findRestingMarketOrders(Accounts.CRYPTO)) {
                    matchingEngine.cancelForReason(o, MatchingEngineService.NO_LIQUIDITY);
                }
            });
        } catch (Exception e) {
            logger.warn("Startup reconcile failed: {}", e.getMessage());
        }
        ready = true;
    }

    @Scheduled(fixedDelay = 1000, initialDelay = 3000)
    public void run() {
        if (!ready) return;
        for (Symbol listed : symbolRepository.findAll()) {
            String symbol = listed.getSymbol();
            if (!"CRYPTO".equals(listed.getAssetClass()) || priceSimulator.isHalted(symbol)) continue;
            try {
                coordinator.run(() -> {
                    Symbol sym = symbolRepository.findById(symbol).orElse(null);
                    if (sym == null || sym.getBid() == null || sym.getAsk() == null) return;
                    BigDecimal indexBid = sym.getBid().multiply(BigDecimal.ONE.subtract(SPREAD));
                    BigDecimal indexAsk = sym.getAsk().multiply(BigDecimal.ONE.add(SPREAD));
                    matchingEngine.sweepCrossedLimits(sym, indexBid, indexAsk);
                    requote(sym, indexBid, indexAsk);
                });
            } catch (Exception e) {
                logger.warn("Market-maker pass failed for {}: {}", symbol, e.getMessage());
            }
        }
    }

    /** Re-price the bot's ladder in place (missing levels are created, extra ones cancelled). */
    private void requote(Symbol sym, BigDecimal indexBid, BigDecimal indexAsk) {
        String symbol = sym.getSymbol();
        BigDecimal half = indexAsk.subtract(indexBid).divide(BigDecimal.valueOf(2), 8, RoundingMode.HALF_UP);
        BigDecimal mid = indexBid.add(half);

        BigDecimal userBid = null, userAsk = null;              // best client prices (never crossed)
        BigDecimal bigBids = BigDecimal.ZERO, bigAsks = BigDecimal.ZERO;   // big client size near the price
        for (Order o : orderRepository.findBySymbolAndStatusIn(symbol, OPEN)) {
            if (house.isHouse(o.getUserId()) || !"LIMIT".equals(o.getOrderType()) || o.getPrice() == null) continue;
            boolean buy = "BUY".equals(o.getSide());
            if (buy && (userBid == null || o.getPrice().compareTo(userBid) > 0)) userBid = o.getPrice();
            if (!buy && (userAsk == null || o.getPrice().compareTo(userAsk) < 0)) userAsk = o.getPrice();
            BigDecimal usd = o.getQuantity().subtract(o.getFilledQty() == null ? BigDecimal.ZERO : o.getFilledQty())
                    .multiply(o.getPrice());
            boolean near = o.getPrice().subtract(mid).abs().compareTo(mid.multiply(NEAR)) <= 0;
            if (near && usd.compareTo(BIG_ORDER_USD) >= 0) {
                if (buy) bigBids = bigBids.add(usd); else bigAsks = bigAsks.add(usd);
            }
        }
        BigDecimal centre = mid;
        if (bigBids.add(bigAsks).signum() > 0) {
            // VULN CR-2: lean toward the big orders (+1% if only big bids, -1% if only big asks)
            BigDecimal lean = MAX_LEAN.multiply(bigBids.subtract(bigAsks))
                    .divide(bigBids.add(bigAsks), 8, RoundingMode.HALF_UP);
            centre = mid.multiply(BigDecimal.ONE.add(lean));
        }
        int priceScale = centre.compareTo(BigDecimal.ONE) >= 0 ? 2 : 8;
        BigDecimal tick = BigDecimal.ONE.movePointLeft(priceScale);
        BigDecimal bestAsk = centre.add(half);
        BigDecimal bestBid = centre.subtract(half);
        if (userBid != null) bestAsk = bestAsk.max(userBid.add(tick));    // never cross a client's bid
        if (userAsk != null) bestBid = bestBid.min(userAsk.subtract(tick)); // never cross a client's ask

        BigDecimal coins = balances.available(house.account(), Fees.coin(symbol)).max(BigDecimal.ZERO);
        BigDecimal cash = balances.available(house.account(), "USD").max(BigDecimal.ZERO);
        Map<String, Order> existing = new HashMap<>();
        List<Order> stale = new ArrayList<>();
        for (Order o : orderRepository.findOpenHouseQuotes(house.userId(), symbol)) {
            if (o.getClientOrderId() == null || !o.getClientOrderId().startsWith(TAG_PREFIX)
                    || existing.putIfAbsent(o.getClientOrderId(), o) != null) stale.add(o);
        }

        BigDecimal step = bestAsk.multiply(STEP).max(tick);
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);
        boolean changed = false;
        for (int level = 0; level < LEVELS; level++) {
            BigDecimal offset = step.multiply(BigDecimal.valueOf(level));
            BigDecimal askPrice = bestAsk.add(offset).setScale(priceScale, RoundingMode.CEILING);
            BigDecimal bidPrice = bestBid.subtract(offset).setScale(priceScale, RoundingMode.FLOOR);
            BigDecimal askQty = coins.multiply(LEVEL_SHARE_OF_COINS).setScale(8, RoundingMode.DOWN);
            BigDecimal bidQty = bidPrice.signum() > 0
                    ? askQty.min(cash.multiply(LEVEL_SHARE_OF_CASH).divide(bidPrice, 8, RoundingMode.DOWN))
                    : BigDecimal.ZERO;
            changed |= quote(symbol, "SELL", level, askPrice, askQty, existing, now);
            if (bidPrice.signum() > 0) {
                changed |= quote(symbol, "BUY", level, bidPrice, bidQty, existing, now);
            }
        }
        stale.addAll(existing.values());   // tags no longer quoted
        for (Order o : stale) {
            o.setStatus("CANCELLED");
            orderRepository.save(o);
            changed = true;
        }
        if (changed) events.bookChanged(symbol);
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
            o = house.side(symbol, side);
            o.setOrderType("LIMIT");
            o.setStatus("NEW");
            o.setFilledQty(BigDecimal.ZERO);
            o.setClientOrderId(tag);
        } else {
            BigDecimal remaining = o.getQuantity().subtract(o.getFilledQty() != null ? o.getFilledQty() : BigDecimal.ZERO);
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
}
