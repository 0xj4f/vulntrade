package com.vulntrade.gateway;

import com.vulntrade.config.JacksonConfig;
import com.vulntrade.security.JwtTokenProvider;
import com.vulntrade.security.StompChannelInterceptor;
import com.vulntrade.security.WebSocketAuthInterceptor;
import com.vulntrade.security.logging.RequestLoggingFilter;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration;
import org.springframework.boot.autoconfigure.security.servlet.SecurityAutoConfiguration;
import org.springframework.context.annotation.Import;

/**
 * Trading gateway: the front door of one product (PRODUCT=fx | equities | crypto).
 *
 *   REST       /api/{product}/**          -> checks the token, then passes the call to the internals service
 *   WebSocket  /api/{product}/ws(-sockjs) -> live prices/order updates out, STOMP orders in
 *
 * It has no database and no business logic. Only the shared security pieces are imported
 * (the same JWT checks, WebSocket auth and security logging as the platform).
 */
@SpringBootApplication(exclude = {
        DataSourceAutoConfiguration.class,          // no database here
        HibernateJpaAutoConfiguration.class,
        SecurityAutoConfiguration.class})           // auth is done by GatewayAuth, like the old filters
@Import({JwtTokenProvider.class, WebSocketAuthInterceptor.class, StompChannelInterceptor.class,
        RequestLoggingFilter.class, JacksonConfig.class})
public class GatewayApplication {

    public static void main(String[] args) {
        SpringApplication.run(GatewayApplication.class, args);
    }
}
