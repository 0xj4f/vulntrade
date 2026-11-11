package com.vulntrade.model.dto;

import lombok.Data;

/**
 * VULN: No validation annotations.
 * VULN: Mass assignment - role field can be set by client.
 */
@Data
public class RegisterRequest {
    private String username;
    private String password;
    private String email;
    private String role;      // VULN: mass assignment - client can set ADMIN
    private String profilePic;
}
