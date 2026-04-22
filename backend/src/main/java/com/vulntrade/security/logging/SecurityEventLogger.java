package com.vulntrade.security.logging;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import javax.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * VulnTrade security event logger.
 *
 * <p>Emits high-signal, structured JSON events to the {@code security.log}
 * sink via the dedicated {@code SECURITY_EVENTS} Log4j2 logger. The catalog
 * of events and their meaning is documented in {@code docs/security-events.md}.
 *
 * <p>Design rules:
 * <ul>
 *   <li><b>Additive.</b> Never call this to replace an existing
 *       {@code logger.info} — add it alongside. The application's normal
 *       {@code app.log} output is untouched.</li>
 *   <li><b>High-signal only.</b> If a normal user doing normal things would
 *       trigger this, it's the wrong event — revisit the catalog.</li>
 *   <li><b>Never throws.</b> A broken logger must not break the request.
 *       All code paths are wrapped.</li>
 * </ul>
 *
 * <p>Typical usage:
 * <pre>{@code
 *   SecurityEventLogger.log("AUTH_LOGIN_FAIL", "FAILURE",
 *       Map.of("reason", "bad_password", "attemptedUsername", username));
 * }</pre>
 */
public final class SecurityEventLogger {

    private static final Logger LOG = LoggerFactory.getLogger("SECURITY_EVENTS");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private SecurityEventLogger() { /* utility */ }

    /**
     * Emit a security event with caller-supplied details.
     *
     * @param eventType canonical name from docs/security-events.md (e.g. AUTH_LOGIN_FAIL)
     * @param outcome   SUCCESS / FAILURE / DENIED / ATTEMPT / UNKNOWN
     * @param details   event-specific fields; keys should be camelCase; values
     *                  should be JSON-friendly primitives or Maps. May be null.
     */
    public static void log(String eventType, String outcome, Map<String, Object> details) {
        try {
            Map<String, Object> event = new LinkedHashMap<>();
            event.put("@timestamp", Instant.now().toString());
            event.put("eventType", eventType == null ? "UNKNOWN" : eventType);
            event.put("outcome", outcome == null ? "UNKNOWN" : outcome);

            populateUser(event);
            populateHttp(event);

            if (details != null && !details.isEmpty()) {
                event.put("details", details);
            }

            LOG.info(MAPPER.writeValueAsString(event));
        } catch (Throwable ignored) {
            // Logging must never break the request path.
        }
    }

    /** Overload for events that have no caller-supplied details. */
    public static void log(String eventType, String outcome) {
        log(eventType, outcome, null);
    }

    /**
     * Pull username from the Spring Security context if the caller is
     * authenticated. No-op for anonymous callers.
     */
    private static void populateUser(Map<String, Object> event) {
        try {
            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth != null && auth.isAuthenticated()) {
                Object principal = auth.getPrincipal();
                if (principal != null && !"anonymousUser".equals(principal)) {
                    event.put("username", auth.getName());
                }
            }
        } catch (Throwable ignored) {
            // best-effort only
        }
    }

    /**
     * If this call happens inside an HTTP request thread, attach the method,
     * path, and client IP. STOMP listener threads simply won't have a
     * RequestAttributes and these fields will be absent — which is fine.
     */
    private static void populateHttp(Map<String, Object> event) {
        try {
            RequestAttributes ra = RequestContextHolder.getRequestAttributes();
            if (ra instanceof ServletRequestAttributes) {
                HttpServletRequest req = ((ServletRequestAttributes) ra).getRequest();
                event.put("transport", "HTTP");
                event.put("httpMethod", req.getMethod());
                event.put("path", req.getRequestURI());
                event.put("clientIp", extractClientIp(req));
            }
        } catch (Throwable ignored) {
            // best-effort only
        }
    }

    /**
     * X-Forwarded-For aware client IP extraction. Trusts only the first hop
     * because downstream values are attacker-controllable. For STOMP or
     * scheduler threads this path isn't reached (no HttpServletRequest).
     */
    private static String extractClientIp(HttpServletRequest req) {
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isEmpty()) {
            int comma = xff.indexOf(',');
            return (comma > 0 ? xff.substring(0, comma) : xff).trim();
        }
        return req.getRemoteAddr();
    }
}
