package com.vulntrade.money;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;

/**
 * The money history ("transactions" table). Every movement says which account and which asset.
 *
 * account_id NULL means the MAIN account (users.balance), which keeps the existing deposit,
 * withdraw and admin-adjust code unchanged. Types:
 *   DEPOSIT, WITHDRAW, ADJUSTMENT, HOUSE_SEED     money entering/leaving the platform
 *   TRANSFER_OUT, TRANSFER_IN                     between your own accounts (nets to zero)
 *   TRADE_BUY, TRADE_SELL                         the cash leg of a trade (fees included)
 *   TRADE_LEG                                     the other asset of an FX/crypto trade (EUR, BTC, ...)
 */
@Component
public class Ledger {

    private final JdbcTemplate jdbc;

    public Ledger(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void record(Long userId, Long accountId, String asset, String type, BigDecimal amount,
                       BigDecimal balanceAfter, String description, String referenceId) {
        jdbc.update("INSERT INTO transactions (user_id, account_id, asset, type, amount, balance_after, "
                        + "description, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, now())",
                userId, accountId, asset, type, amount, balanceAfter, description, referenceId);
    }
}
