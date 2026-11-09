package com.vulntrade.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Admin actions (halt / resume / set price) are still started on the platform (/app/admin.*,
 * where they are logged and announced), then passed to the product service that owns the symbol:
 *
 *   symbols.asset_class   FX -> fx-internals    EQUITY -> equities-internals    CRYPTO -> crypto-internals
 *
 * Only the symbol (and price) is passed on, never the free-text "reason": that is logged once,
 * here, so the Log4Shell lab chain stays in one JVM.
 */
@Component
public class ProductAdmin {

    private static final Logger log = LoggerFactory.getLogger(ProductAdmin.class);

    /** Asset classes already moved out of the platform into their own service. */
    private static final Set<String> SPLIT = Set.of("FX");

    private final JdbcTemplate jdbc;
    private final RestTemplate http;

    public ProductAdmin(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(2_000);
        factory.setReadTimeout(10_000);
        this.http = new RestTemplate(factory);
    }

    /** The internals service of a symbol ("fx", "equities", "crypto"), or null if the platform still runs it. */
    public String owner(String symbol) {
        List<String> classes = jdbc.queryForList("SELECT asset_class FROM symbols WHERE symbol = ?", String.class,
                symbol == null ? "" : symbol.toUpperCase());
        String assetClass = classes.isEmpty() ? null : classes.get(0);
        if (assetClass == null || !SPLIT.contains(assetClass)) {
            return null;
        }
        return "EQUITY".equals(assetClass) ? "equities" : assetClass.toLowerCase();
    }

    /** Pass an admin action on to the owning service. Returns false when the platform still owns the symbol. */
    public boolean forward(String symbol, String action, Map<String, Object> body) {
        String owner = owner(symbol);
        if (owner == null) {
            return false;
        }
        try {
            http.postForObject("http://" + owner + "-internals:8080/internal/admin/" + action, body, Map.class);
        } catch (Exception e) {
            log.warn("Admin {} for {} not delivered to {}-internals: {}", action, symbol, owner, e.getMessage());
        }
        return true;
    }
}
