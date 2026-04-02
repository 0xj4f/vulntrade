package com.vulntrade.model;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

import javax.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDate;
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

    // ========== Account Level fields (VULN #96: PII stored in plaintext) ==========

    @Column(name = "account_level")
    private Integer accountLevel = 1;  // 1=BASIC, 2=VERIFIED

    @Column(name = "first_name", length = 100)
    private String firstName;

    @Column(name = "last_name", length = 100)
    private String lastName;

    @Column(name = "date_of_birth", length = 20)
    private String dateOfBirth;  // VULN #96: stored as String, not encrypted

    @Column(name = "phone_number", length = 30)
    private String phoneNumber;  // VULN #96: plaintext

    @Column(name = "ssn", length = 100)
    private String ssn;  // VULN #96: SSN stored in PLAINTEXT - no encryption whatsoever

    @Column(name = "address_line1", length = 255)
    private String addressLine1;

    @Column(name = "address_line2", length = 255)
    private String addressLine2;

    @Column(name = "city", length = 100)
    private String city;

    @Column(name = "state", length = 50)
    private String state;

    @Column(name = "zip_code", length = 20)
    private String zipCode;

    @Column(name = "country", length = 100)
    private String country;

    @Column(name = "photo_path", length = 500)
    private String photoPath;  // VULN #95: full filesystem path stored

    @Column(name = "photo_filename", length = 255)
    private String photoFilename;  // VULN #95: original filename preserved (path traversal)

    @Column(name = "verified_at")
    private LocalDateTime verifiedAt;

    @Column(name = "daily_withdrawn", precision = 20, scale = 8)
    private BigDecimal dailyWithdrawn = BigDecimal.ZERO;

    @Column(name = "daily_deposited", precision = 20, scale = 8)
    private BigDecimal dailyDeposited = BigDecimal.ZERO;

    @Column(name = "last_tx_reset")
    private LocalDate lastTxReset;
}
