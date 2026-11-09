package com.vulntrade.gateway;

import com.vulntrade.security.logging.SecurityEventLogger;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import javax.servlet.http.HttpServletRequest;
import java.net.URI;

/**
 * REST front door: /api/{product}/** is passed 1:1 to the internals service.
 *
 *  1. Who are you? (GatewayAuth). Market data is public; everything else needs a login.
 *  2. Tell the internals service who is calling, in headers it trusts:
 *       X-User-Id, X-Username, X-Role   always set by the gateway (anything the client sent is replaced)
 *       X-Request-Id                    to follow one request across services in the security log
 *       X-Forwarded-For, User-Agent     the real client, for the security log
 *       X-Channel                       passed through as the client sent it
 *  3. Return the internals' answer exactly as it came (status, body).
 */
@RestController
public class ProxyController {

    private final GatewayAuth auth;
    private final RestTemplate http;
    private final String product;
    private final String upstream;

    public ProxyController(GatewayAuth auth, RestTemplate http,
                           @Value("${gateway.product}") String product,
                           @Value("${gateway.upstream}") String upstream) {
        this.auth = auth;
        this.http = http;
        this.product = product;
        this.upstream = upstream;
    }

    @RequestMapping("/api/{product}/**")
    public ResponseEntity<byte[]> forward(HttpServletRequest request,
                                          @RequestBody(required = false) byte[] body) {
        String path = request.getRequestURI();
        if (!path.startsWith("/api/" + product + "/")) {
            return error(HttpStatus.NOT_FOUND, "Not found");
        }
        GatewayAuth.Caller caller = auth.identify(request);
        if (caller == null && !isPublic(request.getMethod(), path)) {
            return error(HttpStatus.UNAUTHORIZED, "Authentication required");
        }

        HttpHeaders out = new HttpHeaders();
        copy(request, out, HttpHeaders.CONTENT_TYPE);
        copy(request, out, HttpHeaders.ACCEPT);
        out.set(HttpHeaders.USER_AGENT, SecurityEventLogger.userAgent(request));   // "" if none (not "Java/11")
        copy(request, out, "X-Channel");   // VULN (EQ-1): the client decides which "path" this is
        out.set("X-Forwarded-For", SecurityEventLogger.clientIp(request));
        out.set("X-Request-Id", SecurityEventLogger.requestIdOf(request));
        if (caller != null) {
            out.set("X-User-Id", String.valueOf(caller.userId));
            out.set("X-Username", caller.username);
            out.set("X-Role", caller.role);
        }

        String query = request.getQueryString();
        URI target = URI.create(upstream + path + (query != null ? "?" + query : ""));
        try {
            ResponseEntity<byte[]> answer = http.exchange(target, HttpMethod.valueOf(request.getMethod()),
                    new HttpEntity<>(body, out), byte[].class);
            HttpHeaders back = new HttpHeaders();
            if (answer.getHeaders().getContentType() != null) {
                back.setContentType(answer.getHeaders().getContentType());
            }
            return new ResponseEntity<>(answer.getBody(), back, answer.getStatusCode());
        } catch (RestClientException down) {
            return error(HttpStatus.SERVICE_UNAVAILABLE, "Trading service unavailable");
        }
    }

    /** Market data can be read without logging in. */
    private static boolean isPublic(String method, String path) {
        return "GET".equals(method) && (path.contains("/market/") || path.endsWith("/quotes")
                || path.endsWith("/session") || path.endsWith("/pairs"));
    }

    private static void copy(HttpServletRequest in, HttpHeaders out, String name) {
        String value = in.getHeader(name);
        if (value != null) {
            out.set(name, value);
        }
    }

    private static ResponseEntity<byte[]> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON)
                .body(("{\"error\":\"" + message + "\"}").getBytes());
    }
}
