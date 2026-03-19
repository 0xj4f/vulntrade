package com.vulntrade.model;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

import javax.persistence.*;
import java.time.LocalDateTime;

/**
 * Password reset token entity.
 * VULN: Token is predictable (timestamp-based).
 * VULN: Token never expires (no expiry check).
 * VULN: Token not invalidated after use.
 */
@Entity
@Table(name = "password_reset_tokens")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class PasswordResetToken {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "token", length = 100, nullable = false)
    private String token;
    // VULN: Predictable - based on System.currentTimeMillis()

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    // VULN: No expiry field - tokens never expire
    // VULN: No "used" flag - tokens can be reused
}
