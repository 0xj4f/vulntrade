package com.vulntrade.security;

import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * VULN: Weak WebSocket authentication interceptor.
 * - JWT checked on connect only, never revalidated after
 * - Session ID is predictable (sequential integer)
 * - No concurrent session limit
 * - Token extracted from query param (visible in logs)
 */
@Component
public class WebSocketAuthInterceptor implements HandshakeInterceptor {

    private final JwtTokenProvider jwtTokenProvider;

    // VULN: Predictable sequential session ID
    private static final AtomicLong SESSION_COUNTER = new AtomicLong(1000);

    public WebSocketAuthInterceptor(JwtTokenProvider jwtTokenProvider) {
        this.jwtTokenProvider = jwtTokenProvider;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request,
                                    ServerHttpResponse response,
                                    WebSocketHandler wsHandler,
                                    Map<String, Object> attributes) throws Exception {

        // VULN: Predictable session ID
        long sessionId = SESSION_COUNTER.incrementAndGet();
        attributes.put("sessionId", sessionId);

        // Extract JWT from query parameter or header
        String token = null;

        if (request instanceof ServletServerHttpRequest) {
            ServletServerHttpRequest servletRequest = (ServletServerHttpRequest) request;

            // VULN: Token in URL query parameter
            token = servletRequest.getServletRequest().getParameter("token");

            if (token == null) {
                String authHeader = servletRequest.getServletRequest().getHeader("Authorization");
                if (authHeader != null && authHeader.startsWith("Bearer ")) {
                    token = authHeader.substring(7);
                }
            }
        }

        if (token != null) {
            io.jsonwebtoken.Claims claims = jwtTokenProvider.validateToken(token);
            if (claims != null) {
                attributes.put("username", claims.getSubject());
                attributes.put("userId", claims.get("userId"));
                attributes.put("role", claims.get("role"));
                attributes.put("token", token);
                // VULN: Token stored in session attributes but NEVER revalidated
                // If token is revoked/expired later, WS session stays active
                return true;
            }
        }

        // VULN: Allow unauthenticated connections anyway (weak enforcement)
        // In a real app this should return false
        attributes.put("username", "anonymous");
        attributes.put("role", "ANONYMOUS");
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request,
                                ServerHttpResponse response,
                                WebSocketHandler wsHandler,
                                Exception exception) {
        // No-op - VULN: no logging of WebSocket connections
    }
}
