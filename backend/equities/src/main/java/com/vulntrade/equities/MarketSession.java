package com.vulntrade.equities;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Is the (simulated) stock exchange open? Stocks only trade during the market session.
 *
 * The lab keeps it simple: the session is OPEN or CLOSED, set at startup (MARKET_SESSION env)
 * and switched by an admin (POST /api/equities/admin/session). Real exchanges use a calendar
 * (09:30-16:00, holidays) - the check would look the same.
 */
@Component
public class MarketSession {

    private volatile boolean open;

    public MarketSession(@Value("${equities.market-session:OPEN}") String initial) {
        this.open = !"CLOSED".equalsIgnoreCase(initial);
    }

    public boolean isOpen() {
        return open;
    }

    public void set(boolean open) {
        this.open = open;
    }

    public String status() {
        return open ? "OPEN" : "CLOSED";
    }
}
