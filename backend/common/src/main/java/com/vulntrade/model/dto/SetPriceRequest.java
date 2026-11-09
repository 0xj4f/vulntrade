package com.vulntrade.model.dto;

import lombok.Data;
import java.math.BigDecimal;

/**
 * Admin set price request DTO.
 * VULN: Can set arbitrary prices (market manipulation).
 * VULN: No audit trail for manual price changes.
 */
@Data
public class SetPriceRequest {
    private String symbol;
    private BigDecimal price;
}
