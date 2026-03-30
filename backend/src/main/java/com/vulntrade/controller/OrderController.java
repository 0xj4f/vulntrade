package com.vulntrade.controller;

import com.vulntrade.model.Order;
import com.vulntrade.model.dto.OrderRequest;
import com.vulntrade.repository.OrderRepository;
import com.vulntrade.security.JwtTokenProvider;
import com.vulntrade.service.OrderService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * REST Order Controller - alternative order placement to WebSocket/STOMP.
 */
@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final OrderRepository orderRepository;
    private final OrderService orderService;
    private final JwtTokenProvider jwtTokenProvider;

    public OrderController(OrderRepository orderRepository,
                           OrderService orderService,
                           JwtTokenProvider jwtTokenProvider) {
        this.orderRepository = orderRepository;
        this.orderService = orderService;
        this.jwtTokenProvider = jwtTokenProvider;
    }

    /**
     * Place a new order via REST.
     * Routes through OrderService for full validation (risk checks, matching).
     */
    @PostMapping
    public ResponseEntity<?> placeOrder(@RequestBody OrderRequest request,
                                        @RequestHeader(value = "Authorization", required = false) String authHeader) {
        Long userId = extractUserId(authHeader);
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Authentication required"));
        }

        try {
            Order order = orderService.placeOrder(userId, request);

            Map<String, Object> response = new HashMap<>();
            response.put("id", order.getId());
            response.put("orderId", order.getId());
            response.put("symbol", order.getSymbol());
            response.put("side", order.getSide());
            response.put("type", order.getOrderType());
            response.put("quantity", order.getQuantity());
            response.put("price", order.getPrice());
            response.put("status", order.getStatus());
            response.put("filledQty", order.getFilledQty());
            response.put("filledPrice", order.getFilledPrice());
            response.put("clientOrderId", order.getClientOrderId());
            response.put("createdAt", order.getCreatedAt());
            response.put("message", "Order placed successfully");

            return ResponseEntity.status(HttpStatus.CREATED).body(response);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Get order by ID.
     * VULN: IDOR - no ownership check. Any authenticated user can view any order.
     */
    @GetMapping("/{orderId}")
    public ResponseEntity<?> getOrder(@PathVariable Long orderId,
                                      @RequestHeader(value = "Authorization", required = false) String authHeader) {
        Long userId = extractUserId(authHeader);
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Authentication required"));
        }

        // VULN: No ownership check - any user can view any order
        return orderRepository.findById(orderId)
            .map(order -> {
                Map<String, Object> response = new HashMap<>();
                response.put("id", order.getId());
                response.put("userId", order.getUserId());      // VULN: leaks owner
                response.put("symbol", order.getSymbol());
                response.put("side", order.getSide());
                response.put("type", order.getOrderType());
                response.put("quantity", order.getQuantity());
                response.put("price", order.getPrice());
                response.put("status", order.getStatus());
                response.put("filledQty", order.getFilledQty());
                response.put("filledPrice", order.getFilledPrice());
                response.put("clientOrderId", order.getClientOrderId());
                response.put("createdAt", order.getCreatedAt());
                response.put("executedAt", order.getExecutedAt());
                return ResponseEntity.ok((Object) response);
            })
            .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Get all orders for the authenticated user (or any user via IDOR).
     * VULN: Optional userId param allows viewing any user's orders.
     */
    @GetMapping
    public ResponseEntity<?> getOrders(
            @RequestParam(value = "userId", required = false) Long targetUserId,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        Long userId = extractUserId(authHeader);
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Authentication required"));
        }

        // VULN: IDOR - if userId param provided, returns that user's orders
        Long lookupUserId = (targetUserId != null) ? targetUserId : userId;
        List<Order> orders = orderRepository.findByUserId(lookupUserId);
        return ResponseEntity.ok(orders);
    }

    /**
     * Cancel an order.
     * VULN: IDOR - can cancel any user's order by ID. No ownership check.
     */
    @PostMapping("/{orderId}/cancel")
    public ResponseEntity<?> cancelOrder(@PathVariable Long orderId,
                                         @RequestHeader(value = "Authorization", required = false) String authHeader) {
        Long userId = extractUserId(authHeader);
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Authentication required"));
        }

        return orderRepository.findById(orderId)
            .map(order -> {
                // VULN: No ownership check - any user can cancel any order
                if ("FILLED".equals(order.getStatus()) || "CANCELLED".equals(order.getStatus())) {
                    return ResponseEntity.badRequest()
                        .body((Object) Map.of("error", "Order already " + order.getStatus()));
                }

                order.setStatus("CANCELLED");
                orderRepository.save(order);

                Map<String, Object> response = new HashMap<>();
                response.put("id", order.getId());
                response.put("status", "CANCELLED");
                response.put("message", "Order cancelled");
                response.put("originalUserId", order.getUserId()); // VULN: leaks original owner
                return ResponseEntity.ok((Object) response);
            })
            .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Delete an order (hard delete).
     * VULN: IDOR + destructive operation without ownership check.
     */
    @DeleteMapping("/{orderId}")
    public ResponseEntity<?> deleteOrder(@PathVariable Long orderId,
                                         @RequestHeader(value = "Authorization", required = false) String authHeader) {
        Long userId = extractUserId(authHeader);
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Authentication required"));
        }

        // VULN: No ownership check - any user can delete any order
        if (orderRepository.existsById(orderId)) {
            orderRepository.deleteById(orderId);
            return ResponseEntity.ok(Map.of("message", "Order deleted", "orderId", orderId));
        }
        return ResponseEntity.notFound().build();
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
}
