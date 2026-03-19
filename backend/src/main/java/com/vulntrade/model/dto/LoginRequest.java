package com.vulntrade.model.dto;

import lombok.Data;

/**
 * VULN: No validation annotations - accepts anything.
 */
@Data
public class LoginRequest {
    private String username;
    private String password;
}
