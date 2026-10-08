package com.vulntrade.security.logging;

import org.slf4j.MDC;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;

/**
 * Wraps every HTTP request for security logging (docs/logging-guide.md §4.5).
 *
 * <ol>
 *   <li>Gives the request a {@code requestId}. Every security event of this request carries it,
 *       and so does app.log (MDC key {@code requestId}).</li>
 *   <li>If an exception escapes every controller, logs {@code unexpected_exception}.</li>
 *   <li>At the end, if the code logged nothing about the result, logs one fallback event from
 *       the final status: 400 -> input_validation_failed, 401/403 -> authorization_denied,
 *       5xx -> unexpected_exception.</li>
 * </ol>
 *
 * <p>It never writes to or changes the response: status codes and error bodies stay as they are.
 *
 * <p>Order -104: just inside Spring's RequestContextFilter (-105), so the current request is
 * available to SecurityEventLogger, and outside Spring Security (-100), so it sees the 401/403
 * that Spring Security sends.
 */
@Component
@Order(-104)
public class RequestLoggingFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String requestId = UUID.randomUUID().toString();
        request.setAttribute(SecurityEventLogger.REQUEST_ID, requestId);
        MDC.put("requestId", requestId);
        try {
            chain.doFilter(request, response);
        } catch (Exception e) {
            // Nothing handled it. Log the real cause (Spring wraps it), then rethrow so the
            // error page / stack trace is produced exactly as before. Tomcat sets the 500 later.
            SecurityEventLogger.logRequestResult(SecurityEvent.UNEXPECTED_EXCEPTION, Outcome.ERROR, 500,
                    SecurityEventLogger.details("exception", rootCause(e).getClass().getSimpleName()));
            throw e;
        } finally {
            logFallbackIfNothingLogged(request, response.getStatus());
            MDC.remove("requestId");
        }
    }

    private void logFallbackIfNothingLogged(HttpServletRequest request, int status) {
        if (SecurityEventLogger.outcomeEventLogged(request)) {
            return;   // the code already said what happened
        }
        if (status == 400) {
            SecurityEventLogger.logRequestResult(SecurityEvent.INPUT_VALIDATION_FAILED, Outcome.FAILURE, status, null);
        } else if (status == 401 || status == 403) {
            SecurityEventLogger.logRequestResult(SecurityEvent.AUTHORIZATION_DENIED, Outcome.DENIED, status, null);
        } else if (status >= 500) {
            SecurityEventLogger.logRequestResult(SecurityEvent.UNEXPECTED_EXCEPTION, Outcome.ERROR, status, null);
        }
    }

    private static Throwable rootCause(Throwable error) {
        Throwable root = error;
        while (root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        return root;
    }
}
