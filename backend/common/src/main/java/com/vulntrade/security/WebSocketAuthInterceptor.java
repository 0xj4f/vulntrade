package com.vulntrade.security;

import com.vulntrade.security.logging.SecurityEventLogger;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import javax.servlet.http.HttpServletRequest;
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

            rememberForSecurityLogging(servletRequest.getServletRequest(), attributes);

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

    /**
     * Keep the client's IP, user agent and Origin on the WebSocket session, so every later
     * STOMP security event can show them (STOMP frames have no HTTP request of their own).
     * Never put a null: the session map becomes a ConcurrentHashMap, which rejects nulls.
     */
    private void rememberForSecurityLogging(HttpServletRequest http, Map<String, Object> attributes) {
        String clientIp = SecurityEventLogger.clientIp(http);
        if (clientIp != null) {
            attributes.put(SecurityEventLogger.STOMP_CLIENT_IP, clientIp);
        }
        attributes.put(SecurityEventLogger.STOMP_USER_AGENT, SecurityEventLogger.userAgent(http));
        String origin = http.getHeader("Origin");
        if (origin != null) {
            attributes.put(SecurityEventLogger.STOMP_ORIGIN, origin);
        }
    }

    @Override
    public void afterHandshake(ServerHttpRequest request,
                                ServerHttpResponse response,
                                WebSocketHandler wsHandler,
                                Exception exception) {
        // No-op - VULN: no logging of WebSocket connections
    }
}
