package com.vulntrade;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class VulnTradeApplication {

    public static void main(String[] args) {
        // All LocalDateTime values are UTC; the API writes them with a 'Z' suffix (JacksonConfig).
        java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"));
        SpringApplication.run(VulnTradeApplication.class, args);
    }
}
