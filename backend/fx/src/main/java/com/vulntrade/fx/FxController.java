package com.vulntrade.fx;

import com.vulntrade.money.Accounts;
import com.vulntrade.money.Balances;
import com.vulntrade.security.logging.Outcome;
import com.vulntrade.security.logging.SecurityEvent;
import com.vulntrade.web.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import java.util.*;

import static com.vulntrade.security.logging.SecurityEventLogger.details;
import static com.vulntrade.security.logging.SecurityEventLogger.log;

/**
 * FX API (called through fx-gateway, which already checked the token):
 *
 *   GET  /api/fx/pairs                  the pairs we quote                (public)
 *   GET  /api/fx/quotes                 latest quote per pair             (public)
 *   POST /api/fx/orders                 {pair, side, amount, quoteId}     -> FILLED or REJECTED
 *   GET  /api/fx/orders[?userId=]       my FX orders
 *   GET  /api/fx/balances[?userId=]     my FX account (USD, EUR, GBP, JPY)
 *   POST /internal/admin/halt|resume    {symbol}  (platform admin, never routed from outside)
 */
@RestController
public class FxController {

    private final FxOms oms;
    private final PriceEngine priceEngine;
    private final Accounts accounts;
    private final Balances balances;
    private final JdbcTemplate jdbc;

    public FxController(FxOms oms, PriceEngine priceEngine, Accounts accounts, Balances balances, JdbcTemplate jdbc) {
        this.oms = oms;
        this.priceEngine = priceEngine;
        this.accounts = accounts;
        this.balances = balances;
        this.jdbc = jdbc;
    }

    @GetMapping("/api/fx/pairs")
    public List<Map<String, Object>> pairs() {
        List<Map<String, Object>> out = new ArrayList<>();
        FxPairs.ALL.values().forEach(p -> out.add(Map.of("pair", p.symbol, "base", p.base, "quote", p.quote,
                "pip", p.pip)));
        return out;
    }

    @GetMapping("/api/fx/quotes")
    public List<Map<String, Object>> quotes() {
        return priceEngine.latestQuotes();
    }

    @PostMapping("/api/fx/orders")
    public ResponseEntity<?> placeOrder(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        Long userId = CurrentUser.effectiveUser(request, body.get("userId"));   // VULN #71
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        try {
            return ResponseEntity.ok(oms.place(userId, CurrentUser.username(request), body));
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid number"));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", String.valueOf(e.getMessage())));
        }
    }

    /** VULN (#47 style IDOR): ?userId= shows anyone's FX orders. */
    @GetMapping("/api/fx/orders")
    public ResponseEntity<?> orders(@RequestParam(required = false) Long userId, HttpServletRequest request) {
        Long who = userId != null ? userId : CurrentUser.id(request);
        if (who == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        readOfOtherUser(who, request, "fx_orders");
        return ResponseEntity.ok(jdbc.queryForList("SELECT id AS \"orderId\", symbol AS pair, side, quantity AS amount, "
                + "price, status, status_reason AS reason, client_order_id AS \"clientOrderId\", created_at AS \"createdAt\" "
                + "FROM orders WHERE product = 'FX' AND user_id = ? ORDER BY id DESC LIMIT 200", who));
    }

    /** VULN (#47 style IDOR): ?userId= shows anyone's FX balances. */
    @GetMapping("/api/fx/balances")
    public ResponseEntity<?> fxBalances(@RequestParam(required = false) Long userId, HttpServletRequest request) {
        Long who = userId != null ? userId : CurrentUser.id(request);
        if (who == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        readOfOtherUser(who, request, "fx_balances");
        List<Map<String, Object>> rows = new ArrayList<>();
        Long account = accounts.find(who, Accounts.FX);
        if (account != null) {
            balances.all(account).forEach((asset, ah) -> rows.add(Map.of("asset", asset, "available", ah[0], "held", ah[1])));
        }
        return ResponseEntity.ok(Map.of("userId", who, "product", Accounts.FX, "balances", rows));
    }

    @PostMapping("/internal/admin/halt")
    public Map<String, Object> halt(@RequestBody Map<String, Object> body) {
        oms.halt(String.valueOf(body.get("symbol")));
        return Map.of("halted", body.get("symbol"));
    }

    @PostMapping("/internal/admin/resume")
    public Map<String, Object> resume(@RequestBody Map<String, Object> body) {
        oms.resume(String.valueOf(body.get("symbol")));
        return Map.of("resumed", body.get("symbol"));
    }

    private static void readOfOtherUser(Long who, HttpServletRequest request, String resource) {
        Long me = CurrentUser.id(request);
        if (me == null || !me.equals(who)) {
            log(SecurityEvent.SENSITIVE_DATA_READ, Outcome.SUCCESS, details("resource", resource, "targetUserId", who));
        }
    }
}
