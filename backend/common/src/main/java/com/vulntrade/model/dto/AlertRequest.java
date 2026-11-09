package com.vulntrade.model.dto;

import lombok.Data;
import java.math.BigDecimal;

/**
 * VULN: No validation annotations.
 * VULN: Stored XSS via symbol field (rendered in notification).
 * VULN: No limit on number of alerts (resource exhaustion).
 */
@Data
public class AlertRequest {
    private String symbol;          // VULN: stored XSS possible
    private BigDecimal targetPrice;
    private String direction;       // ABOVE/BELOW
}
