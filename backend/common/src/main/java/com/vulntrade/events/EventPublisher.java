package com.vulntrade.events;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Sends live events (prices, order updates, trades, order books) to the browsers.
 *
 * An internals service publishes to the Redis channel "events.<product>"; that product's gateway
 * forwards every event to its WebSocket clients (see gateway EventRelay):
 *
 *   {"destination": "/topic/fx/prices", "user": null,    "payload": {...}}   everyone
 *   {"destination": "/queue/order-updates", "user": "bob", "payload": {...}} only bob
 *
 * Fire and forget: a Redis problem is logged, never thrown, so it can't break a trade.
 */
@Component
public class EventPublisher {

    private static final Logger log = LoggerFactory.getLogger(EventPublisher.class);

    private final StringRedisTemplate redis;
    private final ObjectMapper json;

    public EventPublisher(StringRedisTemplate redis, ObjectMapper json) {
        this.redis = redis;
        this.json = json;
    }

    /** To everyone subscribed to {@code destination} on the product's WebSocket. */
    public void toAll(String product, String destination, Object payload) {
        send(product, destination, null, payload);
    }

    /** To one user's sessions ({@code destination} like "/queue/order-updates"). */
    public void toUser(String product, String username, String destination, Object payload) {
        if (username != null) {
            send(product, destination, username, payload);
        }
    }

    private void send(String product, String destination, String user, Object payload) {
        try {
            Map<String, Object> event = new LinkedHashMap<>();
            event.put("destination", destination);
            event.put("user", user);
            event.put("payload", payload);
            redis.convertAndSend("events." + product.toLowerCase(), json.writeValueAsString(event));
        } catch (Exception e) {
            log.warn("Event not published to {}: {}", destination, e.getMessage());
        }
    }
}
