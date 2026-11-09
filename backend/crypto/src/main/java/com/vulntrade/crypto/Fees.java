package com.vulntrade.crypto;

import com.vulntrade.model.Order;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Maker/taker fees: how our exchange earns.
 *
 *   maker  the order that was already resting on the book   0.10%
 *   taker  the order that came in and matched it             0.20%
 *
 * Paid in USD by each client side, credited to the house. The house pays no fees itself.
 */
public final class Fees {

    public static final BigDecimal MAKER = new BigDecimal("0.0010");
    public static final BigDecimal TAKER = new BigDecimal("0.0020");

    private Fees() {
    }

    /** The fee rate of one side of a fill. */
    public static BigDecimal rate(Order order, boolean isMaker) {
        // VULN CR-3: a fee role sent by the client (feeRole=MAKER) is honoured, so every order can
        //            pay the cheaper maker fee, even when it is the one taking liquidity.
        String role = order.getFeeRole() != null ? order.getFeeRole() : (isMaker ? "MAKER" : "TAKER");
        return "MAKER".equalsIgnoreCase(role) ? MAKER : TAKER;
    }

    /** VULN CR-6: rounded DOWN to cents, so a dust trade (0.00000001 BTC) pays no fee at all. */
    public static BigDecimal of(BigDecimal tradeValue, BigDecimal rate) {
        return tradeValue.multiply(rate).setScale(2, RoundingMode.DOWN);
    }

    /** The coin a pair trades: BTC for BTC-USD. */
    public static String coin(String symbol) {
        return symbol.substring(0, symbol.indexOf('-'));
    }
}
