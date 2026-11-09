package com.vulntrade.equities;

import com.vulntrade.model.Order;
import com.vulntrade.model.Position;
import com.vulntrade.model.Symbol;
import com.vulntrade.model.dto.OrderBookEntry;
import com.vulntrade.model.dto.OrderRequest;
import com.vulntrade.money.Accounts;
import com.vulntrade.money.Balances;
import com.vulntrade.repository.OrderRepository;
import com.vulntrade.repository.PositionRepository;
import com.vulntrade.repository.SymbolRepository;
import com.vulntrade.security.logging.Outcome;
import com.vulntrade.security.logging.SecurityEvent;
import com.vulntrade.web.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import java.util.stream.Collectors;

import static com.vulntrade.security.logging.SecurityEventLogger.details;
import static com.vulntrade.security.logging.SecurityEventLogger.log;

/**
 * Equities API (called through equities-gateway, which already checked the token):
 *
 *   GET    /api/equities/market/prices[/{symbol}]   stock prices                    (public)
 *   GET    /api/equities/market/orderbook/{symbol}  the XSIM order book             (public)
 *   GET    /api/equities/market/candles?symbol=     OHLC candles                    (public)
 *   GET    /api/equities/session                    market OPEN / CLOSED            (public)
 *   POST   /api/equities/orders                     place an order
 *   GET    /api/equities/orders[?userId=]           my orders
 *   GET    /api/equities/orders/{id}                one order
 *   POST   /api/equities/orders/{id}/cancel         cancel
 *   DELETE /api/equities/orders/{id}                delete an order that never traded
 *   GET    /api/equities/positions[?userId=]        my shares
 *   GET    /api/equities/balances[?userId=]         my EQUITIES account (USD)
 *   POST   /api/equities/admin/session              {open: true|false}   (role ADMIN, from the token)
 *   POST   /internal/admin/halt|resume|price        (platform admin; never routed from outside)
 */
@RestController
public class EquitiesController {

    private static final String PRODUCT = Accounts.EQUITIES;

    private final OrderService orderService;
    private final OrderRepository orderRepository;
    private final PositionRepository positionRepository;
    private final SymbolRepository symbolRepository;
    private final OrderBookService orderBookService;
    private final CandleService candleService;
    private final PriceSimulatorService priceSimulator;
    private final MarketSession session;
    private final Accounts accounts;
    private final Balances balances;

    public EquitiesController(OrderService orderService, OrderRepository orderRepository,
                              PositionRepository positionRepository, SymbolRepository symbolRepository,
                              OrderBookService orderBookService, CandleService candleService,
                              PriceSimulatorService priceSimulator, MarketSession session,
                              Accounts accounts, Balances balances) {
        this.orderService = orderService;
        this.orderRepository = orderRepository;
        this.positionRepository = positionRepository;
        this.symbolRepository = symbolRepository;
        this.orderBookService = orderBookService;
        this.candleService = candleService;
        this.priceSimulator = priceSimulator;
        this.session = session;
        this.accounts = accounts;
        this.balances = balances;
    }

    // ---- market data (public) -----------------------------------------------------------------

    @GetMapping("/api/equities/market/prices")
    public List<Symbol> prices() {
        return symbolRepository.findAll().stream()
                .filter(s -> "EQUITY".equals(s.getAssetClass()))
                .map(this::withSessionChange)
                .collect(Collectors.toList());
    }

    @GetMapping("/api/equities/market/prices/{symbol}")
    public ResponseEntity<?> price(@PathVariable String symbol) {
        return symbolRepository.findById(symbol)
                .filter(s -> "EQUITY".equals(s.getAssetClass()))
                .map(s -> ResponseEntity.ok((Object) withSessionChange(s)))
                .orElse(ResponseEntity.notFound().build());
    }

    /** VULN #60/#72: every entry shows the order id, user id and username. */
    @GetMapping("/api/equities/market/orderbook/{symbol}")
    public Map<String, Object> orderBook(@PathVariable String symbol) {
        OrderBookService.Book book = orderBookService.snapshot(symbol);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("symbol", symbol);
        m.put("bids", book.bids.stream().map(EquitiesController::restEntry).collect(Collectors.toList()));
        m.put("asks", book.asks.stream().map(EquitiesController::restEntry).collect(Collectors.toList()));
        m.put("levels", book.levels());
        m.put("bidCount", book.bids.size());
        m.put("askCount", book.asks.size());
        m.put("timestamp", System.currentTimeMillis());
        return m;
    }

    @GetMapping("/api/equities/market/candles")
    public ResponseEntity<?> candles(@RequestParam String symbol,
                                     @RequestParam(defaultValue = "1m") String interval,
                                     @RequestParam(defaultValue = "300") int limit) {
        if (!CandleService.isValidInterval(interval)) {
            return ResponseEntity.badRequest().body(Map.of("error", "interval must be one of 1m, 5m, 15m, 1h"));
        }
        if (!symbolRepository.existsById(symbol)) {
            return ResponseEntity.status(404).body(Map.of("error", "Unknown symbol: " + symbol));
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("symbol", symbol);
        body.put("interval", interval);
        body.put("candles", candleService.candles(symbol, interval, Math.max(1, Math.min(limit, 1000))));
        return ResponseEntity.ok(body);
    }

    @GetMapping("/api/equities/session")
    public Map<String, Object> session() {
        return Map.of("exchange", "XSIM", "status", session.status());
    }

    /** Role comes from the token body (VULN #56): a forged ADMIN token can close the market. */
    @PostMapping("/api/equities/admin/session")
    public ResponseEntity<?> setSession(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        if (!"ADMIN".equalsIgnoreCase(CurrentUser.role(request))) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Admin only"));
        }
        session.set(Boolean.parseBoolean(String.valueOf(body.get("open"))));
        log(SecurityEvent.ADMIN_ACTION, Outcome.SUCCESS, details("action", "market_session", "status", session.status()));
        return ResponseEntity.ok(session());
    }

    // ---- orders -------------------------------------------------------------------------------

    @PostMapping("/api/equities/orders")
    public ResponseEntity<?> placeOrder(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        Long userId = CurrentUser.effectiveUser(request, body.get("userId"));   // VULN #71
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        try {
            OrderRequest req = new OrderRequest();
            req.setSymbol(text(body.get("symbol")));
            req.setSide(text(body.get("side")));
            req.setType(text(body.get("type")));
            req.setQuantity(number(body.get("quantity")));
            req.setPrice(number(body.get("price")));
            req.setClientOrderId(text(body.get("clientOrderId")));
            Order order = orderService.placeOrder(userId, req, CurrentUser.channel(request),
                    number(body.get("commission")), text(body.get("exchange")));
            return ResponseEntity.status(HttpStatus.CREATED).body(orderJson(order));
        } catch (NumberFormatException e) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid number"));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", String.valueOf(e.getMessage())));
        }
    }

    /** VULN (#47 / #76 style): ?userId= returns anyone's orders. */
    @GetMapping("/api/equities/orders")
    public ResponseEntity<?> orders(@RequestParam(required = false) Long userId, HttpServletRequest request) {
        Long who = whoFor(userId, request, "orders");
        if (who == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        return ResponseEntity.ok(orderService.getUserOrders(who));
    }

    /** VULN: IDOR - any order by id, including its owner. */
    @GetMapping("/api/equities/orders/{orderId}")
    public ResponseEntity<?> order(@PathVariable Long orderId, HttpServletRequest request) {
        return orderRepository.findByIdAndProduct(orderId, PRODUCT)
                .map(o -> {
                    Map<String, Object> m = orderJson(o);
                    m.put("userId", o.getUserId());   // VULN: leaks the owner
                    Long me = CurrentUser.id(request);
                    if (me == null || !me.equals(o.getUserId())) {
                        log(SecurityEvent.SENSITIVE_DATA_READ, Outcome.SUCCESS,
                                details("resource", "order", "targetUserId", o.getUserId()));
                    }
                    return ResponseEntity.ok((Object) m);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /** VULN #44: cancel any order (no owner check). */
    @PostMapping("/api/equities/orders/{orderId}/cancel")
    public ResponseEntity<?> cancel(@PathVariable Long orderId, HttpServletRequest request) {
        Long userId = CurrentUser.id(request);
        if (userId == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        try {
            Order order = orderService.cancelOrder(userId, orderId);
            Map<String, Object> m = orderJson(order);
            m.put("message", "Order cancelled");
            m.put("originalUserId", order.getUserId());   // VULN: leaks the owner
            return ResponseEntity.ok(m);
        } catch (RuntimeException e) {
            String msg = String.valueOf(e.getMessage());
            if (msg.startsWith("Order not found")) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", msg));
            }
            return ResponseEntity.badRequest().body(Map.of("error", msg));
        }
    }

    /** VULN #44: delete any order that never traded. */
    @DeleteMapping("/api/equities/orders/{orderId}")
    public ResponseEntity<?> delete(@PathVariable Long orderId, HttpServletRequest request) {
        if (CurrentUser.id(request) == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        try {
            return orderService.deleteOrder(orderId)
                    ? ResponseEntity.ok(Map.of("message", "Order deleted", "orderId", orderId))
                    : ResponseEntity.notFound().build();
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", e.getMessage()));
        }
    }

    // ---- account ------------------------------------------------------------------------------

    /** VULN (#47 style): ?userId= returns anyone's shares. */
    @GetMapping("/api/equities/positions")
    public ResponseEntity<?> positions(@RequestParam(required = false) Long userId, HttpServletRequest request) {
        Long who = whoFor(userId, request, "positions");
        if (who == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Position p : positionRepository.findByUserId(who)) {
            Symbol s = symbolRepository.findById(p.getSymbol()).orElse(null);
            if (s == null || !"EQUITY".equals(s.getAssetClass()) || p.getQuantity().signum() == 0) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("symbol", p.getSymbol());
            m.put("quantity", p.getQuantity());
            m.put("avgPrice", p.getAvgPrice());
            m.put("currentPrice", s.getCurrentPrice());
            m.put("marketValue", p.getQuantity().multiply(s.getCurrentPrice()).setScale(2, RoundingMode.HALF_UP));
            m.put("unrealizedPnl", s.getCurrentPrice().subtract(p.getAvgPrice()).multiply(p.getQuantity())
                    .setScale(2, RoundingMode.HALF_UP));
            m.put("realizedPnl", p.getRealizedPnl());
            out.add(m);
        }
        return ResponseEntity.ok(out);
    }

    /** VULN (#47 style): ?userId= returns anyone's EQUITIES account. */
    @GetMapping("/api/equities/balances")
    public ResponseEntity<?> equityBalances(@RequestParam(required = false) Long userId, HttpServletRequest request) {
        Long who = whoFor(userId, request, "equities_balances");
        if (who == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Authentication required"));
        }
        List<Map<String, Object>> rows = new ArrayList<>();
        Long account = accounts.find(who, PRODUCT);
        if (account != null) {
            balances.all(account).forEach((asset, ah) -> rows.add(Map.of("asset", asset, "available", ah[0], "held", ah[1])));
        }
        return ResponseEntity.ok(Map.of("userId", who, "product", PRODUCT, "balances", rows));
    }

    // ---- admin (forwarded by the platform: only the symbol and the price) -----------------------

    @PostMapping("/internal/admin/halt")
    public Map<String, Object> halt(@RequestBody Map<String, Object> body) {
        priceSimulator.haltSymbol(String.valueOf(body.get("symbol")));
        return Map.of("halted", body.get("symbol"));
    }

    @PostMapping("/internal/admin/resume")
    public Map<String, Object> resume(@RequestBody Map<String, Object> body) {
        priceSimulator.resumeSymbol(String.valueOf(body.get("symbol")));
        return Map.of("resumed", body.get("symbol"));
    }

    /** VULN #58 (kept): any price, the symbol stops moving afterwards. */
    @PostMapping("/internal/admin/price")
    public ResponseEntity<?> setPrice(@RequestBody Map<String, Object> body) {
        try {
            priceSimulator.setPrice(String.valueOf(body.get("symbol")), new BigDecimal(String.valueOf(body.get("price"))));
            return ResponseEntity.ok(Map.of("symbol", body.get("symbol"), "price", body.get("price")));
        } catch (IllegalArgumentException e) {   // includes a non-number price
            return ResponseEntity.badRequest().body(Map.of("error", String.valueOf(e.getMessage())));
        }
    }

    // ---- helpers ------------------------------------------------------------------------------

    private Long whoFor(Long userId, HttpServletRequest request, String resource) {
        Long me = CurrentUser.id(request);
        if (me == null) return null;
        if (userId != null && !userId.equals(me)) {
            log(SecurityEvent.SENSITIVE_DATA_READ, Outcome.SUCCESS, details("resource", resource, "targetUserId", userId));
        }
        return userId != null ? userId : me;
    }

    /** The same order shape as 0.6.0's /api/orders. */
    static Map<String, Object> orderJson(Order order) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("id", order.getId());
        r.put("orderId", order.getId());
        r.put("symbol", order.getSymbol());
        r.put("side", order.getSide());
        r.put("type", order.getOrderType());
        r.put("quantity", order.getQuantity());
        r.put("price", order.getPrice());
        r.put("status", order.getStatus());
        r.put("filledQty", order.getFilledQty());
        r.put("filledPrice", order.getFilledPrice());
        r.put("avgFillPrice", order.getFilledPrice());
        r.put("remainingQty", order.getQuantity().subtract(order.getFilledQty() != null ? order.getFilledQty() : BigDecimal.ZERO));
        r.put("reason", order.getStatusReason());
        r.put("clientOrderId", order.getClientOrderId());
        r.put("commission", order.getFee());
        r.put("holdLeft", order.getHoldLeft());
        r.put("createdAt", order.getCreatedAt());
        return r;
    }

    private Symbol withSessionChange(Symbol s) {
        BigDecimal open = priceSimulator.getOpenPrices().get(s.getSymbol());
        if (open != null && open.signum() > 0 && s.getCurrentPrice() != null) {
            s.setOpenPrice(open);
            s.setChangePct(s.getCurrentPrice().subtract(open).divide(open, 8, RoundingMode.HALF_UP)
                    .multiply(BigDecimal.valueOf(100)).setScale(4, RoundingMode.HALF_UP));
        }
        return s;
    }

    private static Map<String, Object> restEntry(OrderBookEntry e) {
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("orderId", e.getOrderId());            // VULN: order ID exposed
        entry.put("userId", e.getUserId());              // VULN: user ID exposed
        entry.put("price", e.getPrice());
        entry.put("quantity", e.getQuantity());
        entry.put("originalQuantity", e.getOriginalQuantity());
        entry.put("clientOrderId", e.getClientOrderId());
        entry.put("createdAt", e.getCreatedAt());
        entry.put("username", e.getUsername());          // VULN: username exposed
        return entry;
    }

    private static String text(Object o) {
        return o == null ? null : o.toString();
    }

    private static BigDecimal number(Object o) {
        return o == null || o.toString().isBlank() ? null : new BigDecimal(o.toString().trim());
    }
}
