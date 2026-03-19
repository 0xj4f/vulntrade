package com.vulntrade.controller;

import com.vulntrade.model.User;
import com.vulntrade.model.dto.LoginRequest;
import com.vulntrade.model.dto.RegisterRequest;
import com.vulntrade.repository.UserRepository;
import com.vulntrade.security.JwtTokenProvider;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final UserRepository userRepository;
    private final JwtTokenProvider jwtTokenProvider;
    private final PasswordEncoder passwordEncoder;

    public AuthController(UserRepository userRepository,
                          JwtTokenProvider jwtTokenProvider,
                          PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.jwtTokenProvider = jwtTokenProvider;
        this.passwordEncoder = passwordEncoder;
    }

    /**
     * Login endpoint.
     * VULN: User enumeration - different errors for "user not found" vs "wrong password".
     * VULN: No rate limiting.
     * VULN: SQL injection in alternate login path.
     */
    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest request) {
        // VULN: User enumeration
        Optional<User> userOpt = userRepository.findByUsername(request.getUsername());
        if (userOpt.isEmpty()) {
            Map<String, String> error = new HashMap<>();
            error.put("error", "User not found");  // VULN: reveals user doesn't exist
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error);
        }

        User user = userOpt.get();
        if (!passwordEncoder.matches(request.getPassword(), user.getPasswordHash())) {
            Map<String, String> error = new HashMap<>();
            error.put("error", "Invalid password");  // VULN: reveals password is wrong
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error);
        }

        String token = jwtTokenProvider.generateToken(
                user.getId(), user.getUsername(), user.getRole(), user.getEmail());

        Map<String, Object> response = new HashMap<>();
        response.put("token", token);
        response.put("userId", user.getId());
        response.put("username", user.getUsername());
        response.put("role", user.getRole());
        response.put("balance", user.getBalance());
        // VULN: Returns too much info including role

        return ResponseEntity.ok(response);
    }

    /**
     * VULN: Alternate login via GET with credentials in URL.
     */
    @GetMapping("/login")
    public ResponseEntity<?> loginGet(
            @RequestParam String username,
            @RequestParam String password) {
        LoginRequest request = new LoginRequest();
        request.setUsername(username);
        request.setPassword(password);
        return login(request);  // VULN: password in URL/access logs
    }

    /**
     * Register endpoint.
     * VULN: Mass assignment - can set role=ADMIN.
     * VULN: No email verification.
     * VULN: Allows duplicate usernames with different casing.
     */
    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody RegisterRequest request) {
        User user = new User();
        user.setUsername(request.getUsername());
        user.setPasswordHash(passwordEncoder.encode(request.getPassword()));
        user.setEmail(request.getEmail());
        // VULN: Mass assignment - role comes directly from request
        user.setRole(request.getRole() != null ? request.getRole() : "TRADER");
        user.setBalance(new BigDecimal("10000.00"));  // Starting balance
        user.setIsActive(true);

        User saved = userRepository.save(user);

        String token = jwtTokenProvider.generateToken(
                saved.getId(), saved.getUsername(), saved.getRole(), saved.getEmail());

        Map<String, Object> response = new HashMap<>();
        response.put("token", token);
        response.put("userId", saved.getId());
        response.put("username", saved.getUsername());
        response.put("role", saved.getRole());
        response.put("message", "Registration successful");

        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    /**
     * Password reset.
     * VULN: Predictable reset token (timestamp-based).
     * VULN: Token doesn't expire.
     */
    @PostMapping("/reset")
    public ResponseEntity<?> resetPassword(@RequestBody Map<String, String> request) {
        String email = request.get("email");
        Optional<User> userOpt = userRepository.findByEmail(email);

        // VULN: Always returns success (but token is predictable)
        String resetToken = String.valueOf(System.currentTimeMillis());  // VULN: predictable

        Map<String, String> response = new HashMap<>();
        response.put("message", "If the email exists, a reset link has been sent");
        response.put("debug_token", resetToken);  // VULN: token leaked in response
        return ResponseEntity.ok(response);
    }
}
