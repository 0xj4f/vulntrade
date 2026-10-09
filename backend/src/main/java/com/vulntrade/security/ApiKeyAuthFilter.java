package com.vulntrade.security;

import com.vulntrade.model.User;
import com.vulntrade.repository.UserRepository;
import com.vulntrade.security.logging.Outcome;
import com.vulntrade.security.logging.SecurityEvent;
import com.vulntrade.security.logging.SecurityEventLogger;
import org.springframework.core.annotation.Order;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Collections;
import java.util.Optional;

/**
 * VULN: API key authentication filter.
 * - API keys stored in plaintext in DB
 * - API key accepted in URL query parameter (logged in access logs)
 * - API key accepted in X-API-Key header
 * - No rate limiting on API key auth
 */
@Component
@Order(2)
public class ApiKeyAuthFilter extends OncePerRequestFilter {

    private final UserRepository userRepository;

    public ApiKeyAuthFilter(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                     HttpServletResponse response,
                                     FilterChain filterChain)
            throws ServletException, IOException {

        // Only process if no JWT auth already set
        if (SecurityContextHolder.getContext().getAuthentication() == null) {
            String apiKey = extractApiKey(request);

            if (apiKey != null && !apiKey.isEmpty()) {
                // VULN: API key stored in plaintext, looked up directly
                Optional<User> userOpt = userRepository.findFirstByApiKey(apiKey);

                if (userOpt.isPresent()) {
                    User user = userOpt.get();

                    UsernamePasswordAuthenticationToken auth =
                        new UsernamePasswordAuthenticationToken(
                            user.getUsername(),
                            null,
                            Collections.singletonList(
                                new SimpleGrantedAuthority("ROLE_" + user.getRole()))
                        );

                    // Store user ID in details
                    auth.setDetails(user);
                    SecurityContextHolder.getContext().setAuthentication(auth);
                    SecurityEventLogger.rememberUser(user.getId(), user.getUsername());
                    SecurityEventLogger.log(SecurityEvent.API_KEY_USED, Outcome.SUCCESS,
                            SecurityEventLogger.details("source", keySource(request)));
                } else {
                    // Unknown key. Never log the key itself.
                    SecurityEventLogger.log(SecurityEvent.API_KEY_USED, Outcome.FAILURE,
                            SecurityEventLogger.details("source", keySource(request)));
                }
            }
        }

        filterChain.doFilter(request, response);
    }

    /** Where the key came from: "header" (X-API-Key) or "query" (?api_key=). */
    private String keySource(HttpServletRequest request) {
        return request.getHeader("X-API-Key") != null ? "header" : "query";
    }

    private String extractApiKey(HttpServletRequest request) {
        // Check X-API-Key header
        String apiKey = request.getHeader("X-API-Key");
        if (apiKey != null) {
            return apiKey;
        }

        // VULN: API key in URL query parameter (visible in logs, browser history, referrer)
        apiKey = request.getParameter("api_key");
        if (apiKey != null) {
            return apiKey;
        }

        return null;
    }
}
