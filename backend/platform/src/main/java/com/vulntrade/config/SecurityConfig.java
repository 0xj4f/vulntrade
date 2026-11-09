package com.vulntrade.config;

import com.vulntrade.security.ApiKeyAuthFilter;
import com.vulntrade.security.JwtAuthFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.filter.HiddenHttpMethodFilter;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final JwtAuthFilter jwtAuthFilter;
    private final ApiKeyAuthFilter apiKeyAuthFilter;

    public SecurityConfig(JwtAuthFilter jwtAuthFilter, ApiKeyAuthFilter apiKeyAuthFilter) {
        this.jwtAuthFilter = jwtAuthFilter;
        this.apiKeyAuthFilter = apiKeyAuthFilter;
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // VULN: CSRF disabled
            .csrf().disable()
            // VULN: CORS allows everything
            .cors().and()
            // VULN: Frame options disabled (clickjacking)
            .headers().frameOptions().disable().and()
            .sessionManagement()
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            .and()
            .authorizeRequests()
                // Swagger / OpenAPI documentation - permit all
                .antMatchers("/swagger-ui/**").permitAll()
                .antMatchers("/swagger-ui.html").permitAll()
                .antMatchers("/v3/api-docs/**").permitAll()
                .antMatchers("/v3/api-docs").permitAll()
                // Public endpoints
                .antMatchers("/api/auth/**").permitAll()
                .antMatchers("/api/health").permitAll()
                .antMatchers("/api/market/**").permitAll()
                // VULN: Actuator fully exposed
                .antMatchers("/actuator/**").permitAll()
                // VULN: H2 console exposed
                .antMatchers("/h2-console/**").permitAll()
                // VULN: WebSocket endpoints open
                .antMatchers("/ws/**").permitAll()
                .antMatchers("/ws-sockjs/**").permitAll()
                // VULN: Debug endpoints "protected" by hardcoded key only
                .antMatchers("/api/debug/**").permitAll()
                // VULN: Admin endpoints - "restricted" but bypassable
                // The method override header can change POST→GET to bypass method-based rules
                .antMatchers("/api/admin/**").hasRole("ADMIN")
                // Orders require auth (but IDOR exists)
                .antMatchers("/api/orders/**").authenticated()
                // Export requires auth (but IDOR + CSV injection exists)
                .antMatchers("/api/export/**").authenticated()
                // Account operations require auth
                .antMatchers("/api/accounts/**").authenticated()
                // Profile photos are public so <img> tags load without JWT headers
                .antMatchers(HttpMethod.GET, "/api/users/*/photo").permitAll()
                // User endpoints require auth (but IDOR exists)
                .antMatchers("/api/users/**").authenticated()
                // Everything else requires auth
                .anyRequest().authenticated()
            .and()
            .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterAfter(apiKeyAuthFilter, JwtAuthFilter.class);

        return http.build();
    }

    /**
     * VULN: Hidden HTTP method filter allows X-HTTP-Method-Override header.
     * This can be used to bypass method-based security rules.
     * E.g., send POST with X-HTTP-Method-Override: GET to bypass GET restrictions.
     */
    @Bean
    public HiddenHttpMethodFilter hiddenHttpMethodFilter() {
        return new HiddenHttpMethodFilter();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public AuthenticationManager authenticationManager(
            AuthenticationConfiguration authConfig) throws Exception {
        return authConfig.getAuthenticationManager();
    }
}
