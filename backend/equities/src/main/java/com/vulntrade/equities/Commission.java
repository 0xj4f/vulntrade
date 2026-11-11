package com.vulntrade.equities;

import com.vulntrade.model.Order;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Broker commission: $0.005 per share, at least $1 per order. That is how the broker earns
 * (the price itself comes from the exchange). Paid by both client sides, credited to the house.
 *
 * Charged as the order fills: after each fill the order owes commission(filled so far), minus
 * what it already paid (order.fee). So partial fills never pay the $1 minimum twice.
 */
public final class Commission {

    public static final BigDecimal PER_SHARE = new BigDecimal("0.005");
    public static final BigDecimal MINIMUM = new BigDecimal("1.00");

    private Commission() {
    }

    /** Total commission for an order that has filled {@code filledQty} shares. */
    public static BigDecimal total(Order order, BigDecimal filledQty) {
        // VULN EQ-3: a commission sent by the client is used as-is (0, or even negative)
        if (order.getCommission() != null) {
            return order.getCommission();
        }
        // VULN EQ-3: orders for less than one share pay nothing (and EQ-2 allows 0.0001 shares)
        if (order.getQuantity().compareTo(BigDecimal.ONE) < 0) {
            return BigDecimal.ZERO;
        }
        return PER_SHARE.multiply(filledQty).max(MINIMUM).setScale(2, RoundingMode.HALF_UP);
    }

    /** What this fill adds to the order's commission. */
    public static BigDecimal dueOnFill(Order order, BigDecimal fillQty) {
        BigDecimal filledBefore = order.getFilledQty() == null ? BigDecimal.ZERO : order.getFilledQty();
        BigDecimal paid = order.getFee() == null ? BigDecimal.ZERO : order.getFee();
        return total(order, filledBefore.add(fillQty)).subtract(paid);
    }
}
