package com.vulntrade.controller;

import com.vulntrade.model.PasswordResetToken;
import com.vulntrade.model.Transaction;
import com.vulntrade.model.User;
import com.vulntrade.model.dto.LoginRequest;
import com.vulntrade.model.dto.RegisterRequest;
import com.vulntrade.repository.PasswordResetTokenRepository;
import com.vulntrade.repository.TransactionRepository;
import com.vulntrade.repository.UserRepository;
import com.vulntrade.security.JwtTokenProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import javax.persistence.EntityManager;
import javax.persistence.PersistenceContext;
import javax.persistence.Query;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final Logger logger = LoggerFactory.getLogger(AuthController.class);

    private final UserRepository userRepository;
    private final JwtTokenProvider jwtTokenProvider;
    private final PasswordEncoder passwordEncoder;
    private final PasswordResetTokenRepository resetTokenRepository;
    private final TransactionRepository transactionRepository;

    @PersistenceContext
    private EntityManager entityManager;

    public AuthController(UserRepository userRepository,
                          JwtTokenProvider jwtTokenProvider,
                          PasswordEncoder passwordEncoder,
                          PasswordResetTokenRepository resetTokenRepository,
                          TransactionRepository transactionRepository) {
        this.userRepository = userRepository;
        this.jwtTokenProvider = jwtTokenProvider;
        this.passwordEncoder = passwordEncoder;
        this.resetTokenRepository = resetTokenRepository;
        this.transactionRepository = transactionRepository;
    }

    /**
     * Login endpoint.
     * VULN: User enumeration - different errors for "user not found" vs "wrong password".
     * VULN: No rate limiting.
     */
    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest request) {
        Optional<User> userOpt = userRepository.findByUsername(request.getUsername());
        if (userOpt.isEmpty()) {
            Map<String, String> error = new HashMap<>();
            error.put("error", "User not found");  // VULN: reveals user doesn't exist
            logger.warn("AUTH_LOGIN_FAIL: username={}, reason=user_not_found", request.getUsername());
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error);
        }

        User user = userOpt.get();
        String username = user.getUsername();
        if (!passwordEncoder.matches(request.getPassword(), user.getPasswordHash())) {
            Map<String, String> error = new HashMap<>();
            error.put("error", "Invalid password");  // VULN: reveals password is wrong
            logger.warn("AUTH_LOGIN_FAIL: username={}, reason=bad_password", username);
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(error);
        }

        if (!user.getIsActive()) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("error", "Account is disabled"));
        }

        // VULN #92/#93: Use fat JWT generator - includes accountLevel and PII for level 2
        String token = jwtTokenProvider.generateToken(user);

        Map<String, Object> response = new HashMap<>();
        response.put("token", token);
        response.put("userId", user.getId());
        response.put("username", user.getUsername());
        response.put("role", user.getRole());
        response.put("email", user.getEmail());
        response.put("balance", user.getBalance());
        response.put("apiKey", user.getApiKey());  // VULN: API key leaked in login response
        response.put("accountLevel", user.getAccountLevel() != null ? user.getAccountLevel() : 1);
        response.put("verified", user.getVerifiedAt() != null);
        response.put("firstName", user.getFirstName());
        response.put("profilePic", user.getProfilePic());

        logger.info("AUTH_LOGIN_SUCCESS: userId={}, username={}, role={}", user.getId(), user.getUsername(), user.getRole());

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
     * VULN: SQL injection login path.
     * Uses raw SQL concatenation for "legacy compatibility".
     */
    @PostMapping("/login-legacy")
    @SuppressWarnings("unchecked")
    public ResponseEntity<?> loginLegacy(@RequestBody LoginRequest request) {
        logger.info("AUTH_LOGIN_LEGACY: username={}", request.getUsername());
        try {
            // VULN: SQL injection - username concatenated directly into query
            String sql = "SELECT * FROM users WHERE username = '" + request.getUsername() + "'";
            Query query = entityManager.createNativeQuery(sql, User.class);
            List<User> users = query.getResultList();

            if (users.isEmpty()) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "User not found"));
            }

            User user = users.get(0);
            if (!passwordEncoder.matches(request.getPassword(), user.getPasswordHash())) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                    .body(Map.of("error", "Invalid password"));
            }

            String token = jwtTokenProvider.generateToken(user);  // VULN #92/#93: fat JWT

            Map<String, Object> response = new HashMap<>();
            response.put("token", token);
            response.put("userId", user.getId());
            response.put("username", user.getUsername());
            response.put("role", user.getRole());
            response.put("accountLevel", user.getAccountLevel() != null ? user.getAccountLevel() : 1);
            return ResponseEntity.ok(response);

        } catch (Exception e) {
            // VULN: Stack trace in error response aids SQL injection
            Map<String, String> error = new HashMap<>();
            error.put("error", "Login failed: " + e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
        }
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
        user.setRole(request.getRole() != null ? request.getRole() : "TRADER");
        user.setBalance(new BigDecimal("10000.00"));
        user.setIsActive(true);
        user.setApiKey("vt-api-" + System.currentTimeMillis());  // VULN: predictable API key
        user.setAccountLevel(1);  // New users start at Level 1 (BASIC)

        User saved = userRepository.save(user);
        User newUser = saved;
        logger.info("AUTH_REGISTER: userId={}, username={}, role={}", newUser.getId(), newUser.getUsername(), newUser.getRole());

        // Record initial signup bonus in transaction history
        Transaction signupBonus = new Transaction();
        signupBonus.setUserId(saved.getId());
        signupBonus.setType("DEPOSIT");
        signupBonus.setAmount(new BigDecimal("10000.00"));
        signupBonus.setBalanceAfter(new BigDecimal("10000.00"));
        signupBonus.setDescription("Initial signup bonus");
        signupBonus.setCreatedAt(LocalDateTime.now());
        transactionRepository.save(signupBonus);

        String token = jwtTokenProvider.generateToken(saved);  // VULN #92: accountLevel in JWT

        Map<String, Object> response = new HashMap<>();
        response.put("token", token);
        response.put("userId", saved.getId());
        response.put("username", saved.getUsername());
        response.put("role", saved.getRole());
        response.put("apiKey", saved.getApiKey());  // VULN: API key in response
        response.put("accountLevel", 1);
        response.put("verified", false);
        response.put("message", "Registration successful");

        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    /**
     * Password reset - request token.
     * VULN: Predictable reset token (timestamp-based).
     * VULN: Token leaked in response.
     * VULN: Token doesn't expire.
     */
    @PostMapping("/reset")
    public ResponseEntity<?> resetPassword(@RequestBody Map<String, String> request) {
        String email = request.get("email");
        Optional<User> userOpt = userRepository.findByEmail(email);

        logger.info("AUTH_RESET_REQUEST: email={}", email);

        Map<String, Object> response = new HashMap<>();
        response.put("message", "If the email exists, a reset link has been sent");

        if (userOpt.isPresent()) {
            User user = userOpt.get();

            // VULN: Predictable token based on timestamp
            String resetToken = String.valueOf(System.currentTimeMillis());

            PasswordResetToken prt = new PasswordResetToken();
            prt.setUserId(user.getId());
            prt.setToken(resetToken);
            resetTokenRepository.save(prt);

            // VULN: Token leaked in response body
            response.put("debug_token", resetToken);
            response.put("reset_url", "/api/auth/reset-confirm?token=" + resetToken);
        }

        return ResponseEntity.ok(response);
    }

    /**
     * Password reset - apply token.
     * VULN: Token never expires.
     * VULN: Token not invalidated after use (can be reused).
     */
    @PostMapping("/reset-confirm")
    public ResponseEntity<?> resetConfirm(@RequestBody Map<String, String> request) {
        String token = request.get("token");
        String newPassword = request.get("newPassword");

        if (token == null || newPassword == null) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "Token and newPassword required"));
        }

        Optional<PasswordResetToken> tokenOpt = resetTokenRepository.findByToken(token);
        if (tokenOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", "Invalid reset token"));
        }

        PasswordResetToken prt = tokenOpt.get();
        // VULN: No expiry check
        // VULN: Token not invalidated after use

        Optional<User> userOpt = userRepository.findById(prt.getUserId());
        if (userOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Map.of("error", "User not found"));
        }

        User user = userOpt.get();
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        userRepository.save(user);
        // VULN: Old JWT tokens are NOT invalidated

        return ResponseEntity.ok(Map.of(
            "message", "Password reset successful",
            "username", user.getUsername()
        ));
    }

    /**
     * Change password endpoint.
     * VULN: Old password NOT required.
     * VULN: Old JWT tokens NOT invalidated.
     */
    @PutMapping("/change-password")
    public ResponseEntity<?> changePassword(@RequestBody Map<String, String> request,
                                             @RequestHeader(value = "Authorization", required = false) String authHeader) {
        String newPassword = request.get("newPassword");
        // VULN: "oldPassword" field is accepted but NEVER verified

        if (newPassword == null) {
            return ResponseEntity.badRequest()
                .body(Map.of("error", "newPassword required"));
        }

        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Authentication required"));
        }

        String token = authHeader.substring(7);
        Long userId = jwtTokenProvider.getUserIdFromToken(token);
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid token"));
        }

        Optional<User> userOpt = userRepository.findById(userId);
        if (userOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Map.of("error", "User not found"));
        }

        User user = userOpt.get();
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        userRepository.save(user);
        // VULN: Old JWT still valid
        logger.info("AUTH_PASSWORD_CHANGE: userId={}", userId);

        return ResponseEntity.ok(Map.of(
            "message", "Password changed successfully",
            "warning", "You may want to re-login for a new token"
        ));
    }

    /**
     * Refresh JWT token from current DB state.
     * Used after profile update triggers account level change.
     */
    @PostMapping("/refresh-token")
    public ResponseEntity<?> refreshToken(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Authentication required"));
        }

        String oldToken = authHeader.substring(7);
        Long userId = jwtTokenProvider.getUserIdFromToken(oldToken);
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", "Invalid token"));
        }

        Optional<User> userOpt = userRepository.findById(userId);
        if (userOpt.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Map.of("error", "User not found"));
        }

        User user = userOpt.get();
        String newToken = jwtTokenProvider.generateToken(user);

        Map<String, Object> response = new HashMap<>();
        response.put("token", newToken);
        response.put("userId", user.getId());
        response.put("username", user.getUsername());
        response.put("role", user.getRole());
        response.put("email", user.getEmail());
        response.put("balance", user.getBalance());
        response.put("accountLevel", user.getAccountLevel() != null ? user.getAccountLevel() : 1);
        response.put("verified", user.getVerifiedAt() != null);
        response.put("firstName", user.getFirstName());

        return ResponseEntity.ok(response);
    }
}
