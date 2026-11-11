package com.vulntrade.gateway;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.vulntrade.security.StompChannelInterceptor.StompPrincipal;
import com.vulntrade.security.logging.Outcome;
import com.vulntrade.security.logging.SecurityEvent;
import com.vulntrade.security.logging.SecurityEventLogger;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.security.Principal;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Orders over the product WebSocket (what the trading screen uses):
 *
 *   SEND /app/order.place   {symbol, side, type, quantity, price, ...}  -> reply on /user/queue/orders
 *   SEND /app/order.cancel  {orderId}                                   -> reply on /user/queue/orders
 *
 * The gateway turns them into the same REST calls the internals service already has, adding
 * X-Channel: ws so the internals know the order came over the WebSocket.
 * The body goes through untouched (VULN #71: a "userId" in the body is honoured by the internals).
 */
@Controller
public class OrderStompController {

    private final RestTemplate http;
    private final SimpMessagingTemplate stomp;
    private final ObjectMapper json;
    private final String product;
    private final String upstream;

    public OrderStompController(RestTemplate http, SimpMessagingTemplate stomp, ObjectMapper json,
                                @Value("${gateway.product}") String product,
                                @Value("${gateway.upstream}") String upstream) {
        this.http = http;
        this.stomp = stomp;
        this.json = json;
        this.product = product;
        this.upstream = upstream;
    }

    @MessageMapping("/order.place")
    public void place(@Payload Map<String, Object> order, Principal principal, SimpMessageHeaderAccessor session) {
        call("/api/" + product + "/orders", order, "ORDER_PLACED", principal, session);
    }

    @MessageMapping("/order.cancel")
    public void cancel(@Payload Map<String, Object> body, Principal principal, SimpMessageHeaderAccessor session) {
        call("/api/" + product + "/orders/" + body.get("orderId") + "/cancel", body, "ORDER_CANCELLED", principal, session);
    }

    @SuppressWarnings("unchecked")
    private void call(String path, Map<String, Object> body, String okType, Principal principal,
                      SimpMessageHeaderAccessor session) {
        // Same as 0.6.0: an anonymous WebSocket session may connect (#31) but not trade
        Long userId = principal instanceof StompPrincipal ? ((StompPrincipal) principal).getUserIdAsLong() : null;
        if (userId == null) {
            SecurityEventLogger.logStomp(session, SecurityEvent.AUTHORIZATION_DENIED, Outcome.DENIED, null);
            if (principal != null) {
                stomp.convertAndSendToUser(principal.getName(), "/queue/errors",
                        Map.of("type", "ERROR", "message", "Authentication required"));
            }
            return;
        }
        HttpHeaders out = new HttpHeaders();
        out.setContentType(MediaType.APPLICATION_JSON);
        out.set("X-Channel", "ws");
        Map<String, Object> attrs = session.getSessionAttributes();
        if (attrs != null) {
            put(out, "X-Forwarded-For", attrs.get(SecurityEventLogger.STOMP_CLIENT_IP));
            put(out, HttpHeaders.USER_AGENT, attrs.get(SecurityEventLogger.STOMP_USER_AGENT));
        }
        StompPrincipal p = (StompPrincipal) principal;
        out.set("X-User-Id", String.valueOf(userId));
        out.set("X-Username", p.getName());
        out.set("X-Role", String.valueOf(p.getRole()));
        Map<String, Object> reply = new LinkedHashMap<>();
        try {
            ResponseEntity<String> answer = http.exchange(URI.create(upstream + path), HttpMethod.POST,
                    new HttpEntity<>(body, out), String.class);
            if (answer.getBody() != null && !answer.getBody().isEmpty()) {
                reply.putAll(json.readValue(answer.getBody(), Map.class));
            }
            reply.put("type", answer.getStatusCode().is2xxSuccessful() ? okType : "ERROR");
        } catch (Exception e) {
            reply.put("type", "ERROR");
            reply.put("error", "Trading service unavailable");
        }
        if (principal != null) {
            stomp.convertAndSendToUser(principal.getName(), "/queue/orders", reply);
        }
    }

    private static void put(HttpHeaders headers, String name, Object value) {
        if (value != null) {
            headers.set(name, value.toString());
        }
    }
}
