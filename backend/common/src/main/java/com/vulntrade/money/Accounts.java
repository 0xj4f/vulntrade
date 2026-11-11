package com.vulntrade.money;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Every user has four accounts:
 *
 *   MAIN      funding account. Its cash is users.balance. Deposits and withdrawals happen here.
 *   FX        USD, EUR, GBP, JPY ...            (rows in the balances table)
 *   EQUITIES  USD (shares live in the positions table)
 *   CRYPTO    USD, BTC, ETH ...
 *
 * Money moves between your own accounts with a transfer (platform: POST /api/accounts/transfer).
 * Accounts are opened once, when the user is created (register / seed). Reading never creates one.
 */
@Component
public class Accounts {

    public static final String MAIN = "MAIN";
    public static final String FX = "FX";
    public static final String EQUITIES = "EQUITIES";
    public static final String CRYPTO = "CRYPTO";
    public static final List<String> PRODUCTS = List.of(FX, EQUITIES, CRYPTO);
    public static final List<String> ALL = List.of(MAIN, FX, EQUITIES, CRYPTO);

    /** Every new product account starts with this much demo USD, so new users can trade at once. */
    public static final BigDecimal DEMO_FUNDS = new BigDecimal("10000");

    private final JdbcTemplate jdbc;
    private final Balances balances;
    private final Ledger ledger;
    private final Map<String, Long> idCache = new ConcurrentHashMap<>();   // account ids never change

    public Accounts(JdbcTemplate jdbc, Balances balances, Ledger ledger) {
        this.jdbc = jdbc;
        this.balances = balances;
        this.ledger = ledger;
    }

    /** The id of a user's account for one product, or null if it does not exist. */
    public Long find(Long userId, String product) {
        if (userId == null || product == null) {
            return null;
        }
        String key = userId + ":" + product;
        Long cached = idCache.get(key);
        if (cached != null) {
            return cached;
        }
        List<Long> ids = jdbc.queryForList("SELECT id FROM accounts WHERE user_id = ? AND product = ?",
                Long.class, userId, product);
        if (ids.isEmpty()) {
            return null;
        }
        idCache.put(key, ids.get(0));
        return ids.get(0);
    }

    /**
     * Open MAIN + FX + EQUITIES + CRYPTO for a user (safe to call again: existing ones are kept).
     * With demoFunds, each product account that is NEW gets {@link #DEMO_FUNDS} USD (a DEPOSIT).
     * Returns true if the product accounts were created by this call.
     */
    public boolean openAll(Long userId, boolean demoFunds) {
        boolean created = false;
        jdbc.update("INSERT INTO accounts (user_id, product) VALUES (?, ?) ON CONFLICT (user_id, product) DO NOTHING",
                userId, MAIN);
        for (String product : PRODUCTS) {
            List<Long> createdIds = jdbc.queryForList(
                    "INSERT INTO accounts (user_id, product) VALUES (?, ?) "
                            + "ON CONFLICT (user_id, product) DO NOTHING RETURNING id",
                    Long.class, userId, product);
            created = created || !createdIds.isEmpty();
            if (!createdIds.isEmpty() && demoFunds) {
                Long accountId = createdIds.get(0);
                BigDecimal after = balances.credit(accountId, "USD", DEMO_FUNDS);
                ledger.record(userId, accountId, "USD", "DEPOSIT", DEMO_FUNDS, after,
                        "Demo funds for the " + product + " account", null);
            }
        }
        return created;
    }
}
