package com.vulntrade.service;

import com.vulntrade.model.Order;
import com.vulntrade.model.User;
import com.vulntrade.model.dto.OrderBookEntry;
import com.vulntrade.repository.OrderRepository;
import com.vulntrade.repository.UserRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.ZoneOffset;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Builds order-book views from the open LIMIT orders of a symbol.
 *
 * VULN (kept): every entry carries the order id, user id and username (#60, #72 — front-running
 * and IDOR cancel). The aggregated {@code levels} view is additive, for depth bars.
 */
@Service
public class OrderBookService {

    private static final List<String> OPEN = List.of("NEW", "PARTIAL");
    private static final int MAX_LEVELS = 20;

    private final OrderRepository orderRepository;
    private final UserRepository userRepository;

    public OrderBookService(OrderRepository orderRepository, UserRepository userRepository) {
        this.orderRepository = orderRepository;
        this.userRepository = userRepository;
    }

    /** One snapshot of a symbol's book. */
    public static class Book {
        public final String symbol;
        public final List<OrderBookEntry> bids;   // best (highest) first
        public final List<OrderBookEntry> asks;   // best (lowest) first

        Book(String symbol, List<OrderBookEntry> bids, List<OrderBookEntry> asks) {
            this.symbol = symbol;
            this.bids = bids;
            this.asks = asks;
        }

        /** Flat list in the shape /topic/orderbook has always used. */
        public List<OrderBookEntry> entries() {
            List<OrderBookEntry> all = new ArrayList<>(bids);
            all.addAll(asks);
            return all;
        }

        /** {symbol, bids, asks, levels, timestamp} for /topic/orderbook/{symbol}. */
        public Map<String, Object> toMessage() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("symbol", symbol);
            m.put("bids", bids);
            m.put("asks", asks);
            m.put("levels", levels());
            m.put("timestamp", System.currentTimeMillis());
            return m;
        }

        public Map<String, Object> levels() {
            Map<String, Object> levels = new LinkedHashMap<>();
            levels.put("bids", aggregate(bids));
            levels.put("asks", aggregate(asks));
            return levels;
        }

        private static List<Map<String, Object>> aggregate(List<OrderBookEntry> side) {
            LinkedHashMap<BigDecimal, Map<String, Object>> byPrice = new LinkedHashMap<>();
            for (OrderBookEntry e : side) {
                BigDecimal key = e.getPrice().stripTrailingZeros();
                Map<String, Object> level = byPrice.computeIfAbsent(key, k -> {
                    Map<String, Object> l = new LinkedHashMap<>();
                    l.put("price", e.getPrice());
                    l.put("quantity", BigDecimal.ZERO);
                    l.put("orders", 0);
                    return l;
                });
                level.put("quantity", ((BigDecimal) level.get("quantity")).add(e.getQuantity()));
                level.put("orders", (Integer) level.get("orders") + 1);
                if (byPrice.size() > MAX_LEVELS) break;
            }
            return new ArrayList<>(byPrice.values()).subList(0, Math.min(byPrice.size(), MAX_LEVELS));
        }
    }

    public Book snapshot(String symbol) {
        List<Order> open = orderRepository.findBySymbolAndStatusIn(symbol, OPEN).stream()
                .filter(o -> "LIMIT".equalsIgnoreCase(o.getOrderType()) && o.getPrice() != null)
                .filter(o -> remaining(o).signum() > 0)
                .collect(Collectors.toList());

        Set<Long> ownerIds = open.stream().map(Order::getUserId).filter(Objects::nonNull).collect(Collectors.toSet());
        Map<Long, String> usernames = new HashMap<>();
        userRepository.findAllById(ownerIds).forEach((User u) -> usernames.put(u.getId(), u.getUsername()));

        Comparator<Order> byTime = Comparator.comparing(Order::getCreatedAt, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(Order::getId);
        List<OrderBookEntry> bids = open.stream().filter(o -> "BUY".equals(o.getSide()))
                .sorted(Comparator.comparing(Order::getPrice).reversed().thenComparing(byTime))
                .map(o -> entry(o, usernames)).collect(Collectors.toList());
        List<OrderBookEntry> asks = open.stream().filter(o -> "SELL".equals(o.getSide()))
                .sorted(Comparator.comparing(Order::getPrice).thenComparing(byTime))
                .map(o -> entry(o, usernames)).collect(Collectors.toList());
        return new Book(symbol, bids, asks);
    }

    private static OrderBookEntry entry(Order o, Map<Long, String> usernames) {
        OrderBookEntry entry = new OrderBookEntry();
        entry.setOrderId(o.getId());                     // VULN: order ID exposed
        entry.setSymbol(o.getSymbol());
        entry.setSide(o.getSide());
        entry.setPrice(o.getPrice());
        entry.setQuantity(remaining(o));
        entry.setUserId(o.getUserId());                  // VULN: user ID disclosed
        entry.setUsername(usernames.get(o.getUserId())); // VULN: username disclosed
        entry.setClientOrderId(o.getClientOrderId());
        entry.setOriginalQuantity(o.getQuantity());
        entry.setCreatedAt(o.getCreatedAt());
        entry.setTimestamp(o.getCreatedAt() != null
                ? o.getCreatedAt().toInstant(ZoneOffset.UTC).toEpochMilli() : null);
        return entry;
    }

    static BigDecimal remaining(Order o) {
        BigDecimal filled = o.getFilledQty() != null ? o.getFilledQty() : BigDecimal.ZERO;
        return o.getQuantity().subtract(filled);
    }
}
