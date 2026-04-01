package com.vulntrade.controller;

import com.vulntrade.model.User;
import com.vulntrade.repository.UserRepository;
import com.vulntrade.security.JwtTokenProvider;
import com.vulntrade.service.PortfolioService;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.*;

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
    private final PortfolioService portfolioService;

    public UserController(UserRepository userRepository,
                          JwtTokenProvider jwtTokenProvider,
                          PortfolioService portfolioService) {
        this.userRepository = userRepository;
        this.jwtTokenProvider = jwtTokenProvider;
        this.portfolioService = portfolioService;
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
        Map<String, Object> profile = new LinkedHashMap<>();
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

        // VULN #100: Full PII returned in API response (combined with existing IDOR = any user's PII)
        profile.put("accountLevel", user.getAccountLevel() != null ? user.getAccountLevel() : 1);
        profile.put("verified", user.getVerifiedAt() != null);
        profile.put("verifiedAt", user.getVerifiedAt());
        profile.put("firstName", user.getFirstName());
        profile.put("lastName", user.getLastName());
        profile.put("dateOfBirth", user.getDateOfBirth());
        profile.put("phoneNumber", user.getPhoneNumber());
        profile.put("ssn", user.getSsn());              // VULN #100: SSN exposed in API response!
        profile.put("addressLine1", user.getAddressLine1());
        profile.put("addressLine2", user.getAddressLine2());
        profile.put("city", user.getCity());
        profile.put("state", user.getState());
        profile.put("zipCode", user.getZipCode());
        profile.put("country", user.getCountry());
        profile.put("photoPath", user.getPhotoPath());   // VULN: server filesystem path leaked

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

        // Include positions from PortfolioService
        List<Map<String, Object>> positions = portfolioService.getPortfolio(userId);
        portfolio.put("positions", positions);

        return ResponseEntity.ok(portfolio);
    }

    // ========== Account Level & Verification Endpoints ==========

    /**
     * Update user profile with PII for verification.
     * VULN: IDOR - can update any user's profile (no ownership check).
     * VULN #98: Auto-verification with garbage/minimal data - any non-empty firstName triggers Level 2.
     * VULN #96: PII stored in plaintext.
     */
    @PutMapping("/{userId}/profile")
    public ResponseEntity<?> updateVerificationProfile(
            @PathVariable Long userId,
            @RequestBody Map<String, String> profileData) {
        // VULN: No ownership check - IDOR
        Optional<User> userOpt = userRepository.findById(userId);
        if (userOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        User user = userOpt.get();

        // Update PII fields (VULN #96: all stored in plaintext)
        if (profileData.containsKey("firstName")) user.setFirstName(profileData.get("firstName"));
        if (profileData.containsKey("lastName")) user.setLastName(profileData.get("lastName"));
        if (profileData.containsKey("dateOfBirth")) user.setDateOfBirth(profileData.get("dateOfBirth"));
        if (profileData.containsKey("phoneNumber")) user.setPhoneNumber(profileData.get("phoneNumber"));
        if (profileData.containsKey("ssn")) user.setSsn(profileData.get("ssn"));  // VULN #96: SSN plaintext
        if (profileData.containsKey("addressLine1")) user.setAddressLine1(profileData.get("addressLine1"));
        if (profileData.containsKey("addressLine2")) user.setAddressLine2(profileData.get("addressLine2"));
        if (profileData.containsKey("city")) user.setCity(profileData.get("city"));
        if (profileData.containsKey("state")) user.setState(profileData.get("state"));
        if (profileData.containsKey("zipCode")) user.setZipCode(profileData.get("zipCode"));
        if (profileData.containsKey("country")) user.setCountry(profileData.get("country"));

        // VULN #98: Auto-verification logic - intentionally weak
        // Any non-empty firstName is enough to trigger verification!
        // No document review, no approval process, no real validation
        if (user.getFirstName() != null && !user.getFirstName().trim().isEmpty()) {
            user.setAccountLevel(2);
            user.setVerifiedAt(LocalDateTime.now());
        }

        userRepository.save(user);

        // Generate new JWT with updated level/PII
        String newToken = jwtTokenProvider.generateToken(user);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("message", "Profile updated successfully");
        response.put("token", newToken);  // New JWT with updated claims
        response.put("accountLevel", user.getAccountLevel());
        response.put("verified", user.getVerifiedAt() != null);
        response.put("verifiedAt", user.getVerifiedAt());
        response.put("userId", user.getId());

        return ResponseEntity.ok(response);
    }

    /**
     * Upload profile photo / ID document.
     * VULN #95: No file type validation - accepts .jsp, .html, .exe, anything.
     * VULN #95: Original filename used directly - path traversal possible (../../etc/cron.d/evil).
     * VULN #97: IDOR - can upload photo for any user.
     */
    @PostMapping("/{userId}/photo")
    public ResponseEntity<?> uploadPhoto(
            @PathVariable Long userId,
            @RequestParam("file") MultipartFile file) {
        // VULN #97: No ownership check - IDOR
        Optional<User> userOpt = userRepository.findById(userId);
        if (userOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "File is empty"));
        }

        try {
            // VULN #95: No MIME type check, no extension check
            String uploadDir = "/uploads/photos/";

            // Create directory if it doesn't exist
            File dir = new File(uploadDir);
            dir.mkdirs();

            // Use a per-user filename so uploads don't collide across accounts.
            // VULN #95: Still no extension/content-type validation — any file type accepted.
            String filename = "user_" + userId + ".jpg";
            String filePath = uploadDir + filename;
            File destFile = new File(filePath);
            file.transferTo(destFile);

            // Public URL that <img> tags and future features (chat, leaderboard) can use
            String publicUrl = "/api/users/" + userId + "/photo";

            User user = userOpt.get();
            user.setPhotoPath(filePath);        // filesystem path used by GET /photo endpoint
            user.setPhotoFilename(filename);
            user.setProfilePic(publicUrl);      // persisted public URL — used by leaderboard/chat
            userRepository.save(user);

            Map<String, Object> response = new LinkedHashMap<>();
            response.put("message", "Photo uploaded successfully");
            response.put("photoUrl", publicUrl);
            response.put("size", file.getSize());
            response.put("contentType", file.getContentType());
            response.put("userId", userId);

            return ResponseEntity.ok(response);

        } catch (IOException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Upload failed: " + e.getMessage()));  // VULN: error details leaked
        }
    }

    /**
     * Get user's profile photo.
     * VULN #97: IDOR - any authenticated user can view any user's photo/ID document.
     */
    @GetMapping("/{userId}/photo")
    public ResponseEntity<?> getPhoto(@PathVariable Long userId) {
        // VULN #97: No ownership check - IDOR
        Optional<User> userOpt = userRepository.findById(userId);
        if (userOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        User user = userOpt.get();
        if (user.getPhotoPath() == null) {
            return ResponseEntity.notFound().build();
        }

        try {
            Path path = Paths.get(user.getPhotoPath());
            if (!Files.exists(path)) {
                return ResponseEntity.notFound().build();
            }

            Resource resource = new FileSystemResource(path);
            // VULN: No content-type validation - serves whatever was uploaded
            String contentType = Files.probeContentType(path);
            if (contentType == null) contentType = "application/octet-stream";

            return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(contentType))
                .body(resource);

        } catch (IOException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Failed to read photo: " + e.getMessage()));
        }
    }

    /**
     * Get verification status.
     * VULN: IDOR - can check any user's verification status.
     * VULN #100: Returns PII including SSN.
     */
    @GetMapping("/{userId}/verification-status")
    public ResponseEntity<?> getVerificationStatus(@PathVariable Long userId) {
        // VULN: No ownership check - IDOR
        Optional<User> userOpt = userRepository.findById(userId);
        if (userOpt.isEmpty()) {
            return ResponseEntity.notFound().build();
        }

        User user = userOpt.get();
        int level = user.getAccountLevel() != null ? user.getAccountLevel() : 1;

        // Determine which fields are missing for verification
        List<String> missingFields = new ArrayList<>();
        if (user.getFirstName() == null || user.getFirstName().isEmpty()) missingFields.add("firstName");
        if (user.getLastName() == null || user.getLastName().isEmpty()) missingFields.add("lastName");
        if (user.getDateOfBirth() == null || user.getDateOfBirth().isEmpty()) missingFields.add("dateOfBirth");
        if (user.getPhoneNumber() == null || user.getPhoneNumber().isEmpty()) missingFields.add("phoneNumber");
        if (user.getSsn() == null || user.getSsn().isEmpty()) missingFields.add("ssn");
        if (user.getAddressLine1() == null || user.getAddressLine1().isEmpty()) missingFields.add("address");
        if (user.getPhotoPath() == null) missingFields.add("photo");

        Map<String, Object> status = new LinkedHashMap<>();
        status.put("userId", userId);
        status.put("accountLevel", level);
        status.put("verified", user.getVerifiedAt() != null);
        status.put("verifiedAt", user.getVerifiedAt());
        status.put("hasPhoto", user.getPhotoPath() != null);
        status.put("missingFields", missingFields);
        status.put("totalFields", 7);
        status.put("completedFields", 7 - missingFields.size());
        // VULN #100: SSN leaked in verification status too
        status.put("ssn", user.getSsn());

        return ResponseEntity.ok(status);
    }
}
