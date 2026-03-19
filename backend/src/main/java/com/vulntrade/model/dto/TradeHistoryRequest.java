package com.vulntrade.model.dto;

import lombok.Data;

/**
 * VULN: No validation annotations.
 * VULN: SQL injection in date parameters (raw SQL query).
 * VULN: No pagination limit (DoS via huge date range).
 */
@Data
public class TradeHistoryRequest {
    private String startDate;   // VULN: SQL injection
    private String endDate;     // VULN: SQL injection
    private String symbol;      // VULN: SQL injection
}
