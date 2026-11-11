package com.vulntrade.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.PatternTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

/**
 * 1.0.0: prices are made by the product services (equities, crypto, fx), which publish every
 * tick to Redis (events.<product>). The platform listens to those ticks and fires the users'
 * price alerts (AlertService, unchanged - including the stored-XSS sink #54 on /user/queue/alerts).
 */
@Configuration
public class PriceAlertListener {

    private static final Logger log = LoggerFactory.getLogger(PriceAlertListener.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    @Bean
    public RedisMessageListenerContainer priceTicks(RedisConnectionFactory redis, AlertService alerts) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(redis);
        container.setTaskExecutor(Executors.newSingleThreadExecutor());
        container.addMessageListener((message, pattern) -> {
            try {
                JsonNode event = JSON.readTree(new String(message.getBody(), StandardCharsets.UTF_8));
                if (!event.path("destination").asText().endsWith("/prices")) {
                    return;   // only price ticks
                }
                JsonNode tick = event.path("payload");
                String symbol = tick.path("symbol").asText(null);
                BigDecimal price = tick.hasNonNull("last") ? tick.get("last").decimalValue()
                        : tick.get("bid").decimalValue().add(tick.get("ask").decimalValue())
                                .divide(BigDecimal.valueOf(2), 8, RoundingMode.HALF_UP);   // FX: the mid
                if (symbol != null) {
                    alerts.checkAlerts(symbol, price);
                }
            } catch (Exception e) {
                log.debug("Price tick ignored: {}", e.getMessage());
            }
        }, new PatternTopic("events.*"));
        return container;
    }
}
