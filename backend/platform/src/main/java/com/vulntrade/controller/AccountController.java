package com.vulntrade.controller;

import com.vulntrade.model.Transaction;
import com.vulntrade.model.User;
import com.vulntrade.repository.TransactionRepository;
import com.vulntrade.repository.UserRepository;
import com.vulntrade.security.JwtTokenProvider;
import com.vulntrade.security.logging.Outcome;
import com.vulntrade.security.logging.SecurityEvent;
import io.jsonwebtoken.Claims;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Map;

import static com.vulntrade.security.logging.SecurityEventLogger.*;

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

    private static final Logger logger = LoggerFactory.getLogger(AccountController.class);

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

        logger.info("ACCOUNT_BALANCE_CHECK: userId={}", userId);

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
            log(SecurityEvent.WITHDRAWAL_REJECTED, Outcome.DENIED,
                    details("reason", "account_level_required"));
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
            log(SecurityEvent.WITHDRAWAL_REJECTED, Outcome.DENIED,
                    details("reason", "invalid_amount"));
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid amount"));
        }

        String destination = (String) request.getOrDefault("destinationAccount", "unknown");

        logger.info("ACCOUNT_WITHDRAW: userId={}, amount={}, destination={}", userId, amount, destination);

        return userRepository.findById(userId)
            .map(user -> {
                // VULN: No check for negative amount (sign flip)
                // VULN: Race condition - read balance, check, then update (TOCTOU)
                BigDecimal currentBalance = user.getBalance();

                // "Check" balance (but another thread could be doing the same)
                if (currentBalance.compareTo(amount) < 0 && amount.compareTo(BigDecimal.ZERO) > 0) {
                    log(SecurityEvent.WITHDRAWAL_REJECTED, Outcome.DENIED,
                            details("reason", "insufficient_balance", "amount", amount));
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

                log(SecurityEvent.WITHDRAWAL_COMPLETED, Outcome.SUCCESS,
                        details("amount", amount,
                                "destination", destination,
                                "balanceAfter", user.getBalance(),
                                "transactionId", tx.getId()));
                return ResponseEntity.ok((Object) Map.of(
                    "status", "success",
                    "message", "Withdrawal processed",
                    "amount", amount,
                    "newBalance", user.getBalance(),
                    "destination", destination,
                    "transactionId", tx.getId()
                ));
            })
            // orElseGet (not orElse) so the event is only logged when the user is missing
            .orElseGet(() -> {
                log(SecurityEvent.WITHDRAWAL_REJECTED, Outcome.DENIED,
                        details("reason", "user_not_found"));
                return ResponseEntity.notFound().build();
            });
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
            log(SecurityEvent.DEPOSIT_FAILED, Outcome.FAILURE,
                    details("reason", "account_level_required", "accountLevel", accountLevel));
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
            log(SecurityEvent.DEPOSIT_FAILED, Outcome.FAILURE,
                    details("reason", "invalid_amount"));
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid amount"));
        }

        String source = (String) request.getOrDefault("sourceAccount", "unknown");

        logger.info("ACCOUNT_DEPOSIT: userId={}, amount={}, source={}", userId, amount, source);

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

                log(SecurityEvent.DEPOSIT_COMPLETED, Outcome.SUCCESS,
                        details("amount", amount,
                                "source", source,
                                "balanceAfter", user.getBalance(),
                                "transactionId", tx.getId()));
                return ResponseEntity.ok((Object) Map.of(
                    "status", "success",
                    "message", "Deposit processed",
                    "amount", amount,
                    "newBalance", user.getBalance(),
                    "source", source,
                    "transactionId", tx.getId()
                ));
            })
            // orElseGet (not orElse) so the event is only logged when the user is missing
            .orElseGet(() -> {
                log(SecurityEvent.DEPOSIT_FAILED, Outcome.FAILURE,
                        details("reason", "user_not_found"));
                return ResponseEntity.notFound().build();
            });
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

        logger.info("ACCOUNT_TRANSACTIONS: requestingUserId={}, targetUserId={}", userId, targetUserId);

        // VULN: IDOR - if userId param provided, returns that user's transactions
        Long lookupUserId = (targetUserId != null) ? targetUserId : userId;
        if (targetUserId != null && !isOwner(targetUserId)) {
            log(SecurityEvent.SENSITIVE_DATA_READ, Outcome.SUCCESS,
                    details("resource", "transactions", "targetUserId", targetUserId));
        }
        return ResponseEntity.ok(transactionRepository.findByUserId(lookupUserId));
    }

    private Long extractUserId(String authHeader) {
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            // No Bearer header: fall back to whoever the security filters already authenticated
            // (API key via X-API-Key/?api_key=, or JWT via ?token=). Otherwise these endpoints
            // would 401 for valid API-key requests even though the filter authenticated them.
            return userIdFromSecurityContext();
        }
        try {
            String token = authHeader.substring(7);
            return jwtTokenProvider.getUserIdFromToken(token);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * userId of the principal set by the auth filters, or null if unauthenticated.
     * JwtAuthFilter stores the JWT Claims; ApiKeyAuthFilter stores the User entity.
     */
    private Long userIdFromSecurityContext() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null) {
            return null;
        }
        Object details = auth.getDetails();
        if (details instanceof Claims) {
            Object userId = ((Claims) details).get("userId");
            if (userId instanceof Number) {
                return ((Number) userId).longValue();
            }
        } else if (details instanceof User) {
            return ((User) details).getId();
        }
        return null;
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
