package com.vulntrade.service;

import com.vulntrade.model.Order;
import com.vulntrade.model.Symbol;
import com.vulntrade.model.Trade;
import com.vulntrade.model.Transaction;
import com.vulntrade.model.dto.TradeNotification;
import com.vulntrade.repository.*;
import com.vulntrade.security.logging.Outcome;
import com.vulntrade.security.logging.SecurityEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Collectors;

import static com.vulntrade.security.logging.SecurityEventLogger.*;

/**
 * Order matching engine.
 *
 * <p>Every method here runs inside {@link MatchingCoordinator} (one lock, one transaction).
 *
 * <p>Settlement happens at fill time: an order is not reserved when it is placed (vuln #43
 * spirit — several resting orders may together exceed what the owner has), but a fill never
 * takes a balance or a position below zero. A resting order whose owner can no longer cover
 * it is cancelled with a reason; an incoming order that can't cover stops matching and its
 * remainder is cancelled.
 *
 * VULN: Self-matching allowed (wash trading, #62) — the trade is recorded, the cash and
 *       position moves net to zero.
 * VULN: No circuit breaker on rapid price movement.
 * VULN: MARKET orders take whatever the book and the house offer (no slippage cap, #45).
 */
@Service
public class MatchingEngineService {

    private static final Logger logger = LoggerFactory.getLogger(MatchingEngineService.class);
    private static final List<String> OPEN = List.of("NEW", "PARTIAL");

    public static final String INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS";
    public static final String INSUFFICIENT_POSITION = "INSUFFICIENT_POSITION";
    public static final String NO_LIQUIDITY = "NO_LIQUIDITY";

    private enum Shortfall {
        NONE(null), BUYER_FUNDS(INSUFFICIENT_FUNDS), SELLER_POSITION(INSUFFICIENT_POSITION);
        final String reason;
        Shortfall(String reason) { this.reason = reason; }
    }

    private final OrderRepository orderRepository;
    private final TradeRepository tradeRepository;
    private final PositionRepository positionRepository;
    private final UserRepository userRepository;
    private final TransactionRepository transactionRepository;
    private final SymbolRepository symbolRepository;
    private final LiquidityProviderService liquidityProvider;
    private final TradingEvents events;
    private final OrderBookService orderBookService;
    private final SimpMessagingTemplate messagingTemplate;

    public MatchingEngineService(OrderRepository orderRepository,
                                 TradeRepository tradeRepository,
                                 PositionRepository positionRepository,
                                 UserRepository userRepository,
                                 TransactionRepository transactionRepository,
                                 SymbolRepository symbolRepository,
                                 LiquidityProviderService liquidityProvider,
                                 TradingEvents events,
                                 OrderBookService orderBookService,
                                 SimpMessagingTemplate messagingTemplate) {
        this.orderRepository = orderRepository;
        this.tradeRepository = tradeRepository;
        this.positionRepository = positionRepository;
        this.userRepository = userRepository;
        this.transactionRepository = transactionRepository;
        this.symbolRepository = symbolRepository;
        this.liquidityProvider = liquidityProvider;
        this.events = events;
        this.orderBookService = orderBookService;
        this.messagingTemplate = messagingTemplate;
    }

    // ==================================================================
    // Incoming orders
    // ==================================================================

    /**
     * Match an incoming (already saved) order against the book, then against the house,
     * then decide what happens to any remainder:
     * LIMIT rests, MARKET is cancelled (NO_LIQUIDITY), an uncoverable order is cancelled.
     *
     * VULN: Self-matching allowed — no check that both sides belong to different users.
     */
    public void match(Order incoming) {
        boolean isBuy = "BUY".equals(incoming.getSide());
        String symbol = incoming.getSymbol();

        List<Order> book = orderRepository
                .findBySymbolAndSideAndStatusIn(symbol, isBuy ? "SELL" : "BUY", OPEN).stream()
                .filter(o -> !Objects.equals(o.getId(), incoming.getId()))
                .filter(o -> "LIMIT".equals(o.getOrderType()) && o.getPrice() != null)
                .sorted(priceTimePriority(isBuy))
                .collect(Collectors.toList());

        String shortfall = null;
        for (Order resting : book) {
            BigDecimal remaining = remaining(incoming);
            if (remaining.signum() <= 0 || incoming.getPrice() == null) break;

            boolean crosses = isBuy
                    ? incoming.getPrice().compareTo(resting.getPrice()) >= 0
                    : incoming.getPrice().compareTo(resting.getPrice()) <= 0;
            if (!crosses) break;   // sorted best-first: nothing further down crosses either

            BigDecimal restingRemaining = remaining(resting);
            if (restingRemaining.signum() <= 0) continue;

            BigDecimal qty = remaining.min(restingRemaining);
            BigDecimal price = resting.getPrice();          // execute at the maker's price
            Order buy = isBuy ? incoming : resting;
            Order sell = isBuy ? resting : incoming;

            Shortfall result = settle(buy.getUserId(), sell.getUserId(), symbol, qty, price);
            if (result == Shortfall.NONE) {
                recordFill(buy, sell, qty, price, false);
                continue;
            }
            boolean restingIsShort = (result == Shortfall.SELLER_POSITION) == isBuy;
            if (restingIsShort) {
                cancelForReason(resting, result.reason);
                continue;
            }
            shortfall = result.reason;
            break;
        }

        if (shortfall == null && remaining(incoming).signum() > 0) {
            shortfall = fillFromHouse(incoming);
        }

        BigDecimal remaining = remaining(incoming);
        if (remaining.signum() > 0) {
            if (shortfall != null) {
                closeRemainder(incoming, shortfall);
            } else if ("MARKET".equals(incoming.getOrderType())) {
                closeRemainder(incoming, NO_LIQUIDITY);
            }
            // otherwise a LIMIT remainder rests (status NEW or PARTIAL)
        }
        orderRepository.save(incoming);
        events.orderChanged(incoming);
    }

    /**
     * Let the house take the other side of an incoming order:
     * MARKET at touch ± spread; a marketable LIMIT at the better of its limit and the house
     * price (so a limit above the ask doesn't pay its own limit). Fills as much as the house
     * can cover. Returns the shortfall reason if the incoming owner couldn't cover, else null.
     */
    private String fillFromHouse(Order incoming) {
        Long houseId = liquidityProvider.getHouseUserId();
        if (!liquidityProvider.isEnabled() || Objects.equals(houseId, incoming.getUserId())) return null;

        Optional<Symbol> symOpt = symbolRepository.findById(incoming.getSymbol());
        if (symOpt.isEmpty()) return null;
        Symbol sym = symOpt.get();
        boolean isBuy = "BUY".equals(incoming.getSide());
        BigDecimal housePrice = liquidityProvider.fillPrice(sym, incoming.getSide());
        if (housePrice == null) return null;

        BigDecimal price;
        if ("MARKET".equals(incoming.getOrderType())) {
            price = housePrice;   // VULN #45: no slippage cap
        } else {
            BigDecimal limit = incoming.getPrice();
            if (limit == null) return null;
            if (isBuy && (sym.getAsk() == null || limit.compareTo(sym.getAsk()) < 0)) return null;
            if (!isBuy && (sym.getBid() == null || limit.compareTo(sym.getBid()) > 0)) return null;
            price = isBuy ? limit.min(housePrice) : limit.max(housePrice);
        }

        BigDecimal qty = houseCapacity(sym.getSymbol(), isBuy ? "SELL" : "BUY", price).min(remaining(incoming));
        if (qty.signum() <= 0) return null;

        Long buyerId = isBuy ? incoming.getUserId() : houseId;
        Long sellerId = isBuy ? houseId : incoming.getUserId();
        Shortfall result = settle(buyerId, sellerId, sym.getSymbol(), qty, price);
        if (result != Shortfall.NONE) {
            // The house checked its own capacity, so the shortfall is the incoming order's.
            return result.reason;
        }
        Order house = liquidityProvider.createHouseOrder(sym.getSymbol(), isBuy ? "SELL" : "BUY", qty, price);
        recordFill(isBuy ? incoming : house, isBuy ? house : incoming, qty, price, false);
        return null;
    }

    // ==================================================================
    // House sweep (market maker): resting user LIMITs crossed by a price move
    // ==================================================================

    /**
     * Fill every resting user LIMIT order that the live quote now crosses
     * (BUY at or above the ask, SELL at or below the bid) against the house, at the order's
     * own limit price — the normal outcome for a resting maker order.
     */
    public int sweepCrossedLimits(Symbol sym) {
        Long houseId = liquidityProvider.getHouseUserId();
        if (!liquidityProvider.isEnabled() || sym.getAsk() == null || sym.getBid() == null) return 0;

        int fills = 0;
        for (Order o : orderRepository.findRestingUserLimits(sym.getSymbol(), houseId)) {
            boolean isBuy = "BUY".equals(o.getSide());
            boolean crossed = isBuy
                    ? o.getPrice().compareTo(sym.getAsk()) >= 0
                    : o.getPrice().compareTo(sym.getBid()) <= 0;
            if (!crossed) continue;

            BigDecimal price = o.getPrice();
            BigDecimal qty = houseCapacity(sym.getSymbol(), isBuy ? "SELL" : "BUY", price).min(remaining(o));
            if (qty.signum() <= 0) continue;   // house can't take it right now; leave it resting

            Long buyerId = isBuy ? o.getUserId() : houseId;
            Long sellerId = isBuy ? houseId : o.getUserId();
            Shortfall result = settle(buyerId, sellerId, sym.getSymbol(), qty, price);
            if (result != Shortfall.NONE) {
                cancelForReason(o, result.reason);
                continue;
            }
            Order house = liquidityProvider.createHouseOrder(sym.getSymbol(), isBuy ? "SELL" : "BUY", qty, price);
            recordFill(isBuy ? o : house, isBuy ? house : o, qty, price, true);
            fills++;
        }
        return fills;
    }

    /** How much the house can sell (its position) or buy (its cash at {@code price}). */
    private BigDecimal houseCapacity(String symbol, String houseSide, BigDecimal price) {
        Long houseId = liquidityProvider.getHouseUserId();
        if ("SELL".equals(houseSide)) {
            BigDecimal held = positionRepository.findQuantity(houseId, symbol);
            return held != null ? held : BigDecimal.ZERO;
        }
        BigDecimal cash = userRepository.findBalanceById(houseId);
        if (cash == null || price == null || price.signum() <= 0) return BigDecimal.ZERO;
        return cash.divide(price, 8, RoundingMode.DOWN);
    }

    // ==================================================================
    // Settlement
    // ==================================================================

    /**
     * Move cash and shares for one fill, or report who can't cover it. Never leaves a
     * negative balance or position. Under the matching lock, positions only change here,
     * so the read-then-update of the seller's position is safe; the buyer debit is
     * conditional because withdrawals and deposits run outside the lock (the intentional
     * #43/#51 race lives there).
     */
    private Shortfall settle(Long buyerId, Long sellerId, String symbol, BigDecimal qty, BigDecimal price) {
        BigDecimal held = positionRepository.findQuantity(sellerId, symbol);
        if (held == null || held.compareTo(qty) < 0) {
            return Shortfall.SELLER_POSITION;
        }
        if (Objects.equals(buyerId, sellerId)) {
            return Shortfall.NONE;   // wash trade: cash and shares net to zero
        }
        BigDecimal value = tradeValue(qty, price);
        if (userRepository.debitIfSufficient(buyerId, value) == 0) {
            return Shortfall.BUYER_FUNDS;
        }
        if (positionRepository.sellIfSufficient(sellerId, symbol, qty, price) == 0) {
            userRepository.credit(buyerId, value);   // undo the debit (not expected under the lock)
            return Shortfall.SELLER_POSITION;
        }
        userRepository.credit(sellerId, value);
        positionRepository.upsertBuy(buyerId, symbol, qty, price);
        return Shortfall.NONE;
    }

    /** Persist the trade, both fills, both ledger rows, and queue the notifications. */
    private void recordFill(Order buy, Order sell, BigDecimal qty, BigDecimal price, boolean systemInitiated) {
        boolean selfTrade = Objects.equals(buy.getUserId(), sell.getUserId());
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);

        Trade trade = new Trade();
        trade.setBuyOrderId(buy.getId());
        trade.setSellOrderId(sell.getId());
        trade.setSymbol(buy.getSymbol());
        trade.setQuantity(qty);
        trade.setPrice(price);
        trade.setExecutedAt(now);
        trade = tradeRepository.save(trade);

        log(SecurityEvent.TRADE_EXECUTED, Outcome.SUCCESS,
                details("tradeId", trade.getId(),
                        "symbol", trade.getSymbol(),
                        "quantity", qty,
                        "price", price,
                        "buyerId", buy.getUserId(),
                        "sellerId", sell.getUserId(),
                        "buyOrderId", buy.getId(),
                        "sellOrderId", sell.getId(),
                        "selfTrade", selfTrade,
                        "initiator", systemInitiated ? "system" : null));

        applyFill(buy, qty, price, now);
        applyFill(sell, qty, price, now);

        BigDecimal value = tradeValue(qty, price);
        String qtyText = qty.stripTrailingZeros().toPlainString();
        String priceText = price.stripTrailingZeros().toPlainString();
        ledger(buy.getUserId(), "TRADE_BUY", value.negate(),
                "Bought " + qtyText + " " + trade.getSymbol() + " @ " + priceText, trade.getId(), now);
        ledger(sell.getUserId(), "TRADE_SELL", value,
                "Sold " + qtyText + " " + trade.getSymbol() + " @ " + priceText, trade.getId(), now);

        // VULN (#61): user ids and order ids are broadcast to everyone
        TradeNotification notification = new TradeNotification();
        notification.setTradeId(trade.getId());
        notification.setSymbol(trade.getSymbol());
        notification.setQuantity(qty);
        notification.setPrice(price);
        notification.setBuyUserId(buy.getUserId());
        notification.setSellUserId(sell.getUserId());
        notification.setBuyOrderId(buy.getId());
        notification.setSellOrderId(sell.getId());
        notification.setTimestamp(System.currentTimeMillis());
        events.tradeExecuted(notification);
        events.orderChanged(buy);
        events.orderChanged(sell);

        logger.info("Trade executed: {} {} x {} @ {} (buy_order={}, sell_order={}{})",
                trade.getSymbol(), qtyText, qty, priceText, buy.getId(), sell.getId(),
                selfTrade ? ", self-trade" : "");
    }

    /** Add a fill to an order: filled quantity, volume-weighted average fill price, status. */
    private void applyFill(Order o, BigDecimal qty, BigDecimal price, LocalDateTime now) {
        BigDecimal prevFilled = o.getFilledQty() != null ? o.getFilledQty() : BigDecimal.ZERO;
        BigDecimal newFilled = prevFilled.add(qty);
        BigDecimal avg = (o.getFilledPrice() == null || prevFilled.signum() == 0)
                ? price
                : o.getFilledPrice().multiply(prevFilled).add(price.multiply(qty))
                        .divide(newFilled, 8, RoundingMode.HALF_UP);
        o.setFilledQty(newFilled);
        o.setFilledPrice(avg);
        if (newFilled.compareTo(o.getQuantity()) >= 0) {
            o.setStatus("FILLED");
            o.setExecutedAt(now);
        } else {
            o.setStatus("PARTIAL");
        }
        orderRepository.save(o);
    }

    private void ledger(Long userId, String type, BigDecimal amount, String description,
                        Long tradeId, LocalDateTime now) {
        Transaction txn = new Transaction();
        txn.setUserId(userId);
        txn.setType(type);
        txn.setAmount(amount);
        txn.setBalanceAfter(userRepository.findBalanceById(userId));
        txn.setDescription(description);
        txn.setReferenceId("TRADE-" + tradeId);
        txn.setCreatedAt(now);
        transactionRepository.save(txn);
    }

    // ==================================================================
    // Engine-initiated cancels
    // ==================================================================

    /** Cancel a resting order the engine can no longer fill (its owner can't cover it). */
    public void cancelForReason(Order o, String reason) {
        o.setStatus("CANCELLED");
        o.setStatusReason(reason);
        orderRepository.save(o);
        events.orderChanged(o);
        // initiator=system and no isOwner: this is not a user cancelling someone else's order,
        // so the IDOR-cancel detection must not fire on it.
        log(SecurityEvent.ORDER_CANCELLED, Outcome.SUCCESS,
                details("reason", reason.toLowerCase(),
                        "orderId", o.getId(),
                        "symbol", o.getSymbol(),
                        "targetUserId", o.getUserId(),
                        "initiator", "system"));
        logger.info("Order auto-cancelled: id={}, owner={}, reason={}", o.getId(), o.getUserId(), reason);
    }

    /** The incoming order keeps its fills; the rest is cancelled with a reason. */
    private void closeRemainder(Order o, String reason) {
        o.setStatus("CANCELLED");
        o.setStatusReason(reason);
        logger.info("Order remainder cancelled: id={}, filled={}/{}, reason={}",
                o.getId(), o.getFilledQty(), o.getQuantity(), reason);
    }

    // ==================================================================
    // Order book
    // ==================================================================

    /**
     * Broadcast the current book of a symbol right away (used outside matching, e.g. the
     * STOMP market.getOrderBook request).
     * VULN: Includes orderer's userId and username (information disclosure).
     */
    public void broadcastOrderBook(String symbol) {
        OrderBookService.Book book = orderBookService.snapshot(symbol);
        messagingTemplate.convertAndSend("/topic/orderbook", book.entries());
        messagingTemplate.convertAndSend("/topic/orderbook/" + symbol, book.toMessage());
    }

    // ==================================================================
    // Helpers
    // ==================================================================

    static BigDecimal remaining(Order o) {
        BigDecimal filled = o.getFilledQty() != null ? o.getFilledQty() : BigDecimal.ZERO;
        return o.getQuantity().subtract(filled);
    }

    static BigDecimal tradeValue(BigDecimal qty, BigDecimal price) {
        return qty.multiply(price).setScale(8, RoundingMode.HALF_UP);
    }

    private static Comparator<Order> priceTimePriority(boolean incomingIsBuy) {
        Comparator<Order> byPrice = Comparator.comparing(Order::getPrice);
        if (!incomingIsBuy) byPrice = byPrice.reversed();   // a SELL hits the highest bid first
        return byPrice
                .thenComparing(Order::getCreatedAt, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(Order::getId);
    }
}
