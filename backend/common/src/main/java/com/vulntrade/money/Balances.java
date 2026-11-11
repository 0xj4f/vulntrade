package com.vulntrade.money;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Money inside a product account (FX / EQUITIES / CRYPTO), one row per account + asset:
 *
 *   available  money you can use right now
 *   held       money locked for an open order (not spent yet, not usable)
 *
 * Every change goes through ONE atomic SQL statement ({@link #move}): "available = available + x".
 * Two requests changing the same row at the same time can never overwrite each other, so normal
 * traffic never loses money. (Races that are part of the lab live in the CHECKS before a move,
 * never inside the move itself.)
 *
 *   hold      available -> held        (order placed)
 *   release   held -> available        (order cancelled / unused part)
 *   spendHeld held -> gone             (trade happened, paid to the other side)
 *   credit    + available              (you received money)
 */
@Component
public class Balances {

    private final JdbcTemplate jdbc;

    public Balances(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Add deltas to one balance row (created if missing). Returns available + held afterwards. */
    public BigDecimal move(Long accountId, String asset, BigDecimal dAvailable, BigDecimal dHeld) {
        return jdbc.queryForObject(
                "INSERT INTO balances (account_id, asset, available, held) VALUES (?, ?, ?, ?) "
                        + "ON CONFLICT (account_id, asset) DO UPDATE SET "
                        + "available = balances.available + EXCLUDED.available, "
                        + "held = balances.held + EXCLUDED.held, updated_at = now() "
                        + "RETURNING available + held",
                BigDecimal.class, accountId, asset, dAvailable, dHeld);
    }

    public BigDecimal credit(Long accountId, String asset, BigDecimal amount) {
        return move(accountId, asset, amount, BigDecimal.ZERO);
    }

    /** Take money from available without checking (the house, and a few lab bugs, use this). */
    public BigDecimal debit(Long accountId, String asset, BigDecimal amount) {
        return move(accountId, asset, amount.negate(), BigDecimal.ZERO);
    }

    public BigDecimal hold(Long accountId, String asset, BigDecimal amount) {
        return move(accountId, asset, amount.negate(), amount);
    }

    public BigDecimal release(Long accountId, String asset, BigDecimal amount) {
        return move(accountId, asset, amount, amount.negate());
    }

    public BigDecimal spendHeld(Long accountId, String asset, BigDecimal amount) {
        return move(accountId, asset, BigDecimal.ZERO, amount.negate());
    }

    /** Take money from available only if there is enough. Returns false (and changes nothing) otherwise. */
    public boolean debitIfAvailable(Long accountId, String asset, BigDecimal amount) {
        return jdbc.update("UPDATE balances SET available = available - ?, updated_at = now() "
                + "WHERE account_id = ? AND asset = ? AND available >= ?", amount, accountId, asset, amount) == 1;
    }

    public BigDecimal available(Long accountId, String asset) {
        List<BigDecimal> rows = jdbc.queryForList(
                "SELECT available FROM balances WHERE account_id = ? AND asset = ?", BigDecimal.class, accountId, asset);
        return rows.isEmpty() ? BigDecimal.ZERO : rows.get(0);
    }

    /** All balances of one account: asset -> {available, held}. */
    public Map<String, BigDecimal[]> all(Long accountId) {
        Map<String, BigDecimal[]> out = new LinkedHashMap<>();
        jdbc.query("SELECT asset, available, held FROM balances WHERE account_id = ? ORDER BY asset",
                rs -> {
                    out.put(rs.getString(1), new BigDecimal[]{rs.getBigDecimal(2), rs.getBigDecimal(3)});
                }, accountId);
        return out;
    }
}
