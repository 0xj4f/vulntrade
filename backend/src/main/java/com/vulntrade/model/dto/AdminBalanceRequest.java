package com.vulntrade.model.dto;

import lombok.Data;
import java.math.BigDecimal;

/**
 * VULN: No validation annotations.
 * VULN: Authorization check uses JWT role from token body (modifiable by client).
 */
@Data
public class AdminBalanceRequest {
    private Long userId;
    private BigDecimal amount;
    private String reason;  // VULN: logged without sanitization (log injection)
}
