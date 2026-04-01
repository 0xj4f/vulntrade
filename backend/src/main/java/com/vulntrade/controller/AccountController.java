package com.vulntrade.controller;

import com.vulntrade.model.Transaction;
import com.vulntrade.repository.TransactionRepository;
import com.vulntrade.repository.UserRepository;
import com.vulntrade.security.JwtTokenProvider;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Map;

/**
 * REST Account Controller for deposits, withdrawals, and balance.
 * VULN: Sign flip (negative withdraw = deposit).
 * VULN: Race condition on concurrent withdrawals (double-spend).
 * VULN: No 2FA verification.
 * VULN: No withdrawal rate limit.
 * VULN: No deposit source verification.
 */
@RestController
@RequestMapping("/api/accounts")
public class AccountController {

    private final UserRepository userRepository;
    private final TransactionRepository transactionRepository;
    private final JwtTokenProvider jwtTokenProvider;

    public AccountController(UserRepository userRepository,
                             TransactionRepository transactionRepository,
                             JwtTokenProvider jwtTokenProvider) {
        this.userRepository = userRepository;
        this.transactionRepository = transactionRepository;
        this.jwtTokenProvider = jwtTokenProvider;
    }

    /**
     * Get account balance.
     * VULN: Response includes internal fields (apiKey, notes, role).
     */
    @GetMapping("/balance")
    public ResponseEntity<?> getBalance(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        Long userId = extractUserId(authHeader);
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Authentication required"));
        }

        return userRepository.findById(userId)
            .map(user -> ResponseEntity.ok((Object) Map.of(
                "userId", user.getId(),
                "username", user.getUsername(),
                "balance", user.getBalance(),
                "role", user.getRole(),          // VULN: leaks role
                "apiKey", user.getApiKey(),       // VULN: leaks API key
                "notes", user.getNotes() != null ? user.getNotes() : "",  // VULN: leaks notes/flags
                "isActive", user.getIsActive()
            )))
            .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Withdraw funds.
     * VULN: No 2FA verification (frontend-only check).
     * VULN: No withdrawal rate limit.
     * VULN: Negative amount = deposit (sign flip vulnerability).
     * VULN: Race condition - balance check and deduction not atomic.
     * VULN #92/#94: Level check reads from JWT claim, never verifies against DB.
     * VULN #99: No server-side daily limit enforcement.
     */
    @PostMapping("/withdraw")
    public ResponseEntity<?> withdraw(
            @RequestBody Map<String, Object> request,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        Long userId = extractUserId(authHeader);
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Authentication required"));
        }

        // VULN #92/#94: Check account level from JWT claim ONLY - never queries DB
        Integer accountLevel = extractAccountLevel(authHeader);
        if (accountLevel < 2) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of(
                    "error", "Account Level 2 (Verified) required for withdrawals",
                    "currentLevel", accountLevel,
                    "upgradeUrl", "/account",
                    "hint", "Complete your profile verification to unlock withdrawals"
                ));
        }
        // VULN #99: No server-side daily limit check - $100K limit is frontend-only

        BigDecimal amount;
        try {
            amount = new BigDecimal(request.get("amount").toString());
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid amount"));
        }

        String destination = (String) request.getOrDefault("destinationAccount", "unknown");

        return userRepository.findById(userId)
            .map(user -> {
                // VULN: No check for negative amount (sign flip)
                // VULN: Race condition - read balance, check, then update (TOCTOU)
                BigDecimal currentBalance = user.getBalance();

                // "Check" balance (but another thread could be doing the same)
                if (currentBalance.compareTo(amount) < 0 && amount.compareTo(BigDecimal.ZERO) > 0) {
                    return ResponseEntity.badRequest()
                        .body((Object) Map.of("error", "Insufficient balance"));
                }

                // VULN: Gap between check and deduction allows double-spend
                user.setBalance(currentBalance.subtract(amount));
                userRepository.save(user);

                // Record transaction
                Transaction tx = new Transaction();
                tx.setUserId(userId);
                tx.setType("WITHDRAW");
                tx.setAmount(amount.negate());
                tx.setBalanceAfter(user.getBalance());
                tx.setDescription("Withdraw to " + destination);
                tx.setCreatedAt(LocalDateTime.now());
                transactionRepository.save(tx);

                return ResponseEntity.ok((Object) Map.of(
                    "status", "success",
                    "message", "Withdrawal processed",
                    "amount", amount,
                    "newBalance", user.getBalance(),
                    "destination", destination,
                    "transactionId", tx.getId()
                ));
            })
            .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Deposit funds.
     * VULN: No verification of source - free money.
     * VULN: No rate limiting.
     * VULN #92/#94: Level check reads from JWT claim, never verifies against DB.
     * VULN #99: No server-side daily limit enforcement.
     */
    @PostMapping("/deposit")
    public ResponseEntity<?> deposit(
            @RequestBody Map<String, Object> request,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        Long userId = extractUserId(authHeader);
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Authentication required"));
        }

        // VULN #92/#94: Check account level from JWT claim ONLY - never queries DB
        Integer accountLevel = extractAccountLevel(authHeader);
        if (accountLevel < 2) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of(
                    "error", "Account Level 2 (Verified) required for deposits",
                    "currentLevel", accountLevel,
                    "upgradeUrl", "/account",
                    "hint", "Complete your profile verification to unlock deposits"
                ));
        }
        // VULN #99: No server-side daily limit check - $100K limit is frontend-only

        BigDecimal amount;
        try {
            amount = new BigDecimal(request.get("amount").toString());
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid amount"));
        }

        String source = (String) request.getOrDefault("sourceAccount", "unknown");

        return userRepository.findById(userId)
            .map(user -> {
                // VULN: No source verification - anyone can deposit any amount
                user.setBalance(user.getBalance().add(amount));
                userRepository.save(user);

                Transaction tx = new Transaction();
                tx.setUserId(userId);
                tx.setType("DEPOSIT");
                tx.setAmount(amount);
                tx.setBalanceAfter(user.getBalance());
                tx.setDescription("Deposit from " + source);
                tx.setCreatedAt(LocalDateTime.now());
                transactionRepository.save(tx);

                return ResponseEntity.ok((Object) Map.of(
                    "status", "success",
                    "message", "Deposit processed",
                    "amount", amount,
                    "newBalance", user.getBalance(),
                    "source", source,
                    "transactionId", tx.getId()
                ));
            })
            .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Get transaction history.
     * VULN: No pagination limit - DoS via large request.
     */
    @GetMapping("/transactions")
    public ResponseEntity<?> getTransactions(
            @RequestParam(value = "userId", required = false) Long targetUserId,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        Long userId = extractUserId(authHeader);
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Authentication required"));
        }

        // VULN: IDOR - if userId param provided, returns that user's transactions
        Long lookupUserId = (targetUserId != null) ? targetUserId : userId;
        return ResponseEntity.ok(transactionRepository.findByUserId(lookupUserId));
    }

    private Long extractUserId(String authHeader) {
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return null;
        }
        try {
            String token = authHeader.substring(7);
            return jwtTokenProvider.getUserIdFromToken(token);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * VULN #92/#94: Extract account level from JWT token claim.
     * Server trusts this value without verifying against the database.
     * Attacker can forge JWT with accountLevel=2 to bypass restriction.
     */
    private Integer extractAccountLevel(String authHeader) {
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return 1;
        }
        try {
            String token = authHeader.substring(7);
            return jwtTokenProvider.getAccountLevelFromToken(token);
        } catch (Exception e) {
            return 1;
        }
    }
}
