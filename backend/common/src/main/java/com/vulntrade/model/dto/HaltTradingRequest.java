package com.vulntrade.model.dto;

import lombok.Data;

/**
 * Admin halt trading request DTO.
 * VULN: Same JWT role check vulnerability.
 */
@Data
public class HaltTradingRequest {
    private String symbol;
    private String reason;
}
