package com.vulntrade.service;

import com.vulntrade.money.Accounts;
import com.vulntrade.money.Balances;
import com.vulntrade.money.Ledger;
import com.vulntrade.repository.UserRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Move USD between your own accounts: MAIN <-> FX / EQUITIES / CRYPTO.
 *
 * This is the "safe" version (transfer bugs are a later lab topic):
 *   1. only your own accounts (the user comes from the token, accounts are named, not numbered)
 *   2. USD only, amount > 0
 *   3. only from available money (never held money), with an atomic "only if enough" debit
 * Everything happens in one database transaction: either both sides move, or nothing does.
 */
@Service
public class TransferService {

    private final Accounts accounts;
    private final Balances balances;
    private final Ledger ledger;
    private final UserRepository userRepository;
    private final JdbcTemplate jdbc;

    public TransferService(Accounts accounts, Balances balances, Ledger ledger,
                           UserRepository userRepository, JdbcTemplate jdbc) {
        this.accounts = accounts;
        this.balances = balances;
        this.ledger = ledger;
        this.userRepository = userRepository;
        this.jdbc = jdbc;
    }

    @Transactional
    public Map<String, Object> transfer(Long userId, String from, String to, BigDecimal amount) {
        from = from == null ? "" : from.toUpperCase();
        to = to == null ? "" : to.toUpperCase();
        if (!Accounts.ALL.contains(from) || !Accounts.ALL.contains(to) || from.equals(to)) {
            throw new IllegalArgumentException("Choose two different accounts: MAIN, FX, EQUITIES or CRYPTO");
        }
        if (amount == null || amount.signum() <= 0) {
            throw new IllegalArgumentException("Amount must be greater than zero");
        }

        // 1. Take the money out (only if there is enough available)
        boolean taken = Accounts.MAIN.equals(from)
                ? userRepository.debitIfSufficient(userId, amount) == 1
                : balances.debitIfAvailable(accounts.find(userId, from), "USD", amount);
        if (!taken) {
            throw new IllegalArgumentException("Insufficient funds in " + from);
        }

        // 2. Put it in
        if (Accounts.MAIN.equals(to)) {
            userRepository.credit(userId, amount);
        } else {
            balances.credit(accounts.find(userId, to), "USD", amount);
        }

        // 3. Write it down: the transfer, and one ledger row per side (they add up to zero)
        Long transferId = jdbc.queryForObject("INSERT INTO transfers (user_id, from_product, to_product, asset, amount) "
                + "VALUES (?, ?, ?, 'USD', ?) RETURNING id", Long.class, userId, from, to, amount);
        String ref = "TRANSFER-" + transferId;
        ledger.record(userId, accountIdOrMain(userId, from), "USD", "TRANSFER_OUT", amount.negate(),
                balanceOf(userId, from), "Transfer to " + to, ref);
        ledger.record(userId, accountIdOrMain(userId, to), "USD", "TRANSFER_IN", amount,
                balanceOf(userId, to), "Transfer from " + from, ref);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("transferId", transferId);
        result.put("from", from);
        result.put("to", to);
        result.put("asset", "USD");
        result.put("amount", amount);
        result.put("fromBalance", balanceOf(userId, from));
        result.put("toBalance", balanceOf(userId, to));
        result.put("status", "COMPLETED");
        return result;
    }

    /** USD in one of the user's accounts (MAIN = users.balance). */
    public BigDecimal balanceOf(Long userId, String product) {
        if (Accounts.MAIN.equals(product)) {
            return userRepository.findBalanceById(userId);
        }
        return balances.available(accounts.find(userId, product), "USD");
    }

    /** Ledger convention: MAIN rows have account_id NULL. */
    private Long accountIdOrMain(Long userId, String product) {
        return Accounts.MAIN.equals(product) ? null : accounts.find(userId, product);
    }
}
