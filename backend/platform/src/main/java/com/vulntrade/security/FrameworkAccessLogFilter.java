package com.vulntrade.security;

import com.vulntrade.security.logging.Outcome;
import com.vulntrade.security.logging.SecurityEvent;
import com.vulntrade.security.logging.SecurityEventLogger;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;

/**
 * Logs access to framework / infrastructure surfaces (Spring Boot Actuator, the H2
 * console, Swagger) so Wazuh can detect framework-vuln probing at the application layer.
 *
 * <ul>
 *   <li>framework_endpoint_accessed: any request to /actuator, /h2-console or Swagger.
 *       For the H2 console it also records the JDBC URL (the RCE payload), never the password.</li>
 *   <li>audit_configuration_changed: POST /actuator/loggers/... (changing log levels, e.g. turning
 *       security.log off). It is the only event for that request and it is written BEFORE the
 *       request runs, so it lands even when the request switches SECURITY_EVENTS off.</li>
 * </ul>
 *
 * Order -103: right after RequestLoggingFilter (-104), so the event gets the request id, IP
 * and path, and before Spring Security (-100), because /actuator and /h2-console can be
 * reached without it. It never blocks a request and never throws.
 */
@Component
@Order(-103)
public class FrameworkAccessLogFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {
        try {
            logIfFrameworkSurface(request);
        } catch (Throwable ignored) {
            // best-effort logging only, never affect the request
        }
        filterChain.doFilter(request, response);
    }

    private void logIfFrameworkSurface(HttpServletRequest request) {
        // Classify on the decoded path, so tricks like /%61ctuator/env are still seen.
        String path = request.getServletPath() + (request.getPathInfo() == null ? "" : request.getPathInfo());

        if (path.startsWith("/actuator")) {
            String endpoint = firstSegmentAfter(path, "/actuator/");
            if ("POST".equalsIgnoreCase(request.getMethod()) && "loggers".equals(endpoint)) {
                String loggerName = path.length() > "/actuator/loggers/".length()
                        ? path.substring("/actuator/loggers/".length())
                        : null;
                SecurityEventLogger.log(SecurityEvent.AUDIT_CONFIGURATION_CHANGED, Outcome.SUCCESS,
                        SecurityEventLogger.details("loggerName", loggerName));
                return;
            }
            SecurityEventLogger.log(SecurityEvent.FRAMEWORK_ENDPOINT_ACCESSED, Outcome.SUCCESS,
                    SecurityEventLogger.details("surface", "actuator", "endpoint", endpoint));

        } else if (path.startsWith("/h2-console") || path.startsWith("/h2")) {
            String endpoint = firstSegmentAfter(path, "/h2-console/");
            // The console's JDBC URL form field is "url" (login.do, test.do). It is the RCE payload.
            String jdbcUrl = path.endsWith(".do") ? request.getParameter("url") : null;
            SecurityEventLogger.log(SecurityEvent.FRAMEWORK_ENDPOINT_ACCESSED, Outcome.SUCCESS,
                    SecurityEventLogger.details("surface", "h2_console",
                            "endpoint", endpoint,
                            "jdbcUrl", SecurityEventLogger.shorten(jdbcUrl)));

        } else if (path.startsWith("/swagger-ui") || path.startsWith("/v3/api-docs")
                || path.startsWith("/swagger-resources")) {
            SecurityEventLogger.log(SecurityEvent.FRAMEWORK_ENDPOINT_ACCESSED, Outcome.SUCCESS,
                    SecurityEventLogger.details("surface", "swagger"));
        }
    }

    /** "/actuator/env/foo" with prefix "/actuator/" gives "env"; no segment gives "root". */
    private String firstSegmentAfter(String path, String prefix) {
        if (!path.startsWith(prefix) || path.length() == prefix.length()) {
            return "root";
        }
        return path.substring(prefix.length()).split("/")[0];
    }
}
