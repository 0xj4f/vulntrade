package com.vulntrade.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.Collections;

@Configuration
public class CorsConfig {

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        // VULN: Allow all origins
        configuration.setAllowedOriginPatterns(Collections.singletonList("*"));
        // VULN: Allow all methods
        configuration.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"));
        // VULN: Allow all headers
        configuration.setAllowedHeaders(Collections.singletonList("*"));
        // VULN: Allow credentials with wildcard origin
        configuration.setAllowCredentials(true);
        // VULN: Expose all headers
        configuration.setExposedHeaders(Arrays.asList("Authorization", "X-API-Key", "X-Debug-Key"));

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
