package com.vulntrade.websocket;

import com.vulntrade.service.AdminService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionConnectEvent;
import org.springframework.web.socket.messaging.SessionConnectedEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;
import org.springframework.web.socket.messaging.SessionSubscribeEvent;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Listens for STOMP session events (connect, disconnect, subscribe).
 * Tracks active sessions and broadcasts connection events.
 * 
 * VULN: Leaks session information to admin channel.
 * VULN: No connection rate limiting.
 */
@Component
public class StompEventListener {

    private static final Logger logger = LoggerFactory.getLogger(StompEventListener.class);

    private final AdminService adminService;

    // Track active sessions - VULN: no limit on concurrent connections
    private final ConcurrentHashMap<String, Map<String, Object>> activeSessions = new ConcurrentHashMap<>();
    private final AtomicInteger totalConnections = new AtomicInteger(0);

    public StompEventListener(AdminService adminService) {
        this.adminService = adminService;
    }

    @EventListener
    public void handleSessionConnect(SessionConnectEvent event) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(event.getMessage());
        String sessionId = accessor.getSessionId();
        String user = accessor.getUser() != null ? accessor.getUser().getName() : "anonymous";

        logger.info("STOMP session connecting: sessionId={}, user={}", sessionId, user);
        totalConnections.incrementAndGet();

        // VULN: No connection rate limiting
    }

    @EventListener
    public void handleSessionConnected(SessionConnectedEvent event) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(event.getMessage());
        String sessionId = accessor.getSessionId();
        String user = accessor.getUser() != null ? accessor.getUser().getName() : "anonymous";

        Map<String, Object> sessionInfo = new HashMap<>();
        sessionInfo.put("user", user);
        sessionInfo.put("connectedAt", System.currentTimeMillis());
        sessionInfo.put("sessionId", sessionId);
        activeSessions.put(sessionId, sessionInfo);

        logger.info("STOMP session connected: sessionId={}, user={}, activeSessions={}",
                sessionId, user, activeSessions.size());

        // Broadcast to admin channel - VULN: subscribable by any user
        Map<String, Object> details = new HashMap<>();
        details.put("sessionId", sessionId);
        details.put("user", user);
        details.put("activeSessions", activeSessions.size());
        details.put("totalConnections", totalConnections.get());
        adminService.sendAdminAlert("SESSION_CONNECTED",
                "User " + user + " connected (session: " + sessionId + ")", details);
    }

    @EventListener
    public void handleSessionDisconnect(SessionDisconnectEvent event) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(event.getMessage());
        String sessionId = accessor.getSessionId();
        Map<String, Object> sessionInfo = activeSessions.remove(sessionId);

        String user = sessionInfo != null ? (String) sessionInfo.get("user") : "unknown";

        logger.info("STOMP session disconnected: sessionId={}, user={}, activeSessions={}",
                sessionId, user, activeSessions.size());

        // Broadcast to admin channel
        Map<String, Object> details = new HashMap<>();
        details.put("sessionId", sessionId);
        details.put("user", user);
        details.put("activeSessions", activeSessions.size());
        adminService.sendAdminAlert("SESSION_DISCONNECTED",
                "User " + user + " disconnected (session: " + sessionId + ")", details);
    }

    @EventListener
    public void handleSessionSubscribe(SessionSubscribeEvent event) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(event.getMessage());
        String sessionId = accessor.getSessionId();
        String destination = accessor.getDestination();
        String user = accessor.getUser() != null ? accessor.getUser().getName() : "anonymous";

        logger.info("STOMP subscribe: sessionId={}, user={}, destination={}",
                sessionId, user, destination);

        // VULN: Log subscription to admin channel (including admin channel subscriptions)
        if (destination != null && destination.startsWith("/topic/admin")) {
            logger.warn("User {} subscribed to admin channel: {}", user, destination);
            // VULN: We warn but don't block
        }
    }

    /**
     * Get count of active sessions.
     */
    public int getActiveSessionCount() {
        return activeSessions.size();
    }

    /**
     * Get all active sessions info.
     * VULN: Exposes all session details.
     */
    public Map<String, Map<String, Object>> getActiveSessions() {
        return new HashMap<>(activeSessions);
    }
}
