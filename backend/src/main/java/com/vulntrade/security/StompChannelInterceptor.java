package com.vulntrade.security;

import io.jsonwebtoken.Claims;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;

import java.security.Principal;
import java.util.List;

/**
 * STOMP channel interceptor for message-level authentication.
 * 
 * VULN: /topic/admin/* subscribable by any authenticated user.
 * VULN: Missing authorization on several /app/ destinations.
 * VULN: Role checked from JWT body (modifiable by client).
 */
@Component
public class StompChannelInterceptor implements ChannelInterceptor {

    private static final Logger logger = LoggerFactory.getLogger(StompChannelInterceptor.class);
    private final JwtTokenProvider jwtTokenProvider;

    public StompChannelInterceptor(JwtTokenProvider jwtTokenProvider) {
        this.jwtTokenProvider = jwtTokenProvider;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);

        if (accessor == null) return message;

        StompCommand command = accessor.getCommand();

        if (StompCommand.CONNECT.equals(command)) {
            // Try to extract JWT from STOMP CONNECT headers
            List<String> authHeaders = accessor.getNativeHeader("Authorization");
            if (authHeaders != null && !authHeaders.isEmpty()) {
                String authHeader = authHeaders.get(0);
                if (authHeader.startsWith("Bearer ")) {
                    String token = authHeader.substring(7);
                    Claims claims = jwtTokenProvider.validateToken(token);
                    if (claims != null) {
                        String username = claims.getSubject();
                        Object userId = claims.get("userId");
                        String role = (String) claims.get("role");

                        // Set user principal for STOMP session
                        accessor.setUser(new StompPrincipal(username, userId, role));
                        logger.debug("STOMP CONNECT authenticated: user={}, role={}", username, role);
                    }
                }
            }

            // Also check for token in native headers
            List<String> tokenHeaders = accessor.getNativeHeader("token");
            if (tokenHeaders != null && !tokenHeaders.isEmpty() && accessor.getUser() == null) {
                String token = tokenHeaders.get(0);
                Claims claims = jwtTokenProvider.validateToken(token);
                if (claims != null) {
                    String username = claims.getSubject();
                    Object userId = claims.get("userId");
                    String role = (String) claims.get("role");
                    accessor.setUser(new StompPrincipal(username, userId, role));
                }
            }

            // VULN: If no auth provided, allow anonymous connection
            if (accessor.getUser() == null) {
                accessor.setUser(new StompPrincipal("anonymous", null, "ANONYMOUS"));
                logger.warn("Anonymous STOMP connection allowed");
            }
        }

        if (StompCommand.SUBSCRIBE.equals(command)) {
            String destination = accessor.getDestination();
            // VULN: /topic/admin/* is subscribable by any authenticated user
            // No authorization check on subscription destinations
            if (destination != null && destination.startsWith("/topic/admin/")) {
                logger.warn("User {} subscribing to admin channel: {}",
                        accessor.getUser() != null ? accessor.getUser().getName() : "unknown",
                        destination);
                // VULN: Should check for ADMIN role but doesn't
            }
        }

        if (StompCommand.SEND.equals(command)) {
            String destination = accessor.getDestination();
            // VULN: Missing authorization on /app/admin.* destinations
            // Only checks role from JWT body which is modifiable
            if (destination != null && destination.startsWith("/app/admin.")) {
                Principal user = accessor.getUser();
                if (user instanceof StompPrincipal) {
                    String role = ((StompPrincipal) user).getRole();
                    // VULN: Role comes from JWT token body - client can modify
                    if (!"ADMIN".equalsIgnoreCase(role)) {
                        logger.warn("Non-admin user {} attempted admin action: {}",
                                user.getName(), destination);
                        // VULN: We log but DON'T block the message
                        // In a real app, we should throw an exception here
                    }
                }
            }
        }

        return message;
    }

    /**
     * Custom Principal for STOMP sessions.
     */
    public static class StompPrincipal implements Principal {
        private final String name;
        private final Object userId;
        private final String role;

        public StompPrincipal(String name, Object userId, String role) {
            this.name = name;
            this.userId = userId;
            this.role = role;
        }

        @Override
        public String getName() {
            return name;
        }

        public Object getUserId() {
            return userId;
        }

        public String getRole() {
            return role;
        }

        public Long getUserIdAsLong() {
            if (userId instanceof Integer) {
                return ((Integer) userId).longValue();
            } else if (userId instanceof Long) {
                return (Long) userId;
            }
            return null;
        }
    }
}
