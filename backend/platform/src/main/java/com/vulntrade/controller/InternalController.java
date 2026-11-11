package com.vulntrade.controller;

import com.vulntrade.model.User;
import com.vulntrade.repository.UserRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.Optional;

/**
 * 1.0.0: endpoints other services call (never routed by nginx).
 *
 *   GET /internal/apikey?key=...   the trading gateways resolve an API key (X-API-Key / ?api_key=)
 *                                  to a user here, because only the platform owns the users table.
 */
@RestController
public class InternalController {

    private final UserRepository userRepository;

    public InternalController(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @GetMapping("/internal/apikey")
    public ResponseEntity<?> byApiKey(@RequestParam String key) {
        // VULN #16 (unchanged): API keys are stored and compared in plaintext
        Optional<User> user = userRepository.findFirstByApiKey(key);
        if (user.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        User u = user.get();
        return ResponseEntity.ok(Map.of("userId", u.getId(), "username", u.getUsername(), "role", u.getRole()));
    }
}
