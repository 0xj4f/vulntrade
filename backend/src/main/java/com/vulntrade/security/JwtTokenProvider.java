package com.vulntrade.security;

import io.jsonwebtoken.*;
import io.jsonwebtoken.impl.DefaultClaims;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Date;
import java.util.HashMap;
import java.util.Map;

@Component
public class JwtTokenProvider {

    // VULN: Weak secret, configurable but defaults to something guessable
    @Value("${jwt.secret:vulntrade-secret}")
    private String jwtSecret;

    @Value("${jwt.expiration:86400000}")
    private long jwtExpiration;

    /**
     * Generate JWT token.
     * VULN: Token contains full user info including role (modifiable by client).
     * VULN: Uses HS256 with weak secret.
     */
    public String generateToken(Long userId, String username, String role, String email) {
        Map<String, Object> claims = new HashMap<>();
        claims.put("userId", userId);
        claims.put("username", username);
        claims.put("role", role);        // VULN: role in token body
        claims.put("email", email);      // VULN: PII in token

        return Jwts.builder()
                .setClaims(claims)
                .setSubject(username)
                .setIssuedAt(new Date())
                .setExpiration(new Date(System.currentTimeMillis() + jwtExpiration))
                .signWith(SignatureAlgorithm.HS256, jwtSecret)  // VULN: weak secret
                .compact();
    }

    /**
     * Validate and parse JWT token.
     * VULN: Accepts alg:none tokens.
     * VULN: Doesn't properly validate expiration.
     */
    public Claims validateToken(String token) {
        try {
            // VULN: This parser configuration accepts alg:none
            // In jjwt 0.9.1, if you don't set the signing key properly,
            // unsigned tokens may be accepted
            return Jwts.parser()
                    .setSigningKey(jwtSecret)
                    .parseClaimsJws(token)
                    .getBody();
        } catch (ExpiredJwtException e) {
            // VULN: Return claims even if token is expired!
            return e.getClaims();
        } catch (UnsupportedJwtException e) {
            // VULN: Try parsing as unsigned token (alg:none)
            try {
                String[] parts = token.split("\\.");
                if (parts.length >= 2) {
                    String payload = new String(java.util.Base64.getUrlDecoder().decode(parts[1]));
                    // Parse the payload manually - extremely dangerous
                    com.fasterxml.jackson.databind.ObjectMapper mapper = 
                        new com.fasterxml.jackson.databind.ObjectMapper();
                    @SuppressWarnings("unchecked")
                    Map<String, Object> claimsMap = mapper.readValue(payload, Map.class);
                    DefaultClaims claims = new DefaultClaims(claimsMap);
                    return claims;
                }
            } catch (Exception ex) {
                // Fall through
            }
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    public String getUsernameFromToken(String token) {
        Claims claims = validateToken(token);
        return claims != null ? claims.getSubject() : null;
    }

    public Long getUserIdFromToken(String token) {
        Claims claims = validateToken(token);
        if (claims != null) {
            Object userId = claims.get("userId");
            if (userId instanceof Integer) {
                return ((Integer) userId).longValue();
            } else if (userId instanceof Long) {
                return (Long) userId;
            }
        }
        return null;
    }

    public String getRoleFromToken(String token) {
        Claims claims = validateToken(token);
        return claims != null ? (String) claims.get("role") : null;
    }
}
