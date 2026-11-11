package com.vulntrade.money;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Map;

/**
 * What an amount of some asset is worth in USD, using current prices from the symbols table.
 *
 *   USD            1:1
 *   BTC, ETH ...   x price of "BTC-USD"
 *   EUR, GBP       x price of "EURUSD" / "GBPUSD"
 *   JPY            / price of "USDJPY"
 *   anything else  0 (no price known)
 */
public final class UsdValue {

    private UsdValue() {
    }

    /** @param prices symbol -> current price */
    public static BigDecimal of(String asset, BigDecimal amount, Map<String, BigDecimal> prices) {
        if (amount == null || asset == null) {
            return BigDecimal.ZERO;
        }
        if ("USD".equals(asset)) {
            return amount;
        }
        BigDecimal p = prices.get(asset + "-USD");
        if (p == null) {
            p = prices.get(asset + "USD");
        }
        if (p != null) {
            return amount.multiply(p);
        }
        BigDecimal inverse = prices.get("USD" + asset);
        if (inverse != null && inverse.signum() > 0) {
            return amount.divide(inverse, 8, RoundingMode.HALF_UP);
        }
        return BigDecimal.ZERO;
    }
}
