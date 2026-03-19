package com.vulntrade.model;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

import javax.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "users")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "username", length = 50, nullable = false)
    private String username;
    // VULN: no unique constraint enforced at JPA level

    @Column(name = "password_hash", length = 255, nullable = false)
    private String passwordHash;

    @Column(name = "email", length = 100)
    private String email;

    @Column(name = "role", length = 20)
    private String role = "TRADER";

    @Column(name = "balance", precision = 20, scale = 8)
    private BigDecimal balance = BigDecimal.ZERO;

    @Column(name = "api_key", length = 64)
    private String apiKey;
    // VULN: stored in plaintext

    @Column(name = "is_active")
    private Boolean isActive = true;

    @Column(name = "notes", columnDefinition = "TEXT")
    private String notes;
    // Flag 2 hidden in admin's notes

    @Column(name = "profile_pic", length = 255)
    private String profilePic;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();
}
