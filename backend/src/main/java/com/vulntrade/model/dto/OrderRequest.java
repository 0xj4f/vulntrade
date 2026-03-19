package com.vulntrade.model.dto;

import lombok.Data;
import java.math.BigDecimal;

/**
 * VULN: No validation - negative quantity, zero price, etc.
 */
@Data
public class OrderRequest {
    private String symbol;
    private String side;        // BUY/SELL
    private String type;        // LIMIT/MARKET/STOP
    private BigDecimal quantity; // VULN: can be negative
    private BigDecimal price;   // VULN: can be zero or negative
    private String clientOrderId; // VULN: not unique-enforced
}
