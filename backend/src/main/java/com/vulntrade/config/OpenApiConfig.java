package com.vulntrade.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.License;
import io.swagger.v3.oas.models.security.SecurityScheme;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.Components;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * OpenAPI (Swagger 3.0) Configuration for VulnTrade Backend.
 * Provides API documentation accessible at:
 * - UI: http://localhost:8085/swagger-ui.html
 * - JSON: http://localhost:8085/v3/api-docs
 */
@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI customOpenAPI() {
        return new OpenAPI()
            .info(new Info()
                .title("VulnTrade API")
                .version("1.0.0")
                .description("Deliberately vulnerable trading platform for security testing and red team training.\n\n" +
                    "**WARNING**: This application contains intentional vulnerabilities for educational purposes:\n" +
                    "- IDOR (Insecure Direct Object References)\n" +
                    "- SQL Injection\n" +
                    "- Cross-Site Scripting (XSS)\n" +
                    "- Weak Authentication\n" +
                    "- Information Disclosure\n" +
                    "- Race Conditions\n" +
                    "- Sign Flip Vulnerabilities\n\n" +
                    "Use only in isolated lab environments.")
                .contact(new Contact()
                    .name("VulnTrade Team")
                    .email("team@vulntrade.local")
                    .url("http://localhost:3001"))
                .license(new License()
                    .name("Educational - For Security Training Only")
                    .url("https://example.com/license")))
            .addSecurityItem(new SecurityRequirement().addList("Bearer Token"))
            .components(new Components()
                .addSecuritySchemes("Bearer Token", new SecurityScheme()
                    .type(SecurityScheme.Type.HTTP)
                    .scheme("bearer")
                    .bearerFormat("JWT")
                    .description("JWT Token obtained from /api/auth/login or /api/auth/register")));
    }
}

