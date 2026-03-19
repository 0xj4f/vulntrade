package com.vulntrade.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        // Enable simple in-memory broker for /topic and /queue
        config.enableSimpleBroker("/topic", "/queue");
        // Application destination prefix
        config.setApplicationDestinationPrefixes("/app");
        // User destination prefix
        config.setUserDestinationPrefix("/user");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // VULN: No origin check - allows any origin
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns("*");  // VULN: wildcard origin

        // SockJS fallback - VULN: additional attack surface
        registry.addEndpoint("/ws-sockjs")
                .setAllowedOriginPatterns("*")   // VULN: wildcard origin
                .withSockJS();

        // VULN: No message size limit configured
        // VULN: No connection rate limiting
    }
}
