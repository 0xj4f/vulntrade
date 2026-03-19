package com.vulntrade.model.dto;

import lombok.Data;
import java.math.BigDecimal;

/**
 * Price feed broadcast DTO.
 * VULN: Includes internal fields (costBasis, marketMakerId) not stripped.
 * VULN: No entitlement check - all users get all symbols.
 */
@Data
public class PriceUpdate {
    private String symbol;
    private BigDecimal bid;
    private BigDecimal ask;
    private BigDecimal last;
    private Long volume;
    private Long timestamp;

    // VULN: Internal fields that should not be exposed
    private BigDecimal costBasis;       // Internal market maker cost
    private String marketMakerId;       // Internal market maker identifier
    private BigDecimal spreadBps;       // Internal spread in basis points
}
