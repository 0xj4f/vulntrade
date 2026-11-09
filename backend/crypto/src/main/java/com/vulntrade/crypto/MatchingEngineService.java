package com.vulntrade.crypto;

import com.vulntrade.model.Order;
import com.vulntrade.model.Symbol;
import com.vulntrade.model.Trade;
import com.vulntrade.model.dto.TradeNotification;
import com.vulntrade.money.Accounts;
import com.vulntrade.money.Balances;
import com.vulntrade.money.Ledger;
import com.vulntrade.repository.OrderRepository;
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
import java.util.stream.Collectors;

import static com.vulntrade.security.logging.SecurityEventLogger.details;
import static com.vulntrade.security.logging.SecurityEventLogger.log;

/**
 * Our own crypto exchange: one order book per pair (open LIMIT orders in the database), matched
 * by best price first, then first come first served, at the resting (maker) order's price.
 *
 * <p>Every method runs inside the crypto {@code MatchingCoordinator} (one lock, one transaction).
 *
 * <p>Money: both legs live in the CRYPTO account ({@link Balances}): the buyer pays USD and gets
 * the coin, the seller gives the coin and gets USD. A BUY holds USD and a SELL holds the coin when
 * placed; fills pay from the hold first. Fees ({@link Fees}) go to the house.
 * There is no house backstop: what the book can't fill, a MARKET order doesn't get.
 *
 * VULN CR-1 / #62: no self-trade prevention (own BUY matches own SELL: recorded, nothing moves).
 * VULN CR-4: priority uses created_at, which the client can set (clientTime).
 * VULN CR-5: a MARKET order walks the whole book, at any price (no band, no slippage cap #45).
 */
@Service
public class MatchingEngineService {

    private static final Logger logger = LoggerFactory.getLogger(MatchingEngineService.class);
    private static final List<String> OPEN = List.of("NEW", "PARTIAL");
    private static final String PRODUCT = Accounts.CRYPTO;

    public static final String INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS";
    public static final String INSUFFICIENT_POSITION = "INSUFFICIENT_POSITION";
    public static final String NO_LIQUIDITY = "NO_LIQUIDITY";

    private enum Shortfall {
        NONE(null), BUYER_FUNDS(INSUFFICIENT_FUNDS), SELLER_COINS(INSUFFICIENT_POSITION);
        final String reason;
        Shortfall(String reason) { this.reason = reason; }
    }

    /** What settle() decided: who couldn't cover it (NONE = done), and the fees paid. */
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
    private final House house;
    private final TradingEvents events;
    private final PriceSimulatorService prices;
    private final Accounts accounts;
    private final Balances balances;
    private final Ledger ledger;

    public MatchingEngineService(OrderRepository orderRepository, TradeRepository tradeRepository, House house,
                                 TradingEvents events, PriceSimulatorService prices,
                                 Accounts accounts, Balances balances, Ledger ledger) {
        this.orderRepository = orderRepository;
        this.tradeRepository = tradeRepository;
        this.house = house;
        this.events = events;
        this.prices = prices;
        this.accounts = accounts;
        this.balances = balances;
        this.ledger = ledger;
    }

    // ==================================================================
    // Incoming orders
    // ==================================================================

    /** Match an incoming (already saved) order against the book; LIMIT remainders rest. */
    public void match(Order incoming) {
        boolean isBuy = "BUY".equals(incoming.getSide());
        boolean isMarket = "MARKET".equals(incoming.getOrderType());

        List<Order> book = orderRepository
                .findBySymbolAndSideAndStatusIn(incoming.getSymbol(), isBuy ? "SELL" : "BUY", OPEN).stream()
                .filter(o -> !Objects.equals(o.getId(), incoming.getId()))
                .filter(o -> "LIMIT".equals(o.getOrderType()) && o.getPrice() != null)
                .sorted(priceTimePriority(isBuy))
                .collect(Collectors.toList());

        String shortfall = null;
        for (Order resting : book) {
            BigDecimal remaining = remaining(incoming);
            if (remaining.signum() <= 0) break;
            // VULN CR-5: a MARKET order takes every price level (no band), a LIMIT stops at its price
            boolean crosses = isMarket || (isBuy
                    ? incoming.getPrice().compareTo(resting.getPrice()) >= 0
                    : incoming.getPrice().compareTo(resting.getPrice()) <= 0);
            if (!crosses) break;   // sorted best-first: nothing further down crosses either

            BigDecimal restingRemaining = remaining(resting);
            if (restingRemaining.signum() <= 0) continue;

            BigDecimal qty = remaining.min(restingRemaining);
            BigDecimal price = resting.getPrice();          // execute at the maker's price
            Order buy = isBuy ? incoming : resting;
            Order sell = isBuy ? resting : incoming;

            Settlement result = settle(buy, sell, qty, price, !isBuy);
            if (result.ok()) {
                recordFill(buy, sell, qty, price, false, result);
                continue;
            }
            boolean restingIsShort = (result.shortfall == Shortfall.SELLER_COINS) == isBuy;
            if (restingIsShort) {
                cancelForReason(resting, result.shortfall.reason);
                continue;
            }
            shortfall = result.shortfall.reason;
            break;
        }

        if (remaining(incoming).signum() > 0) {
            if (shortfall != null) {
                closeOrder(incoming, "CANCELLED", shortfall);
            } else if (isMarket) {
                closeOrder(incoming, "CANCELLED", NO_LIQUIDITY);   // nobody left on the book
            }
            // otherwise a LIMIT remainder rests (status NEW or PARTIAL) and keeps its hold
        }
        orderRepository.save(incoming);
        events.orderChanged(incoming);
    }

    // ==================================================================
    // Market-maker sweep: resting user LIMITs the index price has moved through
    // ==================================================================

    /**
     * The bot takes every resting user LIMIT order that the index price now crosses
     * (BUY at or above the ask, SELL at or below the bid), at the order's own price.
     */
    public int sweepCrossedLimits(Symbol sym, BigDecimal bid, BigDecimal ask) {
        int fills = 0;
        for (Order o : orderRepository.findRestingUserLimits(sym.getSymbol(), house.userId())) {
            boolean isBuy = "BUY".equals(o.getSide());
            boolean crossed = isBuy ? o.getPrice().compareTo(ask) >= 0 : o.getPrice().compareTo(bid) <= 0;
            if (!crossed) continue;

            BigDecimal price = o.getPrice();
            BigDecimal qty = houseCapacity(sym.getSymbol(), isBuy ? "SELL" : "BUY", price).min(remaining(o));
            if (qty.signum() <= 0) continue;

            Order houseSide = house.side(sym.getSymbol(), isBuy ? "SELL" : "BUY");
            // the user's order was resting: it is the maker
            Settlement result = settle(isBuy ? o : houseSide, isBuy ? houseSide : o, qty, price, isBuy);
            if (!result.ok()) {
                cancelForReason(o, result.shortfall.reason);
                continue;
            }
            Order houseOrder = house.createOrder(sym.getSymbol(), isBuy ? "SELL" : "BUY", qty, price);
            recordFill(isBuy ? o : houseOrder, isBuy ? houseOrder : o, qty, price, true, result);
            fills++;
        }
        return fills;
    }

    /** How much the house can sell (its coins) or buy (its USD at {@code price}). */
    BigDecimal houseCapacity(String symbol, String houseSide, BigDecimal price) {
        if ("SELL".equals(houseSide)) {
            return balances.available(house.account(), Fees.coin(symbol)).max(BigDecimal.ZERO);
        }
        if (price == null || price.signum() <= 0) return BigDecimal.ZERO;
        return balances.available(house.account(), "USD").divide(price, 8, RoundingMode.DOWN).max(BigDecimal.ZERO);
    }

    // ==================================================================
    // Settlement
    // ==================================================================

    /**
     * Move USD, coins and fees for one fill, or report who can't cover it.
     *
     *   1. buyer pays value + fee: first from its USD hold, the rest from available (only if enough)
     *   2. seller gives the coins: first from its coin hold, the rest from available (only if enough)
     *   3. the held parts are spent, buyer gets the coins, seller gets USD - fee, house gets the fees
     */
    private Settlement settle(Order buy, Order sell, BigDecimal qty, BigDecimal price, boolean buyerIsMaker) {
        Long buyerId = buy.getUserId();
        Long sellerId = sell.getUserId();
        String coin = Fees.coin(buy.getSymbol());
        if (Objects.equals(buyerId, sellerId)) {
            // VULN CR-1 (#62): self-trade. Recorded as a trade (volume, last price), nothing moves.
            return new Settlement(Shortfall.NONE, BigDecimal.ZERO, BigDecimal.ZERO);
        }
        BigDecimal value = tradeValue(qty, price);
        BigDecimal buyerFee = house.isHouse(buyerId) ? BigDecimal.ZERO : Fees.of(value, Fees.rate(buy, buyerIsMaker));
        BigDecimal sellerFee = house.isHouse(sellerId) ? BigDecimal.ZERO : Fees.of(value, Fees.rate(sell, !buyerIsMaker));
        Long buyerAccount = accounts.find(buyerId, PRODUCT);
        Long sellerAccount = accounts.find(sellerId, PRODUCT);

        // 1. buyer pays (USD)
        BigDecimal cost = value.add(buyerFee);
        BigDecimal buyerFromHold = holdLeft(buy).min(cost).max(BigDecimal.ZERO);
        BigDecimal buyerRest = cost.subtract(buyerFromHold);
        if (!take(buyerId, buyerAccount, "USD", buyerRest)) {
            return Settlement.failed(Shortfall.BUYER_FUNDS);
        }
        // 2. seller gives the coins
        BigDecimal sellerFromHold = holdLeft(sell).min(qty).max(BigDecimal.ZERO);
        BigDecimal sellerRest = qty.subtract(sellerFromHold);
        if (!take(sellerId, sellerAccount, coin, sellerRest)) {
            if (buyerRest.signum() > 0) balances.credit(buyerAccount, "USD", buyerRest);   // undo step 1
            return Settlement.failed(Shortfall.SELLER_COINS);
        }
        // 3. everything else
        if (buyerFromHold.signum() > 0) {
            balances.spendHeld(buyerAccount, "USD", buyerFromHold);
            buy.setHoldLeft(holdLeft(buy).subtract(buyerFromHold));
        }
        if (sellerFromHold.signum() > 0) {
            balances.spendHeld(sellerAccount, coin, sellerFromHold);
            sell.setHoldLeft(holdLeft(sell).subtract(sellerFromHold));
        }
        balances.credit(buyerAccount, coin, qty);
        balances.credit(sellerAccount, "USD", value.subtract(sellerFee));
        if (buyerFee.add(sellerFee).signum() != 0) {
            balances.credit(house.account(), "USD", buyerFee.add(sellerFee));
        }
        buy.setFee(fee(buy).add(buyerFee));
        sell.setFee(fee(sell).add(sellerFee));
        return new Settlement(Shortfall.NONE, buyerFee, sellerFee);
    }

    /** Take {@code amount} from available: the house always can (its capacity was checked), a client only if it has it. */
    private boolean take(Long userId, Long account, String asset, BigDecimal amount) {
        if (amount.signum() <= 0) return true;
        if (house.isHouse(userId)) {
            balances.debit(account, asset, amount);
            return true;
        }
        return balances.debitIfAvailable(account, asset, amount);
    }

    /** Persist the trade, both fills, the ledger rows, and queue the notifications. */
    private void recordFill(Order buy, Order sell, BigDecimal qty, BigDecimal price, boolean systemInitiated,
                            Settlement paid) {
        boolean selfTrade = Objects.equals(buy.getUserId(), sell.getUserId());
        String coin = Fees.coin(buy.getSymbol());
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);

        Trade trade = new Trade();
        trade.setBuyOrderId(buy.getId());
        trade.setSellOrderId(sell.getId());
        trade.setSymbol(buy.getSymbol());
        trade.setQuantity(qty);
        trade.setPrice(price);
        trade.setExecutedAt(now);
        trade.setProduct(PRODUCT);
        trade.setBuyFee(paid.buyerFee);
        trade.setSellFee(paid.sellerFee);
        trade = tradeRepository.save(trade);

        log(SecurityEvent.TRADE_EXECUTED, Outcome.SUCCESS,
                details("tradeId", trade.getId(), "symbol", trade.getSymbol(), "quantity", qty, "price", price,
                        "buyerId", buy.getUserId(), "sellerId", sell.getUserId(),
                        "buyOrderId", buy.getId(), "sellOrderId", sell.getId(), "selfTrade", selfTrade,
                        "fees", paid.buyerFee.add(paid.sellerFee), "product", PRODUCT,
                        "initiator", systemInitiated ? "system" : null));

        applyFill(buy, qty, price, now);
        applyFill(sell, qty, price, now);

        BigDecimal value = tradeValue(qty, price);
        String text = qty.stripTrailingZeros().toPlainString() + " " + trade.getSymbol() + " @ "
                + price.stripTrailingZeros().toPlainString();
        String ref = "TRADE-" + trade.getId();
        ledgerRow(buy.getUserId(), "USD", "TRADE_BUY", value.add(paid.buyerFee).negate(), "Bought " + text, ref);
        ledgerRow(buy.getUserId(), coin, "TRADE_LEG", qty, "Bought " + text, ref);
        ledgerRow(sell.getUserId(), "USD", "TRADE_SELL", value.subtract(paid.sellerFee), "Sold " + text, ref);
        ledgerRow(sell.getUserId(), coin, "TRADE_LEG", qty.negate(), "Sold " + text, ref);

        prices.onTrade(trade.getSymbol(), price);

        // VULN (#61): user ids and order ids are broadcast to everyone
        TradeNotification n = new TradeNotification();
        n.setTradeId(trade.getId());
        n.setSymbol(trade.getSymbol());
        n.setQuantity(qty);
        n.setPrice(price);
        n.setBuyUserId(buy.getUserId());
        n.setSellUserId(sell.getUserId());
        n.setBuyOrderId(buy.getId());
        n.setSellOrderId(sell.getId());
        n.setTimestamp(System.currentTimeMillis());
        events.tradeExecuted(n);
        events.orderChanged(buy);
        events.orderChanged(sell);
        logger.info("Trade executed: {} (buy_order={}, sell_order={}{})", text, buy.getId(), sell.getId(),
                selfTrade ? ", self-trade" : "");
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
            closeOrder(o, "FILLED", null);   // gives back what is left of the hold
        } else {
            o.setStatus("PARTIAL");
        }
        orderRepository.save(o);
    }

    private void ledgerRow(Long userId, String asset, String type, BigDecimal amount, String text, String ref) {
        Long account = accounts.find(userId, PRODUCT);
        ledger.record(userId, account, asset, type, amount, balances.available(account, asset), text, ref);
    }

    // ==================================================================
    // Closing orders
    // ==================================================================

    /** What an order holds: USD for a BUY, the coin for a SELL. */
    static String heldAsset(Order o) {
        return "BUY".equals(o.getSide()) ? "USD" : Fees.coin(o.getSymbol());
    }

    /** The ONLY way to FILLED or CANCELLED: sets the status and gives the rest of the hold back. */
    void closeOrder(Order o, String status, String reason) {
        o.setStatus(status);
        o.setStatusReason(reason);
        if (holdLeft(o).signum() != 0 && o.getId() != null) {
            balances.release(accounts.find(o.getUserId(), PRODUCT), heldAsset(o), holdLeft(o));
        }
        o.setHoldLeft(BigDecimal.ZERO);
    }

    /** Cancel a resting order the engine can no longer fill (its owner can't cover it). */
    public void cancelForReason(Order o, String reason) {
        closeOrder(o, "CANCELLED", reason);
        orderRepository.save(o);
        events.orderChanged(o);
        log(SecurityEvent.ORDER_CANCELLED, Outcome.SUCCESS,
                details("reason", reason.toLowerCase(), "orderId", o.getId(), "symbol", o.getSymbol(),
                        "targetUserId", o.getUserId(), "initiator", "system"));
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

    private static BigDecimal holdLeft(Order o) {
        return o.getHoldLeft() == null ? BigDecimal.ZERO : o.getHoldLeft();
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
