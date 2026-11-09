package com.vulntrade.security.logging;

import org.slf4j.MDC;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;

/**
 * For the internals services (fx / equities / crypto), which only the gateway calls.
 *
 * The gateway already checked the token and tells us who is calling:
 *   X-User-Id, X-Username   -> remembered so every security event of this request names the user
 *   X-Request-Id            -> the same request id as the gateway's log line (follow one order end to end)
 *   X-Forwarded-For, User-Agent are read by SecurityEventLogger itself (the real client).
 *
 * The gateway writes the end-of-request fallback events (401, 400 ...), so this filter does not,
 * which keeps each request from being logged twice.
 *
 * Architecture note (lab): anything inside the cluster can call an internals service directly and
 * claim to be any user with these headers. See docs/vulnerabilities.md "architecture notes".
 */
public class InternalRequestFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || requestId.isEmpty()) {
            requestId = UUID.randomUUID().toString();
        }
        request.setAttribute(SecurityEventLogger.REQUEST_ID, requestId);
        MDC.put("requestId", requestId);
        if (request.getHeader("X-User-Id") != null) {
            SecurityEventLogger.rememberUser(request.getHeader("X-User-Id"), request.getHeader("X-Username"));
        }
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove("requestId");
        }
    }
}
