package com.vulntrade.model.dto;

import lombok.Data;
import java.math.BigDecimal;

/**
 * Order book entry DTO.
 * VULN: Includes orderer's userId (information disclosure).
 * VULN: Shows all pending orders (front-running possible).
 */
@Data
public class OrderBookEntry {
    private Long orderId;           // VULN: order ID exposed
    private String symbol;
    private String side;            // BUY/SELL
    private BigDecimal price;
    private BigDecimal quantity;
    private Long userId;            // VULN: user ID disclosed
    private String username;        // VULN: username disclosed
    private Long timestamp;
}
