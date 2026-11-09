package com.vulntrade.gateway;

import com.vulntrade.security.StompChannelInterceptor;
import com.vulntrade.security.WebSocketAuthInterceptor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

/**
 * The product's live WebSocket (STOMP), same rules as the platform's /ws:
 *   /api/{product}/ws          raw WebSocket
 *   /api/{product}/ws-sockjs   SockJS (what the browser uses)
 *
 * VULN (kept from 0.6.0): any origin (#11), anonymous connections allowed (#31), the token is
 * checked once and never again (#29), no message rate limit (#33).
 */
@Configuration
@EnableWebSocketMessageBroker
public class GatewayWebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final WebSocketAuthInterceptor authInterceptor;
    private final StompChannelInterceptor channelInterceptor;
    private final String product;

    public GatewayWebSocketConfig(WebSocketAuthInterceptor authInterceptor,
                                  StompChannelInterceptor channelInterceptor,
                                  @Value("${gateway.product}") String product) {
        this.authInterceptor = authInterceptor;
        this.channelInterceptor = channelInterceptor;
        this.product = product;
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        config.enableSimpleBroker("/topic", "/queue");
        config.setApplicationDestinationPrefixes("/app");
        config.setUserDestinationPrefix("/user");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // Checked before the REST proxy's /api/{product}/** mapping
        registry.setOrder(-1);
        registry.addEndpoint("/api/" + product + "/ws")
                .setAllowedOriginPatterns("*")
                .addInterceptors(authInterceptor);
        registry.addEndpoint("/api/" + product + "/ws-sockjs")
                .setAllowedOriginPatterns("*")
                .addInterceptors(authInterceptor)
                .withSockJS();
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(channelInterceptor);
    }
}
