package com.vulntrade.model.dto;

import lombok.Data;
import java.math.BigDecimal;

/**
 * VULN: No validation annotations.
 * VULN: No source verification - free money.
 */
@Data
public class DepositRequest {
    private BigDecimal amount;      // VULN: no validation
    private String sourceAccount;   // VULN: no verification of source
}
