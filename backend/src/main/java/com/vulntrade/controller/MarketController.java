package com.vulntrade.controller;

import com.vulntrade.model.Order;
import com.vulntrade.model.Symbol;
import com.vulntrade.repository.OrderRepository;
import com.vulntrade.repository.SymbolRepository;
import com.vulntrade.repository.UserRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/market")
public class MarketController {

    private final SymbolRepository symbolRepository;
    private final OrderRepository orderRepository;
    private final UserRepository userRepository;

    public MarketController(SymbolRepository symbolRepository,
                            OrderRepository orderRepository,
                            UserRepository userRepository) {
        this.symbolRepository = symbolRepository;
        this.orderRepository = orderRepository;
        this.userRepository = userRepository;
    }

    /**
     * Get all current prices - public endpoint.
     */
    @GetMapping("/prices")
    public ResponseEntity<List<Symbol>> getPrices() {
        return ResponseEntity.ok(symbolRepository.findAll());
    }

    /**
     * Get price for specific symbol.
     * VULN: Path traversal in symbol parameter.
     */
    @GetMapping("/prices/{symbol}")
    public ResponseEntity<?> getPrice(@PathVariable String symbol) {
        return symbolRepository.findById(symbol)
                .map(s -> ResponseEntity.ok((Object) s))
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Get order book for a symbol.
     * VULN: Exposes userId of each order (information disclosure / front-running).
     * VULN: Path traversal in symbol parameter.
     * VULN: Shows all pending orders enabling front-running.
     */
    @GetMapping("/orderbook/{symbol}")
    public ResponseEntity<?> getOrderBook(@PathVariable String symbol) {
        // VULN: symbol not sanitized — path traversal possible
        List<Order> buyOrders = orderRepository.findBySymbolAndSideAndStatus(symbol, "BUY", "NEW");
        List<Order> sellOrders = orderRepository.findBySymbolAndSideAndStatus(symbol, "SELL", "NEW");

        // VULN: Leaks userId and full order details for front-running
        List<Map<String, Object>> bids = buyOrders.stream()
            .sorted(Comparator.comparing(Order::getPrice, Comparator.nullsLast(Comparator.naturalOrder())).reversed())
            .map(o -> {
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("orderId", o.getId());       // VULN: order ID exposed
                entry.put("userId", o.getUserId());     // VULN: user ID exposed
                entry.put("price", o.getPrice());
                entry.put("quantity", o.getQuantity());
                entry.put("clientOrderId", o.getClientOrderId());
                entry.put("createdAt", o.getCreatedAt());
                // Include username for display
                userRepository.findById(o.getUserId()).ifPresent(u ->
                    entry.put("username", u.getUsername()));
                return entry;
            }).collect(Collectors.toList());

        List<Map<String, Object>> asks = sellOrders.stream()
            .sorted(Comparator.comparing(Order::getPrice, Comparator.nullsLast(Comparator.naturalOrder())))
            .map(o -> {
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("orderId", o.getId());
                entry.put("userId", o.getUserId());
                entry.put("price", o.getPrice());
                entry.put("quantity", o.getQuantity());
                entry.put("clientOrderId", o.getClientOrderId());
                entry.put("createdAt", o.getCreatedAt());
                // Include username for display
                userRepository.findById(o.getUserId()).ifPresent(u ->
                    entry.put("username", u.getUsername()));
                return entry;
            }).collect(Collectors.toList());

        Map<String, Object> orderBook = new LinkedHashMap<>();
        orderBook.put("symbol", symbol);
        orderBook.put("bids", bids);
        orderBook.put("asks", asks);
        orderBook.put("bidCount", bids.size());
        orderBook.put("askCount", asks.size());
        orderBook.put("timestamp", System.currentTimeMillis());

        return ResponseEntity.ok(orderBook);
    }
}
