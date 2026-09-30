package com.vulntrade.security;

import com.vulntrade.security.logging.SecurityEventLogger;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Logs access to framework / infrastructure surfaces (Spring Boot Actuator, the H2
 * console, Swagger) as security events so they land in security.log and Wazuh can
 * detect framework-vuln probing at the application layer.
 *
 * Registered as a @Component so Spring Boot wires it into the servlet chain for ALL
 * URLs (including /actuator and /h2-console, which can bypass the Spring Security
 * chain). It never blocks a request and never throws.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
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
        String uri = request.getRequestURI();
        if (uri == null) return;

        String clientIp = clientIp(request);

        if (uri.startsWith("/actuator")) {
            // endpoint = first path segment after /actuator/ (env, heapdump, shutdown, ...)
            String endpoint = uri.length() > "/actuator/".length()
                    ? uri.substring("/actuator/".length()).split("/")[0]
                    : "root";
            emit("FRAMEWORK_ACTUATOR_ACCESS", uri, clientIp, "endpoint", endpoint);
        } else if (uri.startsWith("/h2-console") || uri.startsWith("/h2")) {
            emit("FRAMEWORK_H2_CONSOLE_ACCESS", uri, clientIp, null, null);
        } else if (uri.startsWith("/swagger-ui") || uri.startsWith("/v3/api-docs")
                || uri.startsWith("/swagger-resources")) {
            emit("FRAMEWORK_SWAGGER_ACCESS", uri, clientIp, null, null);
        }
    }

    private void emit(String eventType, String path, String clientIp, String extraKey, String extraVal) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("path", path);
        details.put("clientIp", clientIp);
        if (extraKey != null) details.put(extraKey, extraVal);
        SecurityEventLogger.log(eventType, "SUCCESS", details);
    }

    private String clientIp(HttpServletRequest req) {
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isEmpty()) {
            int comma = xff.indexOf(',');
            return (comma > 0 ? xff.substring(0, comma) : xff).trim();
        }
        return req.getRemoteAddr();
    }
}
