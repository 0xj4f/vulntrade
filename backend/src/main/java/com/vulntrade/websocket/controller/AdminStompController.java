package com.vulntrade.websocket.controller;

import com.vulntrade.model.dto.AdminBalanceRequest;
import com.vulntrade.model.dto.HaltTradingRequest;
import com.vulntrade.model.dto.SetPriceRequest;
import com.vulntrade.security.StompChannelInterceptor.StompPrincipal;
import com.vulntrade.service.AdminService;
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
import java.util.Map;

/**
 * STOMP controller for admin operations.
 * Handles /app/admin.* destinations.
 * 
 * VULN: Authorization check uses JWT role from token body (modifiable by client).
 * VULN: Reason fields logged without sanitization (log injection).
 * VULN: No audit trail for many admin actions.
 */
@Controller
public class AdminStompController {

    private static final Logger logger = LoggerFactory.getLogger(AdminStompController.class);

    private final AdminService adminService;
    private final SimpMessagingTemplate messagingTemplate;

    public AdminStompController(AdminService adminService,
                                 SimpMessagingTemplate messagingTemplate) {
        this.adminService = adminService;
        this.messagingTemplate = messagingTemplate;
    }

    /**
     * /app/admin.adjustBalance
     * VULN: Authorization check uses JWT role from token body (modifiable by client).
     * VULN: Reason field logged without sanitization (log injection).
     */
    @MessageMapping("/admin.adjustBalance")
    public void adjustBalance(@Payload AdminBalanceRequest request,
                               SimpMessageHeaderAccessor headerAccessor) {
        // VULN: Role check uses JWT body role which is modifiable
        String role = extractRole(headerAccessor);
        if (!"ADMIN".equalsIgnoreCase(role)) {
            // VULN: We log but the StompChannelInterceptor already let it through
            logger.warn("Non-admin balance adjustment attempt by role: {}", role);
            // VULN: Still process the request anyway (broken access control)
        }

        try {
            BigDecimal newBalance = adminService.adjustBalance(
                    request.getUserId(), request.getAmount(), request.getReason());

            Map<String, Object> response = new HashMap<>();
            response.put("type", "BALANCE_ADJUSTED");
            response.put("userId", request.getUserId());
            response.put("newBalance", newBalance);
            response.put("amount", request.getAmount());

            // Send to requesting user
            Long userId = extractUserId(headerAccessor);
            if (userId != null) {
                messagingTemplate.convertAndSendToUser(
                        String.valueOf(userId), "/queue/admin", response);
            }

        } catch (Exception e) {
            sendError(headerAccessor, e.getMessage());
        }
    }

    /**
     * /app/admin.haltTrading
     * VULN: Same JWT role check vulnerability.
     */
    @MessageMapping("/admin.haltTrading")
    public void haltTrading(@Payload HaltTradingRequest request,
                             SimpMessageHeaderAccessor headerAccessor) {
        // VULN: Same broken role check
        String role = extractRole(headerAccessor);
        logger.info("Halt trading request from role: {}", role);
        // VULN: No actual enforcement

        try {
            adminService.haltTrading(request.getSymbol(), request.getReason());

            Map<String, Object> response = new HashMap<>();
            response.put("type", "TRADING_HALTED");
            response.put("symbol", request.getSymbol());
            response.put("reason", request.getReason());

            Long userId = extractUserId(headerAccessor);
            if (userId != null) {
                messagingTemplate.convertAndSendToUser(
                        String.valueOf(userId), "/queue/admin", response);
            }

        } catch (Exception e) {
            sendError(headerAccessor, e.getMessage());
        }
    }

    /**
     * /app/admin.resumeTrading
     */
    @MessageMapping("/admin.resumeTrading")
    public void resumeTrading(@Payload Map<String, String> request,
                               SimpMessageHeaderAccessor headerAccessor) {
        try {
            String symbol = request.get("symbol");
            adminService.resumeTrading(symbol);

            Map<String, Object> response = new HashMap<>();
            response.put("type", "TRADING_RESUMED");
            response.put("symbol", symbol);

            Long userId = extractUserId(headerAccessor);
            if (userId != null) {
                messagingTemplate.convertAndSendToUser(
                        String.valueOf(userId), "/queue/admin", response);
            }

        } catch (Exception e) {
            sendError(headerAccessor, e.getMessage());
        }
    }

    /**
     * /app/admin.setPrice
     * VULN: Can set arbitrary prices (market manipulation).
     * VULN: No audit trail for manual price changes.
     */
    @MessageMapping("/admin.setPrice")
    public void setPrice(@Payload SetPriceRequest request,
                          SimpMessageHeaderAccessor headerAccessor) {
        // VULN: No proper authorization
        try {
            adminService.setPrice(request.getSymbol(), request.getPrice());

            Map<String, Object> response = new HashMap<>();
            response.put("type", "PRICE_SET");
            response.put("symbol", request.getSymbol());
            response.put("price", request.getPrice());

            Long userId = extractUserId(headerAccessor);
            if (userId != null) {
                messagingTemplate.convertAndSendToUser(
                        String.valueOf(userId), "/queue/admin", response);
            }

        } catch (Exception e) {
            sendError(headerAccessor, e.getMessage());
        }
    }

    // --- Helper methods ---

    private String extractRole(SimpMessageHeaderAccessor headerAccessor) {
        Principal principal = headerAccessor.getUser();
        if (principal instanceof StompPrincipal) {
            return ((StompPrincipal) principal).getRole();
        }
        Map<String, Object> sessionAttrs = headerAccessor.getSessionAttributes();
        if (sessionAttrs != null) {
            return (String) sessionAttrs.get("role");
        }
        return "UNKNOWN";
    }

    private Long extractUserId(SimpMessageHeaderAccessor headerAccessor) {
        Principal principal = headerAccessor.getUser();
        if (principal instanceof StompPrincipal) {
            return ((StompPrincipal) principal).getUserIdAsLong();
        }
        Map<String, Object> sessionAttrs = headerAccessor.getSessionAttributes();
        if (sessionAttrs != null) {
            Object userId = sessionAttrs.get("userId");
            if (userId instanceof Integer) return ((Integer) userId).longValue();
            if (userId instanceof Long) return (Long) userId;
        }
        return null;
    }

    private void sendError(SimpMessageHeaderAccessor headerAccessor, String message) {
        Long userId = extractUserId(headerAccessor);
        String target = userId != null ? String.valueOf(userId) : "anonymous";

        Map<String, Object> error = new HashMap<>();
        error.put("type", "ERROR");
        error.put("message", message);
        error.put("timestamp", System.currentTimeMillis());

        messagingTemplate.convertAndSendToUser(target, "/queue/errors", error);
    }
}
