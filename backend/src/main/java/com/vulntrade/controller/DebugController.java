package com.vulntrade.controller;

import com.vulntrade.model.User;
import com.vulntrade.repository.CustomQueryRepository;
import com.vulntrade.repository.UserRepository;
import com.vulntrade.security.logging.SecurityEventLogger;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * VULN: Debug endpoints with RCE, info disclosure.
 * "Protected" by hardcoded debug key.
 */
@RestController
@RequestMapping("/api/debug")
public class DebugController {

    @Value("${debug.key:vulntrade-debug-key-2024}")
    private String debugKey;

    private final UserRepository userRepository;
    private final CustomQueryRepository customQueryRepository;

    public DebugController(UserRepository userRepository,
                           CustomQueryRepository customQueryRepository) {
        this.userRepository = userRepository;
        this.customQueryRepository = customQueryRepository;
    }

    /**
     * VULN: Returns full user object including password hash.
     */
    @GetMapping("/user-info")
    public ResponseEntity<?> getUserInfo(@RequestParam(required = false) Long userId) {
        SecurityEventLogger.log("DEBUG_ENDPOINT_ACCESSED", "SUCCESS", Map.of("endpoint", "user-info", "userIdParam", String.valueOf(userId)));
        if (userId != null) {
            Optional<User> user = userRepository.findById(userId);
            return user.map(u -> ResponseEntity.ok((Object) u))
                    .orElse(ResponseEntity.notFound().build());
        }
        // Return all users if no ID specified
        return ResponseEntity.ok(userRepository.findAll());
    }

    /**
     * VULN: Remote Code Execution via Runtime.exec().
     * "Protected" by hardcoded debug key in source code.
     */
    @PostMapping("/execute")
    public ResponseEntity<?> execute(@RequestHeader(value = "X-Debug-Key", required = false) String key,
                                      @RequestBody Map<String, String> request) {
        SecurityEventLogger.log("DEBUG_ENDPOINT_ACCESSED", "SUCCESS", Map.of("endpoint", "execute", "keyPresented", key != null));
        // VULN: Hardcoded key check - key is in source code and application.yml
        if (!debugKey.equals(key)) {
            return ResponseEntity.status(403).body(Map.of("error", "Invalid debug key"));
        }

        String command = request.get("command");
        if (command == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "No command provided"));
        }

        try {
            // VULN: Direct command execution - RCE
            Process process = Runtime.getRuntime().exec(new String[]{"/bin/sh", "-c", command});
            byte[] output = process.getInputStream().readAllBytes();
            byte[] error = process.getErrorStream().readAllBytes();
            int exitCode = process.waitFor();

            Map<String, Object> result = new HashMap<>();
            result.put("stdout", new String(output));
            result.put("stderr", new String(error));
            result.put("exitCode", exitCode);
            SecurityEventLogger.log("DEBUG_RCE_EXECUTED", "SUCCESS", Map.of(
                    "commandPreview", command.length() > 200 ? command.substring(0, 200) : command,
                    "exitCode", exitCode));
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * VULN: Raw SQL execution endpoint.
     */
    @PostMapping("/query")
    public ResponseEntity<?> executeQuery(@RequestHeader(value = "X-Debug-Key", required = false) String key,
                                           @RequestBody Map<String, String> request) {
        if (!debugKey.equals(key)) {
            return ResponseEntity.status(403).body(Map.of("error", "Invalid debug key"));
        }

        String sql = request.get("sql");
        if (sql == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "No SQL provided"));
        }

        try {
            List<Object[]> results = customQueryRepository.executeRawQuery(sql);
            return ResponseEntity.ok(results);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }
}
