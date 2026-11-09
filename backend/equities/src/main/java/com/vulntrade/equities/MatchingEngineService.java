package com.vulntrade.equities;

import com.vulntrade.model.Order;
import com.vulntrade.model.Symbol;
import com.vulntrade.model.Trade;
import com.vulntrade.model.dto.TradeNotification;
import com.vulntrade.money.Accounts;
import com.vulntrade.money.Balances;
import com.vulntrade.money.Ledger;
import com.vulntrade.repository.OrderRepository;
import com.vulntrade.repository.PositionRepository;
import com.vulntrade.repository.SymbolRepository;
import com.vulntrade.repository.TradeRepository;
import com.vulntrade.security.logging.Outcome;
import com.vulntrade.security.logging.SecurityEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

import static com.vulntrade.security.logging.SecurityEventLogger.details;
import static com.vulntrade.security.logging.SecurityEventLogger.log;

/**
 * XSIM, the simulated stock exchange: order book (open LIMIT orders in the database), matching
 * by price-time priority at the resting order's price, and the house filling what the book can't.
 *
 * <p>Every method runs inside the equities {@code MatchingCoordinator} (one lock, one transaction).
 *
 * <p>Money (1.0.0): cash is the EQUITIES account's USD ({@link Balances}), shares are positions.
 * A BUY holds money when placed; each fill pays from that hold first, then from available money.
 * Commission ({@link Commission}) goes to the house. When an order closes, what is left of its
 * hold goes back ({@link #closeOrder}).
 *
 * VULN: Self-matching allowed (wash trading, #62 / EQ-6): the trade is recorded, nothing moves.
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

    /** What settle() decided: who couldn't cover it (NONE = done), and the commissions paid. */
    private static final class Settlement {
        final Shortfall shortfall;
        final BigDecimal buyerFee;
        final BigDecimal sellerFee;

        Settlement(Shortfall shortfall, BigDecimal buyerFee, BigDecimal sellerFee) {
            this.shortfall = shortfall;
            this.buyerFee = buyerFee;
            this.sellerFee = sellerFee;
        }

        static Settlement failed(Shortfall s) {
            return new Settlement(s, BigDecimal.ZERO, BigDecimal.ZERO);
        }

        boolean ok() {
            return shortfall == Shortfall.NONE;
        }
    }

    private final OrderRepository orderRepository;
    private final TradeRepository tradeRepository;
    private final PositionRepository positionRepository;
    private final SymbolRepository symbolRepository;
    private final LiquidityProviderService house;
    private final TradingEvents events;
    private final Accounts accounts;
    private final Balances balances;
    private final Ledger ledger;

    public MatchingEngineService(OrderRepository orderRepository, TradeRepository tradeRepository,
                                 PositionRepository positionRepository, SymbolRepository symbolRepository,
                                 LiquidityProviderService house, TradingEvents events,
                                 Accounts accounts, Balances balances, Ledger ledger) {
        this.orderRepository = orderRepository;
        this.tradeRepository = tradeRepository;
        this.positionRepository = positionRepository;
        this.symbolRepository = symbolRepository;
        this.house = house;
        this.events = events;
        this.accounts = accounts;
        this.balances = balances;
        this.ledger = ledger;
    }

    // ==================================================================
    // Incoming orders
    // ==================================================================

    /**
     * Match an incoming (already saved) order against the book, then against the house, then
     * decide the remainder: LIMIT rests, MARKET is cancelled (NO_LIQUIDITY), uncoverable is cancelled.
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

            Settlement result = settle(buy, sell, qty, price);
            if (result.ok()) {
                recordFill(buy, sell, qty, price, false, result);
                continue;
            }
            boolean restingIsShort = (result.shortfall == Shortfall.SELLER_POSITION) == isBuy;
            if (restingIsShort) {
                cancelForReason(resting, result.shortfall.reason);
                continue;
            }
            shortfall = result.shortfall.reason;
            break;
        }

        if (shortfall == null && remaining(incoming).signum() > 0) {
            shortfall = fillFromHouse(incoming, null);
        }

        if (remaining(incoming).signum() > 0) {
            if (shortfall != null) {
                closeOrder(incoming, "CANCELLED", shortfall);
            } else if ("MARKET".equals(incoming.getOrderType())) {
                closeOrder(incoming, "CANCELLED", NO_LIQUIDITY);
            }
            // otherwise a LIMIT remainder rests (status NEW or PARTIAL) and keeps its hold
        }
        orderRepository.save(incoming);
        events.orderChanged(incoming);
    }

    /**
     * Let the house take the other side of an incoming order:
     * MARKET at touch +/- spread; a marketable LIMIT at the better of its limit and the house price.
     * {@code fixedPrice} != null forces the price (the XTEST exchange, VULN EQ-7).
     * Returns the shortfall reason if the incoming owner couldn't cover, else null.
     */
    String fillFromHouse(Order incoming, BigDecimal fixedPrice) {
        if (!house.isEnabled() || house.isHouse(incoming.getUserId())) return null;

        Optional<Symbol> symOpt = symbolRepository.findById(incoming.getSymbol());
        if (symOpt.isEmpty()) return null;
        Symbol sym = symOpt.get();
        boolean isBuy = "BUY".equals(incoming.getSide());
        BigDecimal housePrice = fixedPrice != null ? fixedPrice : house.fillPrice(sym, incoming.getSide());
        if (housePrice == null) return null;

        BigDecimal price;
        if ("MARKET".equals(incoming.getOrderType()) || fixedPrice != null) {
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

        Order houseSide = house.houseSide(sym.getSymbol(), isBuy ? "SELL" : "BUY");
        Settlement result = settle(isBuy ? incoming : houseSide, isBuy ? houseSide : incoming, qty, price);
        if (!result.ok()) {
            return result.shortfall.reason;   // the house checked its own capacity: the shortfall is the client's
        }
        Order houseOrder = house.createHouseOrder(sym.getSymbol(), isBuy ? "SELL" : "BUY", qty, price);
        recordFill(isBuy ? incoming : houseOrder, isBuy ? houseOrder : incoming, qty, price, false, result);
        return null;
    }

    // ==================================================================
    // House sweep (market maker): resting user LIMITs crossed by a price move
    // ==================================================================

    /** Fill every resting user LIMIT the live quote now crosses, against the house, at its limit. */
    public int sweepCrossedLimits(Symbol sym) {
        if (!house.isEnabled() || sym.getAsk() == null || sym.getBid() == null) return 0;

        int fills = 0;
        for (Order o : orderRepository.findRestingUserLimits(sym.getSymbol(), house.getHouseUserId())) {
            boolean isBuy = "BUY".equals(o.getSide());
            boolean crossed = isBuy
                    ? o.getPrice().compareTo(sym.getAsk()) >= 0
                    : o.getPrice().compareTo(sym.getBid()) <= 0;
            if (!crossed) continue;

            BigDecimal price = o.getPrice();
            BigDecimal qty = houseCapacity(sym.getSymbol(), isBuy ? "SELL" : "BUY", price).min(remaining(o));
            if (qty.signum() <= 0) continue;   // house can't take it right now; leave it resting

            Order houseSide = house.houseSide(sym.getSymbol(), isBuy ? "SELL" : "BUY");
            Settlement result = settle(isBuy ? o : houseSide, isBuy ? houseSide : o, qty, price);
            if (!result.ok()) {
                cancelForReason(o, result.shortfall.reason);
                continue;
            }
            Order houseOrder = house.createHouseOrder(sym.getSymbol(), isBuy ? "SELL" : "BUY", qty, price);
            recordFill(isBuy ? o : houseOrder, isBuy ? houseOrder : o, qty, price, true, result);
            fills++;
        }
        return fills;
    }

    /** How much the house can sell (its position) or buy (its EQUITIES cash at {@code price}). */
    BigDecimal houseCapacity(String symbol, String houseSide, BigDecimal price) {
        if ("SELL".equals(houseSide)) {
            BigDecimal held = positionRepository.findQuantity(house.getHouseUserId(), symbol);
            return held != null ? held : BigDecimal.ZERO;
        }
        BigDecimal cash = balances.available(house.houseAccount(), "USD");
        if (price == null || price.signum() <= 0) return BigDecimal.ZERO;
        return cash.divide(price, 8, RoundingMode.DOWN).max(BigDecimal.ZERO);
    }

    // ==================================================================
    // Settlement
    // ==================================================================

    /**
     * Move cash, shares and commission for one fill, or report who can't cover it.
     *
     *   1. buyer pays value + commission: first from its hold, the rest from available money
     *      (only if there is enough - so nothing is lost if the next step fails)
     *   2. seller hands over the shares (only if it has them)
     *   3. the held part is spent, the seller is paid (minus its commission), the buyer gets
     *      the shares, the house gets both commissions
     */
    private Settlement settle(Order buy, Order sell, BigDecimal qty, BigDecimal price) {
        Long buyerId = buy.getUserId();
        Long sellerId = sell.getUserId();
        String symbol = buy.getSymbol();

        BigDecimal held = positionRepository.findQuantity(sellerId, symbol);
        if (held == null || held.compareTo(qty) < 0) {
            return Settlement.failed(Shortfall.SELLER_POSITION);
        }
        if (Objects.equals(buyerId, sellerId)) {
            return new Settlement(Shortfall.NONE, BigDecimal.ZERO, BigDecimal.ZERO);   // wash trade (#62 / EQ-6): nothing moves
        }

        BigDecimal value = tradeValue(qty, price);
        BigDecimal buyerFee = house.isHouse(buyerId) ? BigDecimal.ZERO : Commission.dueOnFill(buy, qty);
        BigDecimal sellerFee = house.isHouse(sellerId) ? BigDecimal.ZERO : Commission.dueOnFill(sell, qty);
        Long buyerAccount = accounts.find(buyerId, Accounts.EQUITIES);
        Long sellerAccount = accounts.find(sellerId, Accounts.EQUITIES);

        // 1. buyer pays
        BigDecimal cost = value.add(buyerFee);
        BigDecimal holdLeft = buy.getHoldLeft() == null ? BigDecimal.ZERO : buy.getHoldLeft();
        BigDecimal fromHold = holdLeft.min(cost).max(BigDecimal.ZERO);
        BigDecimal rest = cost.subtract(fromHold);
        if (rest.signum() > 0) {
            if (house.isHouse(buyerId) || unheldMarketOrder(buy)) {
                // The house checked its capacity. VULN EQ-5: a market order sent without a price
                // held $0 and is never refused here - its owner's balance just goes negative.
                balances.debit(buyerAccount, "USD", rest);
            } else if (!balances.debitIfAvailable(buyerAccount, "USD", rest)) {
                return Settlement.failed(Shortfall.BUYER_FUNDS);
            }
        }
        // 2. seller hands over the shares
        if (positionRepository.sellIfSufficient(sellerId, symbol, qty, price) == 0) {
            if (rest.signum() > 0) balances.credit(buyerAccount, "USD", rest);   // undo step 1
            return Settlement.failed(Shortfall.SELLER_POSITION);
        }
        // 3. everything else
        if (fromHold.signum() > 0) {
            balances.spendHeld(buyerAccount, "USD", fromHold);
            buy.setHoldLeft(holdLeft.subtract(fromHold));
        }
        balances.credit(sellerAccount, "USD", value.subtract(sellerFee));
        positionRepository.upsertBuy(buyerId, symbol, qty, price);
        if (buyerFee.add(sellerFee).signum() != 0) {
            balances.credit(house.houseAccount(), "USD", buyerFee.add(sellerFee));
        }
        buy.setFee(fee(buy).add(buyerFee));
        sell.setFee(fee(sell).add(sellerFee));
        return new Settlement(Shortfall.NONE, buyerFee, sellerFee);
    }

    /** A MARKET order that came in without a price and therefore holds nothing (EQ-5). */
    private static boolean unheldMarketOrder(Order o) {
        return "MARKET".equals(o.getOrderType()) && o.getPrice() == null;
    }

    /** Persist the trade, both fills, the ledger rows, and queue the notifications. */
    private void recordFill(Order buy, Order sell, BigDecimal qty, BigDecimal price, boolean systemInitiated,
                            Settlement paid) {
        boolean selfTrade = Objects.equals(buy.getUserId(), sell.getUserId());
        BigDecimal[] fees = {paid.buyerFee, paid.sellerFee};
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);

        Trade trade = new Trade();
        trade.setBuyOrderId(buy.getId());
        trade.setSellOrderId(sell.getId());
        trade.setSymbol(buy.getSymbol());
        trade.setQuantity(qty);
        trade.setPrice(price);
        trade.setExecutedAt(now);
        trade.setProduct(Accounts.EQUITIES);
        trade.setBuyFee(fees[0]);
        trade.setSellFee(fees[1]);
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
                        "commission", fees[0].add(fees[1]),
                        "product", Accounts.EQUITIES,
                        "initiator", systemInitiated ? "system" : null));

        applyFill(buy, qty, price, now);
        applyFill(sell, qty, price, now);

        BigDecimal value = tradeValue(qty, price);
        String qtyText = qty.stripTrailingZeros().toPlainString();
        String priceText = price.stripTrailingZeros().toPlainString();
        ledgerRow(buy.getUserId(), "TRADE_BUY", value.add(fees[0]).negate(),
                "Bought " + qtyText + " " + trade.getSymbol() + " @ " + priceText, trade.getId());
        ledgerRow(sell.getUserId(), "TRADE_SELL", value.subtract(fees[1]),
                "Sold " + qtyText + " " + trade.getSymbol() + " @ " + priceText, trade.getId());

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

        logger.info("Trade executed: {} {} @ {} (buy_order={}, sell_order={}{})",
                trade.getSymbol(), qtyText, priceText, buy.getId(), sell.getId(), selfTrade ? ", self-trade" : "");
    }

    /** Add a fill to an order: filled quantity, volume-weighted average price, status. */
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
            o.setExecutedAt(now);
            closeOrder(o, "FILLED", null);   // gives back what is left of the hold (price improvement)
        } else {
            o.setStatus("PARTIAL");
        }
        orderRepository.save(o);
    }

    private void ledgerRow(Long userId, String type, BigDecimal amount, String description, Long tradeId) {
        Long account = accounts.find(userId, Accounts.EQUITIES);
        ledger.record(userId, account, "USD", type, amount, balances.available(account, "USD"),
                description, "TRADE-" + tradeId);
    }

    // ==================================================================
    // Closing orders
    // ==================================================================

    /**
     * The ONLY way an order reaches FILLED or CANCELLED: sets the status and gives the rest of
     * its hold back to the owner's available money.
     */
    void closeOrder(Order o, String status, String reason) {
        o.setStatus(status);
        o.setStatusReason(reason);
        BigDecimal holdLeft = o.getHoldLeft() == null ? BigDecimal.ZERO : o.getHoldLeft();
        if (holdLeft.signum() != 0 && o.getId() != null) {
            balances.release(accounts.find(o.getUserId(), Accounts.EQUITIES), "USD", holdLeft);
        }
        o.setHoldLeft(BigDecimal.ZERO);
    }

    /** Cancel a resting order the engine can no longer fill (its owner can't cover it). */
    public void cancelForReason(Order o, String reason) {
        closeOrder(o, "CANCELLED", reason);
        orderRepository.save(o);
        events.orderChanged(o);
        // initiator=system: not a user cancelling someone else's order (no IDOR-cancel alert)
        log(SecurityEvent.ORDER_CANCELLED, Outcome.SUCCESS,
                details("reason", reason.toLowerCase(),
                        "orderId", o.getId(),
                        "symbol", o.getSymbol(),
                        "targetUserId", o.getUserId(),
                        "initiator", "system"));
        logger.info("Order auto-cancelled: id={}, owner={}, reason={}", o.getId(), o.getUserId(), reason);
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

    private static BigDecimal fee(Order o) {
        return o.getFee() == null ? BigDecimal.ZERO : o.getFee();
    }

    private static Comparator<Order> priceTimePriority(boolean incomingIsBuy) {
        Comparator<Order> byPrice = Comparator.comparing(Order::getPrice);
        if (!incomingIsBuy) byPrice = byPrice.reversed();   // a SELL hits the highest bid first
        return byPrice
                .thenComparing(Order::getCreatedAt, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(Order::getId);
    }
}
