package com.vulntrade.websocket.controller;

import com.vulntrade.model.Order;
import com.vulntrade.model.dto.*;
import com.vulntrade.repository.CustomQueryRepository;
import com.vulntrade.security.StompChannelInterceptor.StompPrincipal;
import com.vulntrade.service.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.math.BigDecimal;
import java.security.Principal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * STOMP controller for trading operations.
 * Handles /app/trade.* destinations.
 * 
 * VULN: Multiple IDOR, injection, and business logic vulnerabilities.
 */
@Controller
public class TradeStompController {

    private static final Logger logger = LoggerFactory.getLogger(TradeStompController.class);

    private final OrderService orderService;
    private final AccountService accountService;
    private final PortfolioService portfolioService;
    private final AlertService alertService;
    private final CustomQueryRepository customQueryRepository;
    private final SimpMessagingTemplate messagingTemplate;

    public TradeStompController(OrderService orderService,
                                 AccountService accountService,
                                 PortfolioService portfolioService,
                                 AlertService alertService,
                                 CustomQueryRepository customQueryRepository,
                                 SimpMessagingTemplate messagingTemplate) {
        this.orderService = orderService;
        this.accountService = accountService;
        this.portfolioService = portfolioService;
        this.alertService = alertService;
        this.customQueryRepository = customQueryRepository;
        this.messagingTemplate = messagingTemplate;
    }

    /**
     * /app/trade.placeOrder
     * VULN: No server-side validation of quantity (accepts negative).
     * VULN: No price band validation (can buy at $0.01).
     * VULN: clientOrderId not unique-enforced (replay possible).
     * VULN: Symbol not validated.
     * VULN: Balance check has race condition.
     */
    @MessageMapping("/trade.placeOrder")
    public void placeOrder(@Payload OrderRequest request,
                           SimpMessageHeaderAccessor headerAccessor) {
        Long userId = extractUserId(headerAccessor);
        if (userId == null) {
            sendError(headerAccessor, "Authentication required");
            return;
        }

        try {
            logger.info("TRADE_ORDER: userId={}, symbol={}, side={}, type={}, qty={}, price={}", userId, request.getSymbol(), request.getSide(), request.getType(), request.getQuantity(), request.getPrice());
            Order order = orderService.placeOrder(userId, request);

            // Send confirmation to user
            Map<String, Object> response = new HashMap<>();
            response.put("type", "ORDER_PLACED");
            response.put("orderId", order.getId());
            response.put("status", order.getStatus());
            response.put("symbol", order.getSymbol());
            response.put("side", order.getSide());
            response.put("quantity", order.getQuantity());
            response.put("price", order.getPrice());
            response.put("clientOrderId", order.getClientOrderId());

            messagingTemplate.convertAndSendToUser(
                    extractUsername(headerAccessor), "/queue/orders", response);

        } catch (Exception e) {
            sendError(headerAccessor, e.getMessage());
        }
    }

    /**
     * /app/trade.cancelOrder
     * VULN: IDOR - can cancel any user's order by ID.
     * VULN: No ownership verification.
     */
    @MessageMapping("/trade.cancelOrder")
    public void cancelOrder(@Payload Map<String, Object> request,
                            SimpMessageHeaderAccessor headerAccessor) {
        Long userId = extractUserId(headerAccessor);
        if (userId == null) {
            sendError(headerAccessor, "Authentication required");
            return;
        }

        try {
            Long orderId = ((Number) request.get("orderId")).longValue();
            logger.info("TRADE_CANCEL: userId={}, orderId={}", userId, orderId);
            // VULN: userId is ignored in cancelOrder - IDOR
            Order order = orderService.cancelOrder(userId, orderId);

            Map<String, Object> response = new HashMap<>();
            response.put("type", "ORDER_CANCELLED");
            response.put("orderId", order.getId());
            response.put("status", order.getStatus());

            messagingTemplate.convertAndSendToUser(
                    extractUsername(headerAccessor), "/queue/orders", response);

        } catch (Exception e) {
            sendError(headerAccessor, e.getMessage());
        }
    }

    /**
     * /app/trade.executeMarket
     * VULN: No slippage protection.
     * VULN: Race condition - price changes between validation and execution.
     * VULN: Can execute while trading is halted.
     */
    @MessageMapping("/trade.executeMarket")
    public void executeMarketOrder(@Payload Map<String, Object> request,
                                    SimpMessageHeaderAccessor headerAccessor) {
        Long userId = extractUserId(headerAccessor);
        if (userId == null) {
            sendError(headerAccessor, "Authentication required");
            return;
        }

        try {
            String symbol = (String) request.get("symbol");
            String side = (String) request.get("side");
            BigDecimal quantity = new BigDecimal(request.get("quantity").toString());
            logger.info("TRADE_MARKET: userId={}, symbol={}, side={}, qty={}", userId, symbol, side, quantity);

            Order order = orderService.executeMarketOrder(userId, symbol, side, quantity);

            Map<String, Object> response = new HashMap<>();
            response.put("type", "MARKET_ORDER_EXECUTED");
            response.put("orderId", order.getId());
            response.put("status", order.getStatus());
            response.put("filledPrice", order.getFilledPrice());
            response.put("filledQty", order.getFilledQty());

            messagingTemplate.convertAndSendToUser(
                    extractUsername(headerAccessor), "/queue/orders", response);

        } catch (Exception e) {
            sendError(headerAccessor, e.getMessage());
        }
    }

    /**
     * /app/trade.getPortfolio
     * VULN: Accepts optional userId parameter - returns ANY user's portfolio.
     */
    @MessageMapping("/trade.getPortfolio")
    public void getPortfolio(@Payload(required = false) Map<String, Object> request,
                             SimpMessageHeaderAccessor headerAccessor) {
        Long userId = extractUserId(headerAccessor);
        if (userId == null) {
            sendError(headerAccessor, "Authentication required");
            return;
        }

        try {
            logger.info("TRADE_PORTFOLIO: userId={}", userId);
            // VULN: If request contains userId, use that instead (IDOR)
            Long targetUserId = userId;
            if (request != null && request.containsKey("userId")) {
                targetUserId = ((Number) request.get("userId")).longValue();
                // VULN: No check that requesting user == target user
            }

            List<Map<String, Object>> portfolio = portfolioService.getPortfolio(targetUserId);

            Map<String, Object> response = new HashMap<>();
            response.put("type", "PORTFOLIO");
            response.put("userId", targetUserId);  // VULN: reveals which user
            response.put("positions", portfolio);

            messagingTemplate.convertAndSendToUser(
                    extractUsername(headerAccessor), "/queue/portfolio", response);

        } catch (Exception e) {
            sendError(headerAccessor, e.getMessage());
        }
    }

    /**
     * /app/trade.getBalance
     * VULN: Response includes internal account flags.
     */
    @MessageMapping("/trade.getBalance")
    public void getBalance(SimpMessageHeaderAccessor headerAccessor) {
        Long userId = extractUserId(headerAccessor);
        if (userId == null) {
            sendError(headerAccessor, "Authentication required");
            return;
        }

        try {
            logger.info("TRADE_BALANCE: userId={}", userId);
            var user = accountService.getUserWithBalance(userId);

            Map<String, Object> response = new HashMap<>();
            response.put("type", "BALANCE");
            response.put("userId", user.getId());
            response.put("balance", user.getBalance());
            response.put("username", user.getUsername());
            // VULN: Internal account flags exposed
            response.put("role", user.getRole());
            response.put("isActive", user.getIsActive());
            response.put("apiKey", user.getApiKey());  // VULN: API key in balance response
            response.put("notes", user.getNotes());     // VULN: notes with flags

            messagingTemplate.convertAndSendToUser(
                    extractUsername(headerAccessor), "/queue/balance", response);

        } catch (Exception e) {
            sendError(headerAccessor, e.getMessage());
        }
    }

    /**
     * /app/trade.withdraw
     * VULN: 2FA check only on frontend.
     * VULN: No withdrawal rate limit.
     * VULN: Negative amount = deposit (sign flip).
     * VULN: Race condition on concurrent withdrawals.
     */
    @MessageMapping("/trade.withdraw")
    public void withdraw(@Payload WithdrawRequest request,
                         SimpMessageHeaderAccessor headerAccessor) {
        Long userId = extractUserId(headerAccessor);
        if (userId == null) {
            sendError(headerAccessor, "Authentication required");
            return;
        }

        try {
            logger.info("TRADE_WITHDRAW_WS: userId={}, amount={}", userId, request.getAmount());
            // VULN: No 2FA verification
            // VULN: No rate limiting
            // VULN: Negative amount not checked
            BigDecimal newBalance = accountService.withdraw(
                    userId, request.getAmount(), request.getDestinationAccount());

            Map<String, Object> response = new HashMap<>();
            response.put("type", "WITHDRAW_SUCCESS");
            response.put("newBalance", newBalance);
            response.put("amount", request.getAmount());

            messagingTemplate.convertAndSendToUser(
                    extractUsername(headerAccessor), "/queue/balance", response);

        } catch (Exception e) {
            sendError(headerAccessor, e.getMessage());
        }
    }

    /**
     * /app/trade.deposit
     * VULN: No verification of source - free money.
     */
    @MessageMapping("/trade.deposit")
    public void deposit(@Payload DepositRequest request,
                        SimpMessageHeaderAccessor headerAccessor) {
        Long userId = extractUserId(headerAccessor);
        if (userId == null) {
            sendError(headerAccessor, "Authentication required");
            return;
        }

        try {
            logger.info("TRADE_DEPOSIT_WS: userId={}, amount={}", userId, request.getAmount());
            // VULN: No source verification - anyone can deposit any amount
            BigDecimal newBalance = accountService.deposit(
                    userId, request.getAmount(), request.getSourceAccount());

            Map<String, Object> response = new HashMap<>();
            response.put("type", "DEPOSIT_SUCCESS");
            response.put("newBalance", newBalance);
            response.put("amount", request.getAmount());

            messagingTemplate.convertAndSendToUser(
                    extractUsername(headerAccessor), "/queue/balance", response);

        } catch (Exception e) {
            sendError(headerAccessor, e.getMessage());
        }
    }

    /**
     * /app/trade.getHistory
     * VULN: SQL injection in date parameters (raw SQL query).
     * VULN: No pagination limit (DoS via huge date range).
     */
    @MessageMapping("/trade.getHistory")
    public void getTradeHistory(@Payload TradeHistoryRequest request,
                                 SimpMessageHeaderAccessor headerAccessor) {
        Long userId = extractUserId(headerAccessor);
        if (userId == null) {
            sendError(headerAccessor, "Authentication required");
            return;
        }

        try {
            logger.info("TRADE_HISTORY: userId={}, startDate={}, endDate={}, symbol={}", userId, request.getStartDate(), request.getEndDate(), request.getSymbol());
            // VULN: SQL injection via date parameters
            // VULN: No pagination - DoS possible
            List<Object[]> history = customQueryRepository.getTradeHistory(
                    String.valueOf(userId),
                    request.getStartDate(),   // VULN: SQL injection
                    request.getEndDate(),     // VULN: SQL injection
                    request.getSymbol());     // VULN: SQL injection

            Map<String, Object> response = new HashMap<>();
            response.put("type", "TRADE_HISTORY");
            response.put("trades", history);
            response.put("count", history.size());

            messagingTemplate.convertAndSendToUser(
                    extractUsername(headerAccessor), "/queue/history", response);

        } catch (Exception e) {
            // VULN: Error message reveals database structure
            Map<String, Object> errorResponse = new HashMap<>();
            errorResponse.put("type", "ERROR");
            errorResponse.put("message", e.getMessage());
            errorResponse.put("detail", e.getCause() != null ? e.getCause().getMessage() : null);

            messagingTemplate.convertAndSendToUser(
                    extractUsername(headerAccessor), "/queue/errors", errorResponse);
        }
    }

    /**
     * /app/trade.setAlert
     * VULN: Stored XSS via symbol field.
     * VULN: No limit on number of alerts (resource exhaustion).
     */
    @MessageMapping("/trade.setAlert")
    public void setAlert(@Payload AlertRequest request,
                         SimpMessageHeaderAccessor headerAccessor) {
        Long userId = extractUserId(headerAccessor);
        if (userId == null) {
            sendError(headerAccessor, "Authentication required");
            return;
        }

        try {
            logger.info("TRADE_ALERT: userId={}, symbol={}, target={}", userId, request.getSymbol(), request.getTargetPrice());
            // VULN: No sanitization of symbol - stored XSS
            // VULN: No limit on alerts per user
            var alert = alertService.createAlert(
                    userId, request.getSymbol(),
                    request.getTargetPrice(), request.getDirection());

            Map<String, Object> response = new HashMap<>();
            response.put("type", "ALERT_CREATED");
            response.put("alertId", alert.getId());
            response.put("symbol", alert.getSymbol());  // VULN: XSS payload reflected
            response.put("targetPrice", alert.getTargetPrice());
            response.put("direction", alert.getDirection());

            messagingTemplate.convertAndSendToUser(
                    extractUsername(headerAccessor), "/queue/alerts", response);

        } catch (Exception e) {
            sendError(headerAccessor, e.getMessage());
        }
    }

    // --- Helper methods ---

    private Long extractUserId(SimpMessageHeaderAccessor headerAccessor) {
        Principal principal = headerAccessor.getUser();
        if (principal instanceof StompPrincipal) {
            return ((StompPrincipal) principal).getUserIdAsLong();
        }

        // Fallback: try session attributes
        Map<String, Object> sessionAttrs = headerAccessor.getSessionAttributes();
        if (sessionAttrs != null) {
            Object userId = sessionAttrs.get("userId");
            if (userId instanceof Integer) return ((Integer) userId).longValue();
            if (userId instanceof Long) return (Long) userId;
        }

        return null;
    }

    /**
     * Extract the principal name (username) for convertAndSendToUser.
     * Spring resolves user destinations by Principal.getName(), not by userId.
     */
    private String extractUsername(SimpMessageHeaderAccessor headerAccessor) {
        Principal principal = headerAccessor.getUser();
        if (principal != null) {
            return principal.getName();
        }
        return "anonymous";
    }

    private void sendError(SimpMessageHeaderAccessor headerAccessor, String message) {
        String target = extractUsername(headerAccessor);

        Map<String, Object> error = new HashMap<>();
        error.put("type", "ERROR");
        error.put("message", message);
        error.put("timestamp", System.currentTimeMillis());

        messagingTemplate.convertAndSendToUser(target, "/queue/errors", error);
    }
}
