package com.vulntrade.controller;

import com.vulntrade.model.User;
import com.vulntrade.repository.UserRepository;
import com.vulntrade.security.JwtTokenProvider;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * User profile controller.
 * VULN: IDOR - any authenticated user can view any other user's profile.
 * VULN: Email change without verification.
 */
@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserRepository userRepository;
    private final JwtTokenProvider jwtTokenProvider;

    public UserController(UserRepository userRepository,
                          JwtTokenProvider jwtTokenProvider) {
        this.userRepository = userRepository;
        this.jwtTokenProvider = jwtTokenProvider;
    }

    /**
     * Get user profile.
     * VULN: IDOR - no ownership check. Any authenticated user can view any profile.
     * This exposes notes (which contain flags), API keys, etc.
     */
    @GetMapping("/{userId}")
    public ResponseEntity<?> getUserProfile(@PathVariable Long userId) {
        // VULN: No check that the requesting user owns this profile
        Optional<User> userOpt = userRepository.findById(userId);
        if (userOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        User user = userOpt.get();

        // Return full user object including sensitive fields
        Map<String, Object> profile = new HashMap<>();
        profile.put("id", user.getId());
        profile.put("username", user.getUsername());
        profile.put("email", user.getEmail());
        profile.put("role", user.getRole());
        profile.put("balance", user.getBalance());
        profile.put("notes", user.getNotes());        // VULN: Flag 2 in admin's notes
        profile.put("apiKey", user.getApiKey());       // VULN: API key exposed
        profile.put("isActive", user.getIsActive());
        profile.put("createdAt", user.getCreatedAt());
        profile.put("profilePic", user.getProfilePic());

        return ResponseEntity.ok(profile);
    }

    /**
     * Get own profile (from JWT).
     */
    @GetMapping("/me")
    public ResponseEntity<?> getMyProfile(
            @RequestHeader(value = "Authorization", required = false) String authHeader) {

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

        return getUserProfile(userId);  // Reuse the IDOR-vulnerable method
    }

    /**
     * Update user profile.
     * VULN: Email change without verification.
     * VULN: Can update other users' profiles (IDOR).
     */
    @PutMapping("/{userId}")
    public ResponseEntity<?> updateProfile(@PathVariable Long userId,
                                            @RequestBody Map<String, String> updates) {
        // VULN: No ownership check
        Optional<User> userOpt = userRepository.findById(userId);
        if (userOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        User user = userOpt.get();

        // VULN: Email change without verification
        if (updates.containsKey("email")) {
            user.setEmail(updates.get("email"));
        }
        if (updates.containsKey("profilePic")) {
            user.setProfilePic(updates.get("profilePic"));
        }
        // VULN: Can update notes (where flags are stored)
        if (updates.containsKey("notes")) {
            user.setNotes(updates.get("notes"));
        }

        userRepository.save(user);

        return ResponseEntity.ok(Map.of(
            "message", "Profile updated",
            "userId", userId
        ));
    }

    /**
     * Get user's portfolio (positions).
     * VULN: IDOR - accessible to any authenticated user.
     */
    @GetMapping("/{userId}/portfolio")
    public ResponseEntity<?> getUserPortfolio(@PathVariable Long userId) {
        // VULN: No ownership check - any user can view any portfolio
        Optional<User> userOpt = userRepository.findById(userId);
        if (userOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        Map<String, Object> portfolio = new HashMap<>();
        portfolio.put("userId", userId);
        portfolio.put("username", userOpt.get().getUsername());
        portfolio.put("balance", userOpt.get().getBalance());
        portfolio.put("notes", userOpt.get().getNotes());  // VULN: leaks notes with flags

        return ResponseEntity.ok(portfolio);
    }
}
