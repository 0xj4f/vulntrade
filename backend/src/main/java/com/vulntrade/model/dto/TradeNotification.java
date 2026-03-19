package com.vulntrade.model.dto;

import lombok.Data;
import java.math.BigDecimal;

/**
 * Trade broadcast notification DTO.
 * VULN: Includes internal trade IDs enabling IDOR.
 * VULN: Includes buyer/seller userIds (information disclosure).
 */
@Data
public class TradeNotification {
    private Long tradeId;           // VULN: internal ID exposed
    private String symbol;
    private BigDecimal quantity;
    private BigDecimal price;
    private Long buyUserId;         // VULN: user ID disclosed
    private Long sellUserId;        // VULN: user ID disclosed
    private Long buyOrderId;        // VULN: order ID disclosed
    private Long sellOrderId;       // VULN: order ID disclosed
    private Long timestamp;
}
