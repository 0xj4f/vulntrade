package com.vulntrade.config;

import com.vulntrade.security.WebSocketAuthInterceptor;
import com.vulntrade.security.StompChannelInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;

@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final WebSocketAuthInterceptor authInterceptor;
    private final StompChannelInterceptor channelInterceptor;

    public WebSocketConfig(WebSocketAuthInterceptor authInterceptor,
                           StompChannelInterceptor channelInterceptor) {
        this.authInterceptor = authInterceptor;
        this.channelInterceptor = channelInterceptor;
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        // Enable simple in-memory broker for /topic, /queue, and /user
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
                .setAllowedOriginPatterns("*")
                .addInterceptors(authInterceptor);  // VULN: weak auth, never revalidated

        // SockJS fallback - VULN: additional attack surface
        registry.addEndpoint("/ws-sockjs")
                .setAllowedOriginPatterns("*")
                .addInterceptors(authInterceptor)
                .withSockJS();

        // VULN: No connection rate limiting
    }

    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        // VULN: No message size limit configured
        // Default is 64KB but we set it very high
        registration.setMessageSizeLimit(10 * 1024 * 1024);  // 10MB - way too high
        registration.setSendBufferSizeLimit(10 * 1024 * 1024);
        registration.setSendTimeLimit(60 * 1000);  // 60 seconds
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        // Add channel interceptor for STOMP message-level auth
        // VULN: Authorization is weak - role checked from JWT body (modifiable)
        registration.interceptors(channelInterceptor);
    }
}
