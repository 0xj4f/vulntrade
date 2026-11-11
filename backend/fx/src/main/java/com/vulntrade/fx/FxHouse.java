package com.vulntrade.fx;

import com.vulntrade.money.Accounts;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The House: VulnTrade itself, on the other side of every FX trade (B-book).
 *
 * Its FX money lives in the house user's (user 1) FX account. Its position in a currency is
 * "what it holds now minus what it was seeded with": short 10,000 EUR = it sold 10,000 EUR
 * more than it bought, and loses money if EUR goes up. The exposure limit stops it from
 * taking more risk than that in one currency.
 */
@Component
public class FxHouse {

    public static final long HOUSE_USER_ID = 1L;

    /** The most the house will be long or short in one currency. */
    private static final Map<String, BigDecimal> MAX_NET = Map.of(
            "EUR", new BigDecimal("1000000"),
            "GBP", new BigDecimal("1000000"),
            "USD", new BigDecimal("1000000"),
            "JPY", new BigDecimal("150000000"));

    private final Accounts accounts;
    private final JdbcTemplate jdbc;
    private final Map<String, BigDecimal> seeded = new ConcurrentHashMap<>();   // never changes after startup

    public FxHouse(Accounts accounts, JdbcTemplate jdbc) {
        this.accounts = accounts;
        this.jdbc = jdbc;
    }

    public Long accountId() {
        return accounts.find(HOUSE_USER_ID, Accounts.FX);
    }

    /** House position in a currency: + it holds more than it started with, - it owes. */
    public BigDecimal net(String currency) {
        BigDecimal now = jdbc.queryForObject("SELECT COALESCE(SUM(available + held), 0) FROM balances "
                + "WHERE account_id = ? AND asset = ?", BigDecimal.class, accountId(), currency);
        BigDecimal start = seeded.get(currency);
        if (start == null) {
            start = jdbc.queryForObject("SELECT COALESCE(SUM(amount), 0) FROM transactions "
                            + "WHERE user_id = ? AND account_id = ? AND asset = ? AND type = 'HOUSE_SEED'",
                    BigDecimal.class, HOUSE_USER_ID, accountId(), currency);
            if (start.signum() != 0) {
                seeded.put(currency, start);   // only cache once the platform has seeded the house
            }
        }
        return now.subtract(start);
    }

    /**
     * May the house take a trade that changes its position by {@code delta}? Yes if it stays
     * inside its limit, and always if the trade makes its position smaller (less risk).
     */
    public boolean withinLimit(String currency, BigDecimal delta) {
        BigDecimal max = MAX_NET.getOrDefault(currency, new BigDecimal("1000000"));
        BigDecimal now = net(currency);
        BigDecimal after = now.add(delta);
        return after.abs().compareTo(max) <= 0 || after.abs().compareTo(now.abs()) < 0;
    }
}
