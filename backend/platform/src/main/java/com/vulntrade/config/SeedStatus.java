package com.vulntrade.config;

import org.springframework.stereotype.Component;

/**
 * "Has the startup seeding finished?" /api/health answers 503 until it has, so Kubernetes keeps
 * the product services (which wait for platform health) from starting on a half-seeded database.
 */
@Component
public class SeedStatus {

    private volatile boolean ready;

    public boolean isReady() {
        return ready;
    }

    public void markReady() {
        ready = true;
    }
}
