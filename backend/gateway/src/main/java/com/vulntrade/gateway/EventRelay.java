package com.vulntrade.gateway;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

/**
 * Prices out: the internals service publishes events to Redis (channel "events.<product>"),
 * the gateway forwards each one to the browsers on its WebSocket.
 *
 * Event = {"destination": "/topic/fx/prices", "user": null | "alice", "payload": {...}}
 *   user == null  -> everyone subscribed to destination
 *   user != null  -> only that user's sessions (/user/queue/...)
 * One listener thread, so events for one order arrive in the order they were sent.
 */
@Configuration
public class EventRelay {

    private static final Logger log = LoggerFactory.getLogger(EventRelay.class);

    /** Reads numbers as exact decimals, so prices and amounts are relayed digit for digit. */
    private static final ObjectMapper EXACT = new ObjectMapper()
            .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
            .setNodeFactory(JsonNodeFactory.withExactBigDecimals(true));

    @Bean
    public RedisMessageListenerContainer eventListener(RedisConnectionFactory redis, SimpMessagingTemplate stomp,
                                                       @Value("${gateway.product}") String product) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(redis);
        container.setTaskExecutor(Executors.newSingleThreadExecutor());
        container.addMessageListener((message, pattern) -> {
            try {
                JsonNode event = EXACT.readTree(new String(message.getBody(), StandardCharsets.UTF_8));
                String destination = event.path("destination").asText();
                String payload = EXACT.writeValueAsString(event.get("payload"));   // keep the JSON exactly as sent
                if (event.hasNonNull("user")) {
                    stomp.convertAndSendToUser(event.get("user").asText(), destination, payload);
                } else {
                    stomp.convertAndSend(destination, payload);
                }
            } catch (Exception e) {
                log.warn("Bad event on events.{}: {}", product, e.getMessage());
            }
        }, new ChannelTopic("events." + product));
        return container;
    }
}
