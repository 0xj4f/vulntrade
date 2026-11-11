package com.vulntrade.gateway;

import com.vulntrade.security.JwtTokenProvider;
import com.vulntrade.security.logging.Outcome;
import com.vulntrade.security.logging.SecurityEvent;
import com.vulntrade.security.logging.SecurityEventLogger;
import io.jsonwebtoken.Claims;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import javax.servlet.http.HttpServletRequest;
import java.util.Map;

/**
 * "Who are you?" for the gateway. Same rules as the platform's JwtAuthFilter / ApiKeyAuthFilter:
 *
 *   JWT   Authorization: Bearer ... or ?token=        (VULN #56: role from the token body,
 *                                                      expired and alg:none tokens accepted)
 *   key   X-API-Key header or ?api_key=             (VULN #15/#16: looked up in plaintext,
 *                                                      by asking the platform service)
 */
@Component
public class GatewayAuth {

    /** The caller, or null when anonymous. */
    public static final class Caller {
        public final Long userId;
        public final String username;
        public final String role;

        Caller(Long userId, String username, String role) {
            this.userId = userId;
            this.username = username;
            this.role = role;
        }
    }

    private final JwtTokenProvider jwt;
    private final RestTemplate http;
    private final String platformUrl;

    public GatewayAuth(JwtTokenProvider jwt, RestTemplate http,
                       @Value("${gateway.platform-url:http://backend:8080}") String platformUrl) {
        this.jwt = jwt;
        this.http = http;
        this.platformUrl = platformUrl;
    }

    public Caller identify(HttpServletRequest request) {
        String token = null;
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            token = header.substring(7);
        } else if (request.getParameter("token") != null) {
            token = request.getParameter("token");   // VULN: token in the URL
        }
        if (token != null) {
            Claims claims = jwt.validateTokenAndLogFailure(token);
            if (claims != null) {
                Object uid = claims.get("userId");
                Long userId = uid instanceof Number ? ((Number) uid).longValue() : null;
                String role = claims.get("role") != null ? claims.get("role").toString() : "TRADER";
                SecurityEventLogger.rememberUser(userId, claims.getSubject());
                return new Caller(userId, claims.getSubject(), role);
            }
        }
        String apiKey = request.getHeader("X-API-Key");
        String source = "header";
        if (apiKey == null) {
            apiKey = request.getParameter("api_key");   // VULN: API key in the URL
            source = "query";
        }
        if (apiKey != null && !apiKey.isEmpty()) {
            return byApiKey(apiKey, source);
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private Caller byApiKey(String apiKey, String source) {
        try {
            Map<String, Object> u = http.getForObject(platformUrl + "/internal/apikey?key={k}", Map.class, apiKey);
            if (u != null && u.get("userId") != null) {
                Long userId = ((Number) u.get("userId")).longValue();
                String username = String.valueOf(u.get("username"));
                SecurityEventLogger.rememberUser(userId, username);
                SecurityEventLogger.log(SecurityEvent.API_KEY_USED, Outcome.SUCCESS,
                        SecurityEventLogger.details("source", source));
                return new Caller(userId, username, String.valueOf(u.get("role")));
            }
        } catch (Exception unknownKey) {
            // 404 from the platform: unknown key (never log the key itself)
        }
        SecurityEventLogger.log(SecurityEvent.API_KEY_USED, Outcome.FAILURE,
                SecurityEventLogger.details("source", source));
        return null;
    }
}
