package com.vulntrade.repository;

import com.vulntrade.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.repository.query.Param;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

@Repository
public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByUsername(String username);

    Optional<User> findByEmail(String email);

    // Duplicate usernames/emails are allowed (no UNIQUE constraint - intentional VULN).
    // findBy* throws when >1 row matches; findFirstBy* adds LIMIT 1 so login/reset stay up.
    Optional<User> findFirstByUsername(String username);

    Optional<User> findFirstByEmail(String email);

    Optional<User> findFirstByApiKey(String apiKey);

    // VULN: Raw SQL query - SQL injection possible if called with unsanitized input
    @Query(value = "SELECT * FROM users WHERE username = ?1", nativeQuery = true)
    User findByUsernameNative(String username);

    List<User> findByRole(String role);

    List<User> findByIsActive(Boolean isActive);

    // ------------------------------------------------------------------
    // Trade settlement — atomic, conditional balance moves. The trade path never
    // saves a whole User entity, so a stale entity can't write an old balance back.
    // ------------------------------------------------------------------

    /** Debit only if the balance covers it. Returns 1 on success, 0 if the funds aren't there. */
    @Transactional
    @Modifying(flushAutomatically = true)
    @Query(value = "UPDATE users SET balance = balance - :amount WHERE id = :id AND balance >= :amount",
            nativeQuery = true)
    int debitIfSufficient(@Param("id") Long id, @Param("amount") BigDecimal amount);

    /** Add (or, with a negative amount, remove) funds unconditionally. */
    @Transactional
    @Modifying(flushAutomatically = true)
    @Query(value = "UPDATE users SET balance = balance + :amount WHERE id = :id", nativeQuery = true)
    int credit(@Param("id") Long id, @Param("amount") BigDecimal amount);

    /** Current balance straight from the database (bypasses the persistence context). */
    @Query(value = "SELECT balance FROM users WHERE id = :id", nativeQuery = true)
    BigDecimal findBalanceById(@Param("id") Long id);
}
