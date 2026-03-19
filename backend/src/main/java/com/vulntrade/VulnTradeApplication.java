package com.vulntrade;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class VulnTradeApplication {

    public static void main(String[] args) {
        SpringApplication.run(VulnTradeApplication.class, args);
    }
}
