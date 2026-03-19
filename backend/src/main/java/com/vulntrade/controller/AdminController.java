package com.vulntrade.controller;

import com.vulntrade.model.User;
import com.vulntrade.repository.UserRepository;
import com.vulntrade.repository.CustomQueryRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Admin controller.
 * VULN: Role check can be bypassed via X-HTTP-Method-Override header.
 * VULN: Some endpoints have broken access control.
 */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private final UserRepository userRepository;
    private final CustomQueryRepository customQueryRepository;

    public AdminController(UserRepository userRepository,
                           CustomQueryRepository customQueryRepository) {
        this.userRepository = userRepository;
        this.customQueryRepository = customQueryRepository;
    }

    /**
     * List all users.
     * VULN: Role check in Spring Security filter can be bypassed
     * via X-HTTP-Method-Override header (POST → GET).
     * The SecurityConfig only restricts based on HTTP method,
     * but the method override header changes the effective method.
     */
    @GetMapping("/users")
    public ResponseEntity<?> listUsers() {
        List<User> users = userRepository.findAll();

        // Map to response objects (still leaks too much)
        List<Map<String, Object>> userList = users.stream().map(u -> {
            Map<String, Object> userMap = new HashMap<>();
            userMap.put("id", u.getId());
            userMap.put("username", u.getUsername());
            userMap.put("email", u.getEmail());
            userMap.put("role", u.getRole());
            userMap.put("balance", u.getBalance());
            userMap.put("isActive", u.getIsActive());
            userMap.put("apiKey", u.getApiKey());      // VULN: API keys exposed
            userMap.put("notes", u.getNotes());         // VULN: notes with flags
            userMap.put("createdAt", u.getCreatedAt());
            return userMap;
        }).collect(Collectors.toList());

        return ResponseEntity.ok(userList);
    }

    /**
     * Execute raw SQL query.
     * VULN: SQL injection playground.
     * VULN: Supposedly admin-only but broken access control.
     */
    @PostMapping("/execute-query")
    public ResponseEntity<?> executeQuery(@RequestBody Map<String, String> request) {
        String sql = request.get("sql");
        if (sql == null || sql.isEmpty()) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "SQL query required"));
        }

        try {
            // VULN: Executes arbitrary SQL
            if (sql.trim().toUpperCase().startsWith("SELECT")) {
                List<Object[]> results = customQueryRepository.executeRawQuery(sql);
                return ResponseEntity.ok(Map.of(
                    "results", results,
                    "count", results.size()
                ));
            } else {
                int affected = customQueryRepository.executeRawUpdate(sql);
                return ResponseEntity.ok(Map.of(
                    "message", "Query executed",
                    "rowsAffected", affected
                ));
            }
        } catch (Exception e) {
            // VULN: Error message reveals database structure
            return ResponseEntity.status(500)
                .body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Disable/enable user account.
     * VULN: No proper authorization check.
     */
    @PutMapping("/users/{userId}/toggle")
    public ResponseEntity<?> toggleUser(@PathVariable Long userId) {
        return userRepository.findById(userId)
            .map(user -> {
                user.setIsActive(!user.getIsActive());
                userRepository.save(user);
                return ResponseEntity.ok(Map.of(
                    "message", "User " + (user.getIsActive() ? "enabled" : "disabled"),
                    "userId", userId,
                    "isActive", user.getIsActive()
                ));
            })
            .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Adjust user balance.
     * VULN: Authorization check uses JWT role from token body (modifiable by client).
     */
    @PostMapping("/adjust-balance")
    public ResponseEntity<?> adjustBalance(@RequestBody Map<String, Object> request) {
        Long userId = Long.valueOf(request.get("userId").toString());
        Double amount = Double.valueOf(request.get("amount").toString());
        String reason = (String) request.get("reason");

        return userRepository.findById(userId)
            .map(user -> {
                java.math.BigDecimal adjustment = java.math.BigDecimal.valueOf(amount);
                user.setBalance(user.getBalance().add(adjustment));
                userRepository.save(user);

                // VULN: reason field logged without sanitization (log injection)
                System.out.println("[ADMIN] Balance adjusted for user " + userId
                    + " by " + amount + " reason: " + reason);

                return ResponseEntity.ok(Map.of(
                    "message", "Balance adjusted",
                    "userId", userId,
                    "newBalance", user.getBalance(),
                    "adjustment", amount
                ));
            })
            .orElse(ResponseEntity.notFound().build());
    }
}
