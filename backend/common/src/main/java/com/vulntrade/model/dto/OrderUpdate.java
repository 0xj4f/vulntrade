package com.vulntrade.model.dto;

import com.vulntrade.model.Order;
import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;

import java.math.BigDecimal;

/**
 * Order lifecycle event sent to the order's owner on {@code /user/queue/order-updates}:
 * fills of resting orders, partial fills, and cancels (by the owner, by someone else, or by
 * the engine when the order can no longer be covered).
 */
@Data
public class OrderUpdate {
    private String type = "ORDER_UPDATE";
    private Long orderId;
    private String symbol;
    private String side;
    private String orderType;
    private String status;
    private BigDecimal quantity;
    private BigDecimal price;
    private BigDecimal filledQty;
    private BigDecimal remainingQty;
    private BigDecimal avgFillPrice;
    private String reason;
    private String clientOrderId;
    private Long timestamp;

    // Not serialised to the client: used to route the message.
    @JsonIgnore
    private Long ownerId;

    public static OrderUpdate of(Order o) {
        OrderUpdate u = new OrderUpdate();
        BigDecimal filled = o.getFilledQty() != null ? o.getFilledQty() : BigDecimal.ZERO;
        u.setOrderId(o.getId());
        u.setSymbol(o.getSymbol());
        u.setSide(o.getSide());
        u.setOrderType(o.getOrderType());
        u.setStatus(o.getStatus());
        u.setQuantity(o.getQuantity());
        u.setPrice(o.getPrice());
        u.setFilledQty(filled);
        u.setRemainingQty(o.getQuantity() != null ? o.getQuantity().subtract(filled) : null);
        u.setAvgFillPrice(o.getFilledPrice());
        u.setReason(o.getStatusReason());
        u.setClientOrderId(o.getClientOrderId());
        u.setTimestamp(System.currentTimeMillis());
        u.setOwnerId(o.getUserId());
        return u;
    }
}
