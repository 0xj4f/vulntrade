package com.vulntrade.model.dto;

import lombok.Data;
import java.math.BigDecimal;

/**
 * VULN: No validation annotations.
 * VULN: Negative amount = deposit (sign flip).
 * VULN: No 2FA verification field (frontend-only check).
 */
@Data
public class WithdrawRequest {
    private BigDecimal amount;          // VULN: can be negative
    private String destinationAccount;  // VULN: no verification
}
