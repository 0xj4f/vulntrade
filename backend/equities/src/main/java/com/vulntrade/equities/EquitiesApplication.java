package com.vulntrade.equities;

import com.vulntrade.config.JacksonConfig;
import com.vulntrade.events.EventPublisher;
import com.vulntrade.money.Accounts;
import com.vulntrade.money.Balances;
import com.vulntrade.money.Ledger;
import com.vulntrade.security.logging.InternalRequestFilter;
import com.vulntrade.service.MatchingCoordinator;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.autoconfigure.security.servlet.SecurityAutoConfiguration;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Equities internals (broker model). Only equities-gateway calls it.
 *
 *   OrderService            the broker's order management: checks, holds, commission, market session
 *   MatchingEngineService   XSIM, the simulated exchange: order book, matching, settlement
 *   LiquidityProviderService + HouseMarketMakerService   the house keeps the book full
 *   PriceSimulatorService + CandleService                stock prices and charts
 *
 * Shared from common: entities + repositories (one database), Accounts/Balances/Ledger,
 * MatchingCoordinator (one lock for all equities trading), EventPublisher (via Redis to the gateway).
 */
@SpringBootApplication(exclude = SecurityAutoConfiguration.class)
@EntityScan("com.vulntrade.model")
@EnableJpaRepositories("com.vulntrade.repository")
@EnableScheduling
@Import({Accounts.class, Balances.class, Ledger.class, EventPublisher.class, MatchingCoordinator.class,
        JacksonConfig.class})
public class EquitiesApplication {

    public static void main(String[] args) {
        SpringApplication.run(EquitiesApplication.class, args);
    }

    /** Who is calling (headers set by the gateway) + request id, for the security log. */
    @Bean
    public FilterRegistrationBean<InternalRequestFilter> internalRequestFilter() {
        return new FilterRegistrationBean<>(new InternalRequestFilter());
    }
}
