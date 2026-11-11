package com.vulntrade.fx;

import com.vulntrade.events.EventPublisher;
import com.vulntrade.money.Accounts;
import com.vulntrade.money.Balances;
import com.vulntrade.money.Ledger;
import com.vulntrade.security.logging.Outcome;
import com.vulntrade.security.logging.SecurityEvent;
import com.vulntrade.service.MatchingCoordinator;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import static com.vulntrade.security.logging.SecurityEventLogger.details;
import static com.vulntrade.security.logging.SecurityEventLogger.log;

/**
 * FX Order Management: the life of one FX order. FX orders never wait: FILLED or REJECTED.
 *
 * Alice buys 10,000 EURUSD on quote Q1:
 *   1. receive    {pair EURUSD, side BUY, amount 10000, quoteId Q1}
 *   2. price      the quote's ask (1.0853)
 *   3. legs       Alice pays 10,853.00 USD and receives 10,000.00 EUR
 *   4. check      enough USD? house under its EUR limit?
 *   5. execute    the House fills it: 4 balance moves, the trade, the ledger   (one lock, one transaction)
 *   6. tell       Alice gets FILLED, the trade goes to the live stream
 */
@Service
public class FxOms {

    private static final String PRODUCT = "FX";

    private final PriceEngine priceEngine;
    private final FxHouse house;
    private final Accounts accounts;
    private final Balances balances;
    private final Ledger ledger;
    private final MatchingCoordinator coordinator;
    private final EventPublisher events;
    private final JdbcTemplate jdbc;
    private final Set<String> halted = ConcurrentHashMap.newKeySet();

    public FxOms(PriceEngine priceEngine, FxHouse house, Accounts accounts, Balances balances, Ledger ledger,
                 MatchingCoordinator coordinator, EventPublisher events, JdbcTemplate jdbc) {
        this.priceEngine = priceEngine;
        this.house = house;
        this.accounts = accounts;
        this.balances = balances;
        this.ledger = ledger;
        this.coordinator = coordinator;
        this.events = events;
        this.jdbc = jdbc;
    }

    /** One order, decided and (if accepted) filled. Returns the result shown to the client. */
    public Map<String, Object> place(Long userId, String username, Map<String, Object> req) {
        String pairName = text(req.get("pair") != null ? req.get("pair") : req.get("symbol"));
        FxPairs.Pair pair = FxPairs.get(pairName);
        String side = text(req.get("side")).toUpperCase();
        BigDecimal amount = number(req.get("amount") != null ? req.get("amount") : req.get("quantity"));
        String clientOrderId = req.get("clientOrderId") == null ? null : req.get("clientOrderId").toString();
        boolean buy = "BUY".equals(side);

        // ---- 2. which quote, which price -------------------------------------------------
        if (pair == null) {
            return reject(userId, pairName, side, amount, null, clientOrderId, "UNKNOWN_PAIR");
        }
        if (halted.contains(pair.symbol)) {
            return reject(userId, pair.symbol, side, amount, null, clientOrderId, "HALTED");
        }
        Object quoteId = req.get("quoteId");
        PriceEngine.ClientQuote quote = quoteId != null ? priceEngine.find(quoteId.toString())
                : priceEngine.latest(pair.symbol);
        if (quote == null || quote.pair != pair) {
            return reject(userId, pair.symbol, side, amount, null, clientOrderId, "REQUOTE");
        }
        // VULN FX-1: the quote's expiresAt is never checked. Wait for the market to move, then
        //            trade on an old, better quote (latency arbitrage against the House).
        // VULN FX-2: a "price" in the request is trusted over the quote (BUY EUR at 0.0001).
        BigDecimal price = req.get("price") != null ? number(req.get("price")) : (buy ? quote.ask : quote.bid);

        // ---- 3. the two legs ---------------------------------------------------------------
        // The amount is in the base currency (10,000 EUR). Clients may give it in the quote
        // currency instead ("amountCurrency": "QUOTE": "buy EUR for 10,000 USD").
        BigDecimal baseAmount = amount;
        BigDecimal quoteAmount = amount.multiply(price);
        if ("QUOTE".equalsIgnoreCase(text(req.get("amountCurrency")))) {
            quoteAmount = amount;
            // VULN FX-4 (wrong currency leg / inverted pair maths): should be amount / price.
            //            "Spend 1,000 JPY on USDJPY" receives 151,200 USD instead of 6.61 USD.
            baseAmount = amount.multiply(price);
        }
        String payCurrency = buy ? pair.quote : pair.base;
        String receiveCurrency = buy ? pair.base : pair.quote;
        // VULN FX-3: rounding always in the client's favour - pay rounded DOWN, receive rounded UP.
        //            Thousands of tiny trades each earn a fraction (salami attack).
        BigDecimal pay = (buy ? quoteAmount : baseAmount).setScale(FxPairs.scale(payCurrency), RoundingMode.DOWN);
        BigDecimal receive = (buy ? baseAmount : quoteAmount).setScale(FxPairs.scale(receiveCurrency), RoundingMode.UP);

        // ---- 4. checks (outside the lock) -------------------------------------------------
        Long account = accounts.find(userId, Accounts.FX);
        if (account == null) {
            return reject(userId, pair.symbol, side, amount, price, clientOrderId, "NO_FX_ACCOUNT");
        }
        // VULN #43 (FX form): checked here, spent later - two parallel orders can spend the same USD.
        if (balances.available(account, payCurrency).compareTo(pay) < 0) {
            return reject(userId, pair.symbol, side, amount, price, clientOrderId, "INSUFFICIENT_FUNDS");
        }
        // VULN FX-5: the exposure check is never repeated under the lock, so parallel orders all
        //            pass it and push the House past its limit.
        if (!house.withinLimit(pair.base, buy ? baseAmount.negate() : baseAmount)) {
            return reject(userId, pair.symbol, side, amount, price, clientOrderId, "NO_LIQUIDITY");
        }

        // ---- 5. execute: today the House fills every order (B-book) -------------------------
        final BigDecimal fillBase = baseAmount, fillPrice = price;
        Map<String, Object> result = coordinator.execute(() -> execute(userId, account, pair, side, fillBase, fillPrice,
                payCurrency, pay, receiveCurrency, receive, clientOrderId, quote.quoteId));

        // ---- 6. tell everyone (after the commit) -------------------------------------------
        events.toUser(PRODUCT, username, "/queue/order-updates", result);
        events.toAll(PRODUCT, "/topic/fx/trades", Map.of("pair", pair.symbol, "side", side, "amount", fillBase,
                "price", fillPrice, "buyerId", buy ? userId : FxHouse.HOUSE_USER_ID,
                "sellerId", buy ? FxHouse.HOUSE_USER_ID : userId, "timestamp", System.currentTimeMillis()));
        return result;
    }

    /**
     * "Execute" = who takes the other side. Today: always the House (B-book).
     * Future slot: an A/B-book router could decide here to pass the order to a bank (A-book).
     */
    private Map<String, Object> execute(Long userId, Long account, FxPairs.Pair pair, String side, BigDecimal baseAmount,
                                        BigDecimal price, String payCurrency, BigDecimal pay, String receiveCurrency,
                                        BigDecimal receive, String clientOrderId, String quoteId) {
        boolean buy = "BUY".equals(side);
        Long houseAccount = house.accountId();

        long orderId = insertOrder(userId, pair.symbol, side, baseAmount, price, "FILLED", null, clientOrderId);
        long houseOrderId = insertOrder(FxHouse.HOUSE_USER_ID, pair.symbol, buy ? "SELL" : "BUY", baseAmount, price,
                "FILLED", null, null);

        // Client pays and receives; the House does the opposite. (Moves, not checks: see #43 above.)
        BigDecimal clientPayAfter = balances.debit(account, payCurrency, pay);
        BigDecimal clientReceiveAfter = balances.credit(account, receiveCurrency, receive);
        BigDecimal housePayAfter = balances.credit(houseAccount, payCurrency, pay);
        BigDecimal houseReceiveAfter = balances.debit(houseAccount, receiveCurrency, receive);

        Long tradeId = jdbc.queryForObject("INSERT INTO trades (buy_order_id, sell_order_id, symbol, quantity, price, "
                        + "executed_at, product) VALUES (?, ?, ?, ?, ?, now(), 'FX') RETURNING id", Long.class,
                buy ? orderId : houseOrderId, buy ? houseOrderId : orderId, pair.symbol, baseAmount, price);
        String ref = "TRADE-" + tradeId;
        String text = side + " " + baseAmount + " " + pair.symbol + " @ " + price;

        // Ledger: TRADE_BUY/SELL is the quote-currency leg, TRADE_LEG the base-currency leg
        String quoteType = buy ? "TRADE_BUY" : "TRADE_SELL";
        BigDecimal clientQuoteLeg = buy ? pay.negate() : receive;
        BigDecimal clientBaseLeg = buy ? receive : pay.negate();
        ledger.record(userId, account, pair.quote, quoteType, clientQuoteLeg,
                buy ? clientPayAfter : clientReceiveAfter, text, ref);
        ledger.record(userId, account, pair.base, "TRADE_LEG", clientBaseLeg,
                buy ? clientReceiveAfter : clientPayAfter, text, ref);
        ledger.record(FxHouse.HOUSE_USER_ID, houseAccount, pair.quote, buy ? "TRADE_SELL" : "TRADE_BUY",
                clientQuoteLeg.negate(), buy ? housePayAfter : houseReceiveAfter, "House: " + text, ref);
        ledger.record(FxHouse.HOUSE_USER_ID, houseAccount, pair.base, "TRADE_LEG", clientBaseLeg.negate(),
                buy ? houseReceiveAfter : housePayAfter, "House: " + text, ref);

        log(SecurityEvent.ORDER_CREATED, Outcome.SUCCESS, details("orderId", orderId, "symbol", pair.symbol,
                "side", side, "orderType", "QUOTE", "quantity", baseAmount, "price", price,
                "clientOrderId", clientOrderId, "quoteId", quoteId, "product", PRODUCT));
        log(SecurityEvent.TRADE_EXECUTED, Outcome.SUCCESS, details("tradeId", tradeId, "symbol", pair.symbol,
                "quantity", baseAmount, "price", price, "buyerId", buy ? userId : FxHouse.HOUSE_USER_ID,
                "sellerId", buy ? FxHouse.HOUSE_USER_ID : userId, "buyOrderId", buy ? orderId : houseOrderId,
                "sellOrderId", buy ? houseOrderId : orderId, "selfTrade", false, "product", PRODUCT));

        Map<String, Object> r = result(orderId, pair.symbol, side, baseAmount, price, "FILLED", null, clientOrderId);
        r.put("quoteId", quoteId);
        r.put("tradeId", tradeId);
        r.put("pay", Map.of("currency", payCurrency, "amount", pay));
        r.put("receive", Map.of("currency", receiveCurrency, "amount", receive));
        r.put("counterparty", "HOUSE");
        return r;
    }

    /** A rejected order is stored too (status REJECTED + reason). No money moves. */
    private Map<String, Object> reject(Long userId, String pair, String side, BigDecimal amount, BigDecimal price,
                                       String clientOrderId, String reason) {
        long orderId = insertOrder(userId, pair, side, amount, price, "REJECTED", reason, clientOrderId);
        log(SecurityEvent.ORDER_REJECTED, Outcome.DENIED, details("reason", reason.toLowerCase(), "symbol", pair,
                "side", side, "quantity", amount, "price", price, "product", PRODUCT));
        return result(orderId, pair, side, amount, price, "REJECTED", reason, clientOrderId);
    }

    private long insertOrder(Long userId, String pair, String side, BigDecimal qty, BigDecimal price, String status,
                             String reason, String clientOrderId) {
        boolean filled = "FILLED".equals(status);
        return jdbc.queryForObject("INSERT INTO orders (user_id, symbol, side, order_type, quantity, price, status, "
                        + "filled_qty, filled_price, client_order_id, status_reason, created_at, executed_at, product) "
                        + "VALUES (?, ?, ?, 'MARKET', ?, ?, ?, ?, ?, ?, ?, now(), ?, 'FX') RETURNING id", Long.class,
                userId, pair, side, qty == null ? BigDecimal.ZERO : qty, price, status,
                filled ? qty : BigDecimal.ZERO, filled ? price : null, clientOrderId, reason,
                filled ? new java.sql.Timestamp(System.currentTimeMillis()) : null);
    }

    private static Map<String, Object> result(long orderId, String pair, String side, BigDecimal amount,
                                              BigDecimal price, String status, String reason, String clientOrderId) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("orderId", orderId);
        r.put("pair", pair);
        r.put("symbol", pair);
        r.put("side", side);
        r.put("amount", amount);
        r.put("price", price);
        r.put("status", status);
        r.put("reason", reason);
        r.put("clientOrderId", clientOrderId);
        return r;
    }

    // ---- admin (called by the platform's admin halt / resume) ------------------------------

    public void halt(String pair) {
        halted.add(pair.toUpperCase());
    }

    public void resume(String pair) {
        halted.remove(pair.toUpperCase());
    }

    private static String text(Object o) {
        return o == null ? "" : o.toString().trim();
    }

    private static BigDecimal number(Object o) {
        return o == null ? BigDecimal.ZERO : new BigDecimal(o.toString().trim());
    }
}
