package com.vulntrade.fx;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The currency pairs we quote. A pair is "base/quote": buying 10,000 EURUSD means you receive
 * 10,000 EUR (base) and pay 10,000 x price USD (quote).
 */
public final class FxPairs {

    public static final class Pair {
        public final String symbol;       // EURUSD
        public final String base;         // EUR
        public final String quote;        // USD
        public final BigDecimal pip;      // smallest usual price step (0.0001, or 0.01 for JPY)
        public final int priceScale;      // decimals in a price
        public final BigDecimal startMid; // first mid price at startup

        Pair(String symbol, String base, String quote, String pip, int priceScale, String startMid) {
            this.symbol = symbol;
            this.base = base;
            this.quote = quote;
            this.pip = new BigDecimal(pip);
            this.priceScale = priceScale;
            this.startMid = new BigDecimal(startMid);
        }
    }

    public static final Map<String, Pair> ALL = new LinkedHashMap<>();

    static {
        add(new Pair("EURUSD", "EUR", "USD", "0.0001", 5, "1.08500"));
        add(new Pair("GBPUSD", "GBP", "USD", "0.0001", 5, "1.26500"));
        add(new Pair("USDJPY", "USD", "JPY", "0.01", 3, "151.200"));
        add(new Pair("EURGBP", "EUR", "GBP", "0.0001", 5, "0.85800"));
    }

    private static void add(Pair p) {
        ALL.put(p.symbol, p);
    }

    private FxPairs() {
    }

    public static Pair get(String symbol) {
        return symbol == null ? null : ALL.get(symbol.toUpperCase().replace("/", ""));
    }

    /** How many decimals a currency amount has: JPY has none, the others have cents. */
    public static int scale(String currency) {
        return "JPY".equals(currency) ? 0 : 2;
    }
}
