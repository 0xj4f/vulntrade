package com.vulntrade.controller;

import com.vulntrade.money.Accounts;
import com.vulntrade.money.Balances;
import com.vulntrade.repository.UserRepository;
import com.vulntrade.security.logging.Outcome;
import com.vulntrade.security.logging.SecurityEvent;
import com.vulntrade.security.logging.SecurityEventLogger;
import com.vulntrade.service.TransferService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.*;

import static com.vulntrade.security.logging.SecurityEventLogger.details;
import static com.vulntrade.security.logging.SecurityEventLogger.log;

/**
 * 1.0.0: a user's accounts (MAIN + FX + EQUITIES + CRYPTO) and transfers between them.
 *
 *   GET  /api/accounts            my accounts with their balances
 *   POST /api/accounts/transfer   {"from":"MAIN","to":"CRYPTO","amount":"500"}
 *
 * (The older /api/accounts/balance, /deposit, /withdraw, /transactions stay in AccountController
 *  and work on MAIN.)
 */
@RestController
@RequestMapping("/api/accounts")
public class AccountsController {

    private final Accounts accounts;
    private final Balances balances;
    private final UserRepository userRepository;
    private final TransferService transferService;

    public AccountsController(Accounts accounts, Balances balances, UserRepository userRepository,
                              TransferService transferService) {
        this.accounts = accounts;
        this.balances = balances;
        this.userRepository = userRepository;
        this.transferService = transferService;
    }

    @GetMapping
    public ResponseEntity<?> myAccounts() {
        Long userId = SecurityEventLogger.currentUserId();
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        List<Map<String, Object>> list = new ArrayList<>();
        for (String product : Accounts.ALL) {
            Map<String, Object> acc = new LinkedHashMap<>();
            acc.put("product", product);
            acc.put("accountId", accounts.find(userId, product));
            List<Map<String, Object>> rows = new ArrayList<>();
            if (Accounts.MAIN.equals(product)) {
                rows.add(row("USD", userRepository.findBalanceById(userId), BigDecimal.ZERO));
            } else if (accounts.find(userId, product) != null) {
                balances.all(accounts.find(userId, product)).forEach((asset, ah) -> rows.add(row(asset, ah[0], ah[1])));
            }
            acc.put("balances", rows);
            list.add(acc);
        }
        return ResponseEntity.ok(Map.of("userId", userId, "accounts", list));
    }

    @PostMapping("/transfer")
    public ResponseEntity<?> transfer(@RequestBody Map<String, Object> body) {
        Long userId = SecurityEventLogger.currentUserId();
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        String from = String.valueOf(body.get("from"));
        String to = String.valueOf(body.get("to"));
        Object rawAmount = body.get("amount");
        try {
            BigDecimal amount = rawAmount == null ? null : new BigDecimal(rawAmount.toString());
            Map<String, Object> result = transferService.transfer(userId, from, to, amount);
            log(SecurityEvent.TRANSFER_COMPLETED, Outcome.SUCCESS,
                    details("from", result.get("from"), "to", result.get("to"), "amount", amount,
                            "transferId", result.get("transferId")));
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException e) {   // includes NumberFormatException
            log(SecurityEvent.TRANSFER_FAILED, Outcome.FAILURE,
                    details("from", from, "to", to, "amount", rawAmount, "reason", e.getMessage()));
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage() == null ? "Invalid amount" : e.getMessage()));
        }
    }

    private static Map<String, Object> row(String asset, BigDecimal available, BigDecimal held) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("asset", asset);
        r.put("available", available);
        r.put("held", held);
        return r;
    }
}
