package com.vulntrade.security.logging;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.vulntrade.security.StompChannelInterceptor.StompPrincipal;
import io.jsonwebtoken.Claims;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpAttributes;
import org.springframework.messaging.simp.SimpAttributesContextHolder;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.security.core.Authentication;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import javax.servlet.http.HttpServletRequest;
import java.security.Principal;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Writes VulnTrade security events to security.log, one JSON object per line.
 *
 * <p>The rules (docs/logging-guide.md §3), in short:
 * <ul>
 *   <li>One dumb fact per action, logged where the outcome is known. Wazuh does the thinking.</li>
 *   <li>Who / where / when is filled in automatically. You only pass the event, the outcome
 *       and the event-specific {@code details}.</li>
 *   <li>Never log secrets (passwords, tokens, API keys, exception messages).</li>
 *   <li>Logging never throws. A broken logger must not break the request.</li>
 * </ul>
 *
 * <p>Typical use:
 * <pre>{@code
 *   log(SecurityEvent.ORDER_CANCELLED, Outcome.SUCCESS,
 *       details("orderId", order.getId(), "targetUserId", order.getUserId(),
 *               "isOwner", isOwner(order.getUserId())));
 * }</pre>
 *
 * <p>Where the automatic fields come from:
 * <ul>
 *   <li>HTTP: the current request (RequestContextHolder), the request id set by
 *       {@link RequestLoggingFilter}, and the user remembered by the auth filters.</li>
 *   <li>STOMP: Spring's SimpAttributesContextHolder (the WebSocket session), filled at the
 *       handshake (IP, user agent, origin) and at CONNECT (user).</li>
 * </ul>
 */
public final class SecurityEventLogger {

    private static final Logger SECURITY_LOG = LoggerFactory.getLogger("SECURITY_EVENTS");
    private static final Logger APP_LOG = LoggerFactory.getLogger(SecurityEventLogger.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final DateTimeFormatter TIMESTAMP =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);
    private static final String ENVIRONMENT = System.getenv().getOrDefault("APP_ENVIRONMENT", "production");
    private static final int MAX_TEXT_LENGTH = 1000;

    // HTTP request attributes, set by RequestLoggingFilter and rememberUser().
    static final String REQUEST_ID = "securityLog.requestId";
    static final String OUTCOME_LOGGED = "securityLog.outcomeLogged";
    private static final String USER_ID = "securityLog.userId";
    private static final String USERNAME = "securityLog.username";

    // STOMP session attributes, set at the WebSocket handshake and at CONNECT.
    // They use their own names so the code that reads "userId" / "username" / "role" is untouched.
    public static final String STOMP_CLIENT_IP = "log.clientIp";
    public static final String STOMP_USER_AGENT = "log.userAgent";
    public static final String STOMP_ORIGIN = "log.origin";
    private static final String STOMP_USER_ID = "log.userId";
    private static final String STOMP_USERNAME = "log.username";

    private SecurityEventLogger() { /* static helper */ }

    // ------------------------------------------------------------------
    // Logging
    // ------------------------------------------------------------------

    /** Log an event. The user, IP, path, ... are filled in automatically. */
    public static void log(SecurityEvent event, Outcome outcome, Map<String, Object> details) {
        write(event, outcome, details, false, null, null, null, null);
    }

    /**
     * Log an event for a user who is not logged in yet: login_*, account_created,
     * password_reset_*. Pass {@code null, null} on a failure (nobody is logged in).
     */
    public static void logAs(Long userId, String username,
                             SecurityEvent event, Outcome outcome, Map<String, Object> details) {
        write(event, outcome, details, true, userId, username, null, null);
    }

    /**
     * Log an event from code that holds the STOMP message (interceptors, @MessageMapping
     * handlers). Adds {@code path} = the STOMP destination and takes the user from the
     * message's principal.
     */
    public static void logStomp(SimpMessageHeaderAccessor accessor,
                                SecurityEvent event, Outcome outcome, Map<String, Object> details) {
        Principal user = accessor == null ? null : accessor.getUser();
        String destination = accessor == null ? null : accessor.getDestination();
        if (user == null) {
            write(event, outcome, details, false, null, null, destination, null);
        } else {
            write(event, outcome, details, true, userIdOf(user), user.getName(), destination, null);
        }
    }

    /** Used only by RequestLoggingFilter: the end-of-request fallback, which knows the status. */
    static void logRequestResult(SecurityEvent event, Outcome outcome, int httpStatus,
                                 Map<String, Object> details) {
        write(event, outcome, details, false, null, null, null, httpStatus);
    }

    /** Used only by RequestLoggingFilter: did the code already log what happened? */
    static boolean outcomeEventLogged(HttpServletRequest request) {
        return request.getAttribute(OUTCOME_LOGGED) != null;
    }

    // ------------------------------------------------------------------
    // Helpers for call sites
    // ------------------------------------------------------------------

    /**
     * Build the {@code details} map: {@code details("orderId", 7, "symbol", "AAPL")}.
     * Null values are skipped and it never throws. Use it instead of Map.of(...),
     * which throws on a null value.
     */
    public static Map<String, Object> details(Object... keysAndValues) {
        Map<String, Object> map = new LinkedHashMap<>();
        if (keysAndValues == null) {
            return map;
        }
        for (int i = 0; i + 1 < keysAndValues.length; i += 2) {
            Object value = keysAndValues[i + 1];
            if (value != null) {
                map.put(String.valueOf(keysAndValues[i]), value);
            }
        }
        return map;
    }

    /** The logged-in user's id (HTTP or STOMP), or null when nobody is logged in. */
    public static Long currentUserId() {
        try {
            SimpAttributes stomp = SimpAttributesContextHolder.getAttributes();
            if (stomp != null) {
                return toLong(stomp.getAttribute(STOMP_USER_ID));
            }
            HttpServletRequest http = currentHttpRequest();
            return http == null ? null : toLong(http.getAttribute(USER_ID));
        } catch (Throwable ignored) {
            return null;
        }
    }

    /** True if the logged-in user is {@code targetUserId}. False when nobody is logged in. */
    public static boolean isOwner(Long targetUserId) {
        Long me = currentUserId();
        return me != null && me.equals(targetUserId);
    }

    /** First 1000 characters of a long value (commands, SQL, URLs). */
    public static String shorten(String text) {
        if (text == null || text.length() <= MAX_TEXT_LENGTH) {
            return text;
        }
        return text.substring(0, MAX_TEXT_LENGTH);
    }

    /**
     * Remember who is logged in for the rest of this HTTP request. Called by JwtAuthFilter and
     * ApiKeyAuthFilter right after setAuthentication. Needed because Spring Security clears its
     * own context before RequestLoggingFilter writes the end-of-request fallback.
     */
    public static void rememberUser(Object userId, String username) {
        try {
            HttpServletRequest http = currentHttpRequest();
            if (http != null) {
                http.setAttribute(USER_ID, toLong(userId));
                http.setAttribute(USERNAME, username);
            }
        } catch (Throwable ignored) {
            // best effort only
        }
    }

    /**
     * Remember who connected on this STOMP session, so later STOMP events (services called
     * from @MessageMapping handlers) know the user. Called once at CONNECT.
     */
    public static void rememberStompUser(SimpMessageHeaderAccessor accessor) {
        try {
            Map<String, Object> session = accessor.getSessionAttributes();
            Principal user = accessor.getUser();
            if (session == null || user == null) {
                return;
            }
            // The session map is a ConcurrentHashMap: putting a null would throw and break CONNECT.
            Long userId = userIdOf(user);
            String username = cleanUsername(user.getName());
            if (userId != null) {
                session.put(STOMP_USER_ID, userId);
            }
            if (username != null) {
                session.put(STOMP_USERNAME, username);
            }
        } catch (Throwable ignored) {
            // best effort only
        }
    }

    /** Client IP: the first X-Forwarded-For hop, else the socket address. Spoofable (guide §9). */
    public static String clientIp(HttpServletRequest request) {
        String forwardedFor = request.getHeader("X-Forwarded-For");
        if (forwardedFor != null && !forwardedFor.isEmpty()) {
            int comma = forwardedFor.indexOf(',');
            return (comma > 0 ? forwardedFor.substring(0, comma) : forwardedFor).trim();
        }
        return request.getRemoteAddr();
    }

    /** User-Agent header, or "" when it is missing (so Wazuh's "non-browser" rule can match). */
    public static String userAgent(HttpServletRequest request) {
        String userAgent = request.getHeader("User-Agent");
        return userAgent == null ? "" : userAgent;
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    private static void write(SecurityEvent event, Outcome outcome, Map<String, Object> details,
                              boolean userGiven, Long givenUserId, String givenUsername,
                              String stompDestination, Integer httpStatus) {
        try {
            // 1. Where did it happen? STOMP wins over HTTP, because SockJS frames
            //    arrive inside HTTP requests.
            SimpAttributes stomp = SimpAttributesContextHolder.getAttributes();
            HttpServletRequest http = stomp == null ? currentHttpRequest() : null;

            String transport = null;
            String requestId = null;
            String sessionId = null;
            String clientIp = null;
            String userAgent = null;
            String httpMethod = null;
            String path = null;
            Long userId = null;
            String username = null;

            if (stomp != null) {
                transport = "STOMP";
                sessionId = stomp.getSessionId();
                clientIp = asString(stomp.getAttribute(STOMP_CLIENT_IP));
                userAgent = asString(stomp.getAttribute(STOMP_USER_AGENT));
                path = stompDestination;
                userId = toLong(stomp.getAttribute(STOMP_USER_ID));
                username = asString(stomp.getAttribute(STOMP_USERNAME));
            } else if (http != null) {
                transport = "HTTP";
                requestId = asString(http.getAttribute(REQUEST_ID));
                clientIp = clientIp(http);
                userAgent = userAgent(http);
                httpMethod = http.getMethod();
                path = http.getRequestURI();
                userId = toLong(http.getAttribute(USER_ID));
                username = asString(http.getAttribute(USERNAME));
            }

            // 2. Who did it? logAs() and logStomp() name the user explicitly.
            if (userGiven) {
                userId = givenUserId;
                username = givenUsername;
            }
            username = cleanUsername(username);

            // 3. Build the event in the order of the field reference (guide §2).
            //    Null fields are left out.
            Map<String, Object> json = new LinkedHashMap<>();
            put(json, "@timestamp", TIMESTAMP.format(Instant.now()));
            put(json, "level", levelOf(outcome));
            put(json, "logger", callerClass());
            put(json, "thread", Thread.currentThread().getName());
            put(json, "application", "vulntrade");
            put(json, "environment", ENVIRONMENT);
            put(json, "category", event.category());
            put(json, "eventType", event.eventType());
            put(json, "outcome", outcome.value());
            put(json, "message", event.eventType().replace('_', ' '));
            put(json, "requestId", requestId);
            put(json, "sessionId", sessionId);
            put(json, "userId", userId);
            put(json, "username", username);
            put(json, "clientIp", clientIp);
            put(json, "userAgent", userAgent);
            put(json, "transport", transport);
            put(json, "httpMethod", httpMethod);
            put(json, "path", path);
            put(json, "httpStatus", httpStatus);
            if (details != null && !details.isEmpty()) {
                json.put("details", details);
            }

            SECURITY_LOG.info(JSON.writeValueAsString(json));

            // 4. Tell RequestLoggingFilter that this request already said what happened.
            if (http != null && !event.isContextEvent()) {
                http.setAttribute(OUTCOME_LOGGED, Boolean.TRUE);
            }
        } catch (Throwable t) {
            // Never break the request, but make a broken logger visible in app.log.
            APP_LOG.warn("Security event not written: {}", t.getClass().getSimpleName());
        }
    }

    private static void put(Map<String, Object> json, String key, Object value) {
        if (value != null) {
            json.put(key, value);
        }
    }

    private static String levelOf(Outcome outcome) {
        switch (outcome) {
            case SUCCESS: return "INFO";
            case ERROR:   return "ERROR";
            default:      return "WARN";   // FAILURE, DENIED
        }
    }

    /** The class that called SecurityEventLogger, e.g. com.vulntrade.controller.AuthController. */
    private static String callerClass() {
        return StackWalker.getInstance().walk(frames -> frames
                .map(StackWalker.StackFrame::getClassName)
                .filter(name -> !name.equals(SecurityEventLogger.class.getName()))
                .findFirst()
                .orElse("unknown"));
    }

    private static HttpServletRequest currentHttpRequest() {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        if (attributes instanceof ServletRequestAttributes) {
            return ((ServletRequestAttributes) attributes).getRequest();
        }
        return null;
    }

    /** User id from a STOMP principal: our StompPrincipal, or the handshake's JWT authentication. */
    private static Long userIdOf(Principal user) {
        if (user instanceof StompPrincipal) {
            return ((StompPrincipal) user).getUserIdAsLong();
        }
        if (user instanceof Authentication && ((Authentication) user).getDetails() instanceof Claims) {
            return toLong(((Claims) ((Authentication) user).getDetails()).get("userId"));
        }
        return null;
    }

    /** "anonymous" / "anonymousUser" are placeholders, not users: write them as absent. */
    private static String cleanUsername(String username) {
        if ("anonymous".equals(username) || "anonymousUser".equals(username)) {
            return null;
        }
        return username;
    }

    /** JWT claims hold numbers as Integer or Long; normalise to Long (null if not a number). */
    private static Long toLong(Object value) {
        if (value instanceof Number) {
            return ((Number) value).longValue();
        }
        if (value instanceof String) {
            try {
                return Long.valueOf((String) value);
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    private static String asString(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
