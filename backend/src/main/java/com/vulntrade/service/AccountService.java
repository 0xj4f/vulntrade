package com.vulntrade.service;

import com.vulntrade.model.Transaction;
import com.vulntrade.model.User;
import com.vulntrade.repository.TransactionRepository;
import com.vulntrade.repository.UserRepository;
import com.vulntrade.security.logging.SecurityEventLogger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Map;

/**
 * Account management service for deposits and withdrawals.
 * 
 * VULN: Race condition on concurrent withdrawals (double-spend).
 * VULN: Negative amount = deposit (sign flip vulnerability).
 * VULN: No 2FA verification (frontend-only check).
 * VULN: No withdrawal rate limit.
 * VULN: No verification of deposit source - free money.
 */
@Service
public class AccountService {

    private static final Logger logger = LoggerFactory.getLogger(AccountService.class);

    private final UserRepository userRepository;
    private final TransactionRepository transactionRepository;

    public AccountService(UserRepository userRepository,
                          TransactionRepository transactionRepository) {
        this.userRepository = userRepository;
        this.transactionRepository = transactionRepository;
    }

    /**
     * Withdraw funds.
     * VULN: 2FA check only on frontend - backend doesn't verify.
     * VULN: No withdrawal rate limit.
     * VULN: Negative amount = deposit (sign flip vulnerability).
     * VULN: Race condition on concurrent withdrawals (double-spend).
     * 
     * The race condition works because:
     * 1. Thread 1 reads balance = $10,000
     * 2. Thread 2 reads balance = $10,000 (not yet deducted)
     * 3. Thread 1 deducts: balance = $0
     * 4. Thread 2 deducts: balance = -$10,000
     * Both withdrawals succeed, attacker gets $20,000 from $10,000 account.
     */
    public BigDecimal withdraw(Long userId, BigDecimal amount, String destinationAccount) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));

        // VULN: No 2FA verification
        // VULN: No rate limiting

        // VULN: Negative amount check is MISSING
        // If amount is negative, subtracting a negative = adding
        // withdraw(-5000) → balance = balance - (-5000) = balance + 5000

        // VULN: Race condition - no locking, no atomic operation
        // Read balance (could be stale)
        BigDecimal currentBalance = user.getBalance();

        // Check sufficient funds
        if (currentBalance.compareTo(amount) < 0) {
            throw new RuntimeException("Insufficient funds. Balance: " + currentBalance);
        }

        // VULN: Gap between check and deduction (TOCTOU)
        // Another thread could withdraw in this gap

        // Deduct balance
        BigDecimal newBalance = currentBalance.subtract(amount);
        user.setBalance(newBalance);
        userRepository.save(user);

        // Record transaction
        Transaction txn = new Transaction();
        txn.setUserId(userId);
        txn.setType("WITHDRAW");
        txn.setAmount(amount.negate());
        txn.setBalanceAfter(newBalance);
        txn.setDescription("Withdrawal to " + destinationAccount);
        txn.setReferenceId("WD-" + System.currentTimeMillis());
        txn.setCreatedAt(LocalDateTime.now());
        transactionRepository.save(txn);

        // VULN: No audit logging of withdrawal
        logger.info("Withdrawal: userId={}, amount={}, destination={}, newBalance={}",
                userId, amount, destinationAccount, newBalance);
        SecurityEventLogger.log("ACCOUNT_WITHDRAW", "SUCCESS", Map.of(
                "userId", userId,
                "amount", amount,
                "destination", String.valueOf(destinationAccount),
                "balanceAfter", newBalance));

        return newBalance;
    }

    /**
     * Deposit funds.
     * VULN: No verification of source - free money.
     * Anyone can deposit any amount without verification.
     */
    public BigDecimal deposit(Long userId, BigDecimal amount, String sourceAccount) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));

        // VULN: No verification of source account
        // VULN: No limit on deposit amount
        // VULN: No verification of funds at source

        BigDecimal newBalance = user.getBalance().add(amount);
        user.setBalance(newBalance);
        userRepository.save(user);

        // Record transaction
        Transaction txn = new Transaction();
        txn.setUserId(userId);
        txn.setType("DEPOSIT");
        txn.setAmount(amount);
        txn.setBalanceAfter(newBalance);
        txn.setDescription("Deposit from " + sourceAccount);
        txn.setReferenceId("DEP-" + System.currentTimeMillis());
        txn.setCreatedAt(LocalDateTime.now());
        transactionRepository.save(txn);

        logger.info("Deposit: userId={}, amount={}, source={}, newBalance={}",
                userId, amount, sourceAccount, newBalance);
        SecurityEventLogger.log("ACCOUNT_DEPOSIT", "SUCCESS", Map.of(
                "userId", userId,
                "amount", amount,
                "source", String.valueOf(sourceAccount),
                "balanceAfter", newBalance));

        return newBalance;
    }

    /**
     * Get user balance.
     * VULN: Response includes internal account flags.
     */
    public User getUserWithBalance(Long userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));
    }
}
