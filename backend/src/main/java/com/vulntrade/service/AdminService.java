package com.vulntrade.service;

import com.vulntrade.model.Transaction;
import com.vulntrade.model.User;
import com.vulntrade.repository.TransactionRepository;
import com.vulntrade.repository.UserRepository;
import com.vulntrade.security.logging.SecurityEventLogger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

/**
 * Admin service for balance adjustments, trading halts, and price overrides.
 * 
 * VULN: Authorization check uses JWT role from token body (modifiable by client).
 * VULN: Reason field logged without sanitization (log injection).
 * VULN: No audit trail for many admin actions.
 */
@Service
public class AdminService {

    private static final Logger logger = LoggerFactory.getLogger(AdminService.class);

    private final UserRepository userRepository;
    private final TransactionRepository transactionRepository;
    private final PriceSimulatorService priceSimulator;
    private final SimpMessagingTemplate messagingTemplate;

    @Value("${flags.flag7:FLAG{st0mp_4dm1n_ch4nn3l_l34k}}")
    private String flag7;

    public AdminService(UserRepository userRepository,
                        TransactionRepository transactionRepository,
                        PriceSimulatorService priceSimulator,
                        SimpMessagingTemplate messagingTemplate) {
        this.userRepository = userRepository;
        this.transactionRepository = transactionRepository;
        this.priceSimulator = priceSimulator;
        this.messagingTemplate = messagingTemplate;
    }

    /**
     * Adjust a user's balance.
     * VULN: Authorization check uses JWT role from token body (modifiable by client).
     * VULN: Reason field logged without sanitization (log injection).
     */
    public BigDecimal adjustBalance(Long userId, BigDecimal amount, String reason) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found: " + userId));

        BigDecimal newBalance = user.getBalance().add(amount);
        user.setBalance(newBalance);
        userRepository.save(user);

        // Record transaction
        Transaction txn = new Transaction();
        txn.setUserId(userId);
        txn.setType("ADJUSTMENT");
        txn.setAmount(amount);
        txn.setBalanceAfter(newBalance);
        txn.setDescription("Admin adjustment: " + reason);  // VULN: unsanitized
        txn.setReferenceId("ADJ-" + System.currentTimeMillis());
        txn.setCreatedAt(LocalDateTime.now());
        transactionRepository.save(txn);

        // VULN: Log injection via reason field
        logger.info("Admin balance adjustment: userId={}, amount={}, reason={}, newBalance={}",
                userId, amount, reason, newBalance);
        SecurityEventLogger.log("ADMIN_BALANCE_ADJUST", "SUCCESS", Map.of(
                "targetUserId", userId,
                "amount", amount,
                "reason", String.valueOf(reason),
                "newBalance", newBalance));

        // Broadcast to admin channel
        Map<String, Object> alert = new HashMap<>();
        alert.put("type", "BALANCE_ADJUSTMENT");
        alert.put("userId", userId);
        alert.put("amount", amount);
        alert.put("reason", reason);
        alert.put("newBalance", newBalance);
        alert.put("timestamp", System.currentTimeMillis());
        messagingTemplate.convertAndSend("/topic/admin/alerts", alert);

        return newBalance;
    }

    /**
     * Halt trading for a symbol.
     * VULN: Same JWT role check vulnerability.
     */
    public void haltTrading(String symbol, String reason) {
        priceSimulator.haltSymbol(symbol);

        // VULN: Log injection via reason field
        logger.info("Trading halted: symbol={}, reason={}", symbol, reason);
        SecurityEventLogger.log("ADMIN_HALT_TRADING", "SUCCESS", Map.of(
                "symbol", String.valueOf(symbol),
                "reason", String.valueOf(reason)));

        // Broadcast to admin channel
        // VULN: /topic/admin/alerts subscribable by any user
        Map<String, Object> alert = new HashMap<>();
        alert.put("type", "TRADING_HALT");
        alert.put("symbol", symbol);
        alert.put("reason", reason);
        alert.put("timestamp", System.currentTimeMillis());
        alert.put("flag", flag7);  // VULN: Flag 7 leaked in admin channel
        messagingTemplate.convertAndSend("/topic/admin/alerts", alert);

        // Broadcast to all users
        Map<String, Object> publicAlert = new HashMap<>();
        publicAlert.put("type", "TRADING_HALT");
        publicAlert.put("symbol", symbol);
        publicAlert.put("message", "Trading halted for " + symbol);
        messagingTemplate.convertAndSend("/topic/prices", publicAlert);
    }

    /**
     * Resume trading for a symbol.
     */
    public void resumeTrading(String symbol) {
        priceSimulator.resumeSymbol(symbol);
        logger.info("Trading resumed: symbol={}", symbol);

        Map<String, Object> alert = new HashMap<>();
        alert.put("type", "TRADING_RESUME");
        alert.put("symbol", symbol);
        alert.put("timestamp", System.currentTimeMillis());
        messagingTemplate.convertAndSend("/topic/admin/alerts", alert);
    }

    /**
     * Set price for a symbol.
     * VULN: Can set arbitrary prices (market manipulation).
     * VULN: No audit trail for manual price changes.
     */
    public void setPrice(String symbol, BigDecimal price) {
        priceSimulator.setPrice(symbol, price);
        SecurityEventLogger.log("ADMIN_SET_PRICE", "SUCCESS", Map.of(
                "symbol", String.valueOf(symbol),
                "newPrice", price));

        // VULN: No audit trail
        Map<String, Object> alert = new HashMap<>();
        alert.put("type", "PRICE_OVERRIDE");
        alert.put("symbol", symbol);
        alert.put("price", price);
        alert.put("timestamp", System.currentTimeMillis());
        messagingTemplate.convertAndSend("/topic/admin/alerts", alert);
    }

    /**
     * Send system alert to admin channel.
     * VULN: /topic/admin/alerts subscribable by any authenticated user.
     */
    public void sendAdminAlert(String type, String message, Map<String, Object> details) {
        Map<String, Object> alert = new HashMap<>(details != null ? details : new HashMap<>());
        alert.put("type", type);
        alert.put("message", message);
        alert.put("timestamp", System.currentTimeMillis());

        // VULN: Leaks internal system metrics and errors
        alert.put("serverMemory", Runtime.getRuntime().freeMemory());
        alert.put("serverMaxMemory", Runtime.getRuntime().maxMemory());
        alert.put("activeThreads", Thread.activeCount());

        messagingTemplate.convertAndSend("/topic/admin/alerts", alert);
    }
}
