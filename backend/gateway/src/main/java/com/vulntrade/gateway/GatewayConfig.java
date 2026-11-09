package com.vulntrade.gateway;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.DefaultResponseErrorHandler;
import org.springframework.web.client.RestTemplate;

/** The HTTP client the gateway uses to call the internals service and the platform. */
@Configuration
public class GatewayConfig {

    @Bean
    public RestTemplate restTemplate() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(2_000);
        // Longer than the internals' lock wait (10 s) + transaction timeout (30 s)
        factory.setReadTimeout(45_000);
        RestTemplate rest = new RestTemplate(factory);
        // Pass 4xx/5xx answers through to the client unchanged instead of throwing
        rest.setErrorHandler(new DefaultResponseErrorHandler() {
            @Override
            public boolean hasError(ClientHttpResponse response) {
                return false;
            }
        });
        return rest;
    }
}
