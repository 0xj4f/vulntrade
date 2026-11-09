package com.vulntrade.web;

import javax.servlet.http.HttpServletRequest;

/**
 * Who is calling an internals service. The gateway checked the token and put the answer in
 * headers (see gateway ProxyController); the internals simply trust them.
 */
public final class CurrentUser {

    private CurrentUser() {
    }

    public static Long id(HttpServletRequest request) {
        String id = request.getHeader("X-User-Id");
        try {
            return id == null || id.isEmpty() || "null".equals(id) ? null : Long.valueOf(id);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    public static String username(HttpServletRequest request) {
        return request.getHeader("X-Username");
    }

    public static String role(HttpServletRequest request) {
        return request.getHeader("X-Role");
    }

    /** "ws" when the order came over the WebSocket (set by the gateway, or by the client - VULN EQ-1). */
    public static String channel(HttpServletRequest request) {
        return request.getHeader("X-Channel");
    }

    /**
     * The user an order is for. VULN #71 (kept from 0.6.0): a "userId" in the request body wins
     * over the logged-in user, so anyone can trade from someone else's account.
     */
    public static Long effectiveUser(HttpServletRequest request, Object bodyUserId) {
        if (bodyUserId != null) {
            try {
                return Long.valueOf(bodyUserId.toString());
            } catch (NumberFormatException ignored) {
                // fall through to the logged-in user
            }
        }
        return id(request);
    }
}
