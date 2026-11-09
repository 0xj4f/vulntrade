package com.vulntrade.fx;

import com.vulntrade.config.JacksonConfig;
import com.vulntrade.events.EventPublisher;
import com.vulntrade.money.Accounts;
import com.vulntrade.money.Balances;
import com.vulntrade.money.Ledger;
import com.vulntrade.security.logging.InternalRequestFilter;
import com.vulntrade.service.MatchingCoordinator;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.security.servlet.SecurityAutoConfiguration;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * FX internals (dealer model). Only fx-gateway calls it.
 *
 *   LpSimulator   fake banks send raw prices every second
 *   PriceEngine   best bank price + our margin = the client quote (the spread is made here)
 *   FxOms         takes an order on a quote, checks it, and the House fills it
 *   FxHouse       the House's FX money, position and exposure limit
 *
 * Shared pieces from common: Accounts/Balances/Ledger (money), MatchingCoordinator (one lock for
 * all FX fills), EventPublisher (live prices and order updates via Redis to fx-gateway).
 */
@SpringBootApplication(exclude = SecurityAutoConfiguration.class)
@EnableScheduling
@Import({Accounts.class, Balances.class, Ledger.class, EventPublisher.class, MatchingCoordinator.class,
        JacksonConfig.class})
public class FxApplication {

    public static void main(String[] args) {
        SpringApplication.run(FxApplication.class, args);
    }

    /** Who is calling (headers set by the gateway) + request id, for the security log. */
    @Bean
    public FilterRegistrationBean<InternalRequestFilter> internalRequestFilter() {
        return new FilterRegistrationBean<>(new InternalRequestFilter());
    }
}
