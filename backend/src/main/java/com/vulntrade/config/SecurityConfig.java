package com.vulntrade.config;

import com.vulntrade.security.JwtAuthFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final JwtAuthFilter jwtAuthFilter;

    public SecurityConfig(JwtAuthFilter jwtAuthFilter) {
        this.jwtAuthFilter = jwtAuthFilter;
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
                // Public endpoints
                .antMatchers("/api/auth/**").permitAll()
                .antMatchers("/api/health").permitAll()
                .antMatchers("/api/market/prices").permitAll()
                // VULN: Actuator fully exposed
                .antMatchers("/actuator/**").permitAll()
                // VULN: H2 console exposed
                .antMatchers("/h2-console/**").permitAll()
                // VULN: WebSocket endpoints open
                .antMatchers("/ws/**").permitAll()
                .antMatchers("/ws-sockjs/**").permitAll()
                // VULN: Debug endpoints "protected" by hardcoded key only
                .antMatchers("/api/debug/**").permitAll()
                // Everything else requires auth (but filter is bypassable)
                .anyRequest().authenticated()
            .and()
            .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
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
