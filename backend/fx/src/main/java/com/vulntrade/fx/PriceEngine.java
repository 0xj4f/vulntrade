package com.vulntrade.fx;

import com.vulntrade.events.EventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * The heart of FX: decides what price we show the client.
 *
 *   1. collect the banks' prices      Bank A 1.0850/1.0851, Bank B 1.0849/1.0852
 *   2. pick the best                  best bid 1.0850, best ask 1.0851
 *   3. add our margin (the spread)    client sees 1.0849 / 1.0852
 *   4. give it a quote id, valid 2 s  Q123
 *
 * The difference between the bank price and the client price is the House's profit.
 */
@Component
public class PriceEngine {

    public static final long QUOTE_VALID_MS = 2_000;

    /** One price we offered a client. */
    public static final class ClientQuote {
        public final String quoteId;
        public final FxPairs.Pair pair;
        public final BigDecimal bid;
        public final BigDecimal ask;
        public final long createdAt;
        public final long expiresAt;
        public final List<LpSimulator.LpQuote> lpQuotes;
        public final Map<String, BigDecimal> houseNet;   // House position when the quote was made

        ClientQuote(String quoteId, FxPairs.Pair pair, BigDecimal bid, BigDecimal ask, long createdAt,
                    List<LpSimulator.LpQuote> lpQuotes, Map<String, BigDecimal> houseNet) {
            this.quoteId = quoteId;
            this.pair = pair;
            this.bid = bid;
            this.ask = ask;
            this.createdAt = createdAt;
            this.expiresAt = createdAt + QUOTE_VALID_MS;
            this.lpQuotes = lpQuotes;
            this.houseNet = houseNet;
        }
    }

    private final Map<String, ClientQuote> byId = new ConcurrentHashMap<>();
    private final Map<String, ClientQuote> latest = new ConcurrentHashMap<>();
    private final AtomicLong counter = new AtomicLong();
    private final EventPublisher events;
    private final FxHouse house;
    private final JdbcTemplate jdbc;

    public PriceEngine(EventPublisher events, FxHouse house, JdbcTemplate jdbc) {
        this.events = events;
        this.house = house;
        this.jdbc = jdbc;
    }

    /** Our margin on each side: 1 pip. */
    public BigDecimal margin(FxPairs.Pair pair) {
        return pair.pip;
    }

    public void onBankPrices(FxPairs.Pair pair, List<LpSimulator.LpQuote> lpQuotes) {
        BigDecimal bestBid = lpQuotes.stream().map(q -> q.bid).max(Comparator.naturalOrder()).orElseThrow();
        BigDecimal bestAsk = lpQuotes.stream().map(q -> q.ask).min(Comparator.naturalOrder()).orElseThrow();
        BigDecimal bid = bestBid.subtract(margin(pair));
        BigDecimal ask = bestAsk.add(margin(pair));

        long now = System.currentTimeMillis();
        Map<String, BigDecimal> houseNet = Map.of(pair.base, house.net(pair.base), pair.quote, house.net(pair.quote));
        ClientQuote quote = new ClientQuote("Q" + counter.incrementAndGet(), pair, bid, ask, now, lpQuotes, houseNet);
        byId.put(quote.quoteId, quote);
        latest.put(pair.symbol, quote);
        byId.values().removeIf(q -> q.createdAt < now - 60_000);   // keep one minute of quotes

        // The symbols table holds the mid price, so portfolios and the leaderboard can value FX money
        BigDecimal mid = bid.add(ask).divide(BigDecimal.valueOf(2), pair.priceScale, RoundingMode.HALF_UP);
        jdbc.update("UPDATE symbols SET current_price = ?, bid = ?, ask = ?, last_updated = now() WHERE symbol = ?",
                mid, bid, ask, pair.symbol);

        events.toAll("fx", "/topic/fx/prices", toJson(quote));
    }

    public ClientQuote find(String quoteId) {
        return quoteId == null ? null : byId.get(quoteId);
    }

    public ClientQuote latest(String pairSymbol) {
        return latest.get(pairSymbol);
    }

    public List<Map<String, Object>> latestQuotes() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (FxPairs.Pair p : FxPairs.ALL.values()) {
            ClientQuote q = latest.get(p.symbol);
            if (q != null) {
                out.add(toJson(q));
            }
        }
        return out;
    }

    /** What the price stream and GET /api/fx/quotes send. */
    public Map<String, Object> toJson(ClientQuote q) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("pair", q.pair.symbol);
        m.put("symbol", q.pair.symbol);
        m.put("base", q.pair.base);
        m.put("quote", q.pair.quote);
        m.put("bid", q.bid);
        m.put("ask", q.ask);
        m.put("quoteId", q.quoteId);
        m.put("timestamp", q.createdAt);
        m.put("expiresAt", q.expiresAt);
        // VULN FX-6 (and #36): the stream leaks internals - the banks' raw prices, our margin and
        // the House's position, so a client knows exactly when the House is exposed.
        List<Map<String, Object>> banks = new ArrayList<>();
        for (LpSimulator.LpQuote lp : q.lpQuotes) {
            banks.add(Map.of("bank", lp.bank, "bid", lp.bid, "ask", lp.ask));
        }
        m.put("lpQuotes", banks);
        m.put("margin", margin(q.pair));
        m.put("houseNet", q.houseNet);
        return m;
    }
}
