package com.vulntrade.controller;

import com.vulntrade.repository.SymbolRepository;
import com.vulntrade.repository.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class HealthController {

    private final UserRepository userRepository;
    private final SymbolRepository symbolRepository;

    @Value("${flags.flag1:}")
    private String flag1;

    public HealthController(UserRepository userRepository,
                            SymbolRepository symbolRepository) {
        this.userRepository = userRepository;
        this.symbolRepository = symbolRepository;
    }

    @GetMapping("/health")
    public ResponseEntity<?> health() {
        Map<String, Object> status = new HashMap<>();
        status.put("status", "UP");
        status.put("timestamp", LocalDateTime.now().toString());
        status.put("service", "vulntrade-backend");

        try {
            long userCount = userRepository.count();
            long symbolCount = symbolRepository.count();
            status.put("database", "connected");
            status.put("users", userCount);
            status.put("symbols", symbolCount);
        } catch (Exception e) {
            status.put("database", "error: " + e.getMessage());
        }

        return ResponseEntity.ok(status);
    }
}
