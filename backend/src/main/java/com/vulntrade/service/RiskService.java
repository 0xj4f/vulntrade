package com.vulntrade.service;

import com.vulntrade.model.User;
import com.vulntrade.repository.OrderRepository;
import com.vulntrade.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;

/**
 * Pre-trade risk checking service.
 * 
 * VULN: Check and deduction not atomic (TOCTOU - Time of Check, Time of Use).
 * VULN: Risk check skipped for "MARKET" order type.
 * VULN: Max order size only checked on frontend.
 * VULN: No position concentration limit.
 * VULN: No notional value limit.
 * VULN: Balance check uses READ UNCOMMITTED isolation (race condition).
 */
@Service
public class RiskService {

    private static final Logger logger = LoggerFactory.getLogger(RiskService.class);
    private final UserRepository userRepository;
    private final OrderRepository orderRepository;

    public RiskService(UserRepository userRepository, OrderRepository orderRepository) {
        this.userRepository = userRepository;
        this.orderRepository = orderRepository;
    }

    /**
     * Pre-trade risk check.
     * VULN: Multiple race conditions and bypasses.
     * 
     * @return null if check passes, error message if it fails
     */
    public String checkPreTrade(Long userId, String symbol, String side,
                                 String orderType, BigDecimal quantity, BigDecimal price) {

        // VULN: Risk check completely skipped for MARKET orders
        if ("MARKET".equalsIgnoreCase(orderType)) {
            logger.debug("Skipping risk check for MARKET order");
            return null;  // VULN: no risk check at all
        }

        // VULN: No validation of quantity > 0
        // VULN: No validation of price > 0
        // VULN: No max order size check (frontend only)

        if ("BUY".equalsIgnoreCase(side)) {
            // Check balance for buy orders
            User user = userRepository.findById(userId).orElse(null);
            if (user == null) {
                return "User not found";
            }

            // VULN: READ UNCOMMITTED - another thread could be modifying balance
            // VULN: TOCTOU - balance could change between this check and order creation
            BigDecimal orderValue = quantity.multiply(price);
            BigDecimal balance = user.getBalance();

            logger.debug("Risk check: userId={}, balance={}, orderValue={}", userId, balance, orderValue);

            if (balance.compareTo(orderValue) < 0) {
                return "Insufficient balance. Required: " + orderValue + ", Available: " + balance;
            }

            // VULN: No position concentration check
            // VULN: No notional value limit
            // VULN: Balance NOT reserved/locked here - TOCTOU gap
        }

        // VULN: No risk checks for SELL side
        // (could sell shares you don't own - naked short selling)

        return null;  // Pass
    }
}
