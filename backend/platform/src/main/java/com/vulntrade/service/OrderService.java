package com.vulntrade.service;

import com.vulntrade.model.Order;
import com.vulntrade.model.Symbol;
import com.vulntrade.model.dto.OrderRequest;
import com.vulntrade.repository.OrderRepository;
import com.vulntrade.repository.SymbolRepository;
import com.vulntrade.security.logging.Outcome;
import com.vulntrade.security.logging.SecurityEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

import static com.vulntrade.security.logging.SecurityEventLogger.*;

/**
 * Order management service.
 *
 * All book-changing work runs through {@link MatchingCoordinator}: one lock, one transaction,
 * notifications after commit.
 *
 * VULN: No price band validation (can buy at $0.01 or $999999, #40).
 * VULN: clientOrderId not unique-enforced (replay possible, #41).
 * VULN: IDOR on cancel - can cancel any user's order (#44).
 * VULN: MARKET orders trust a client-supplied price as the book-matching cap (#45/#70).
 * Controls present: quantity > 0, known tradable symbol, halt, balance (BUY) and position
 * (SELL) checks, side/type/precision validation.
 */
@Service
public class OrderService {

    private static final Logger logger = LoggerFactory.getLogger(OrderService.class);

    private static final Set<String> SIDES = Set.of("BUY", "SELL");
    private static final Set<String> TYPES = Set.of("LIMIT", "MARKET");
    private static final int MAX_SCALE = 8;   // DECIMAL(20,8)

    private final OrderRepository orderRepository;
    private final SymbolRepository symbolRepository;
    private final RiskService riskService;
    private final MatchingEngineService matchingEngine;
    private final PriceSimulatorService priceSimulator;
    private final MatchingCoordinator coordinator;
    private final TradingEvents events;

    public OrderService(OrderRepository orderRepository,
                        SymbolRepository symbolRepository,
                        RiskService riskService,
                        MatchingEngineService matchingEngine,
                        PriceSimulatorService priceSimulator,
                        MatchingCoordinator coordinator,
                        TradingEvents events) {
        this.orderRepository = orderRepository;
        this.symbolRepository = symbolRepository;
        this.riskService = riskService;
        this.matchingEngine = matchingEngine;
        this.priceSimulator = priceSimulator;
        this.coordinator = coordinator;
        this.events = events;
    }

    /**
     * Place a new order: validate, risk-check, save, match.
     * The returned order carries its final status, filled quantity and average fill price.
     */
    public Order placeOrder(Long userId, OrderRequest request) {
        // Normalise side/type so downstream case-sensitive matching works.
        if (request.getSide() != null) {
            request.setSide(request.getSide().trim().toUpperCase(Locale.ROOT));
        }
        if (request.getType() != null) {
            request.setType(request.getType().trim().toUpperCase(Locale.ROOT));
        }
        if (request.getType() == null && request.getPrice() == null) {
            request.setType("MARKET");
        } else if (request.getType() == null) {
            request.setType("LIMIT");
        }

        if (request.getSymbol() == null || request.getSymbol().isBlank()) {
            reject("missing_symbol", request, "Symbol is required");
        }
        if (!SIDES.contains(request.getSide())) {
            reject("invalid_side", request, "Invalid side: " + request.getSide() + " (expected BUY or SELL)");
        }
        if (!TYPES.contains(request.getType())) {
            reject("invalid_type", request, "Invalid order type: " + request.getType() + " (expected LIMIT or MARKET)");
        }
        if (tooPrecise(request.getQuantity()) || tooPrecise(request.getPrice())) {
            reject("invalid_precision", request, "Quantity and price support at most " + MAX_SCALE + " decimal places");
        }

        return coordinator.execute(() -> doPlace(userId, request));
    }

    private Order doPlace(Long userId, OrderRequest request) {
        // MARKET orders may omit price; resolve it from the live bid/ask. A client-supplied
        // MARKET price is kept and used as the book-matching cap (VULN #45: trusted client price).
        if ("MARKET".equals(request.getType()) && request.getPrice() == null) {
            symbolRepository.findById(request.getSymbol()).ifPresent(sym -> {
                BigDecimal marketPrice = "BUY".equals(request.getSide()) ? sym.getAsk() : sym.getBid();
                request.setPrice(marketPrice);
            });
        }

        // Halt check for ALL order types (re-checked here, under the lock)
        if (priceSimulator.isHalted(request.getSymbol())) {
            log(SecurityEvent.ORDER_REJECTED, Outcome.DENIED,
                    details("reason", "trading_halted",
                            "symbol", request.getSymbol(),
                            "side", request.getSide(),
                            "quantity", request.getQuantity(),
                            "price", request.getPrice()));
            throw new RuntimeException("Trading halted for " + request.getSymbol());
        }

        // Pre-trade risk check (runs for ALL order types including MARKET). Advisory only:
        // nothing is reserved; settlement re-checks at fill time.
        String riskError = riskService.checkPreTrade(
                userId, request.getSymbol(), request.getSide(),
                request.getType(), request.getQuantity(), request.getPrice());

        if (riskError != null) {
            // The RiskService text is not logged: the reason code is enough for Wazuh.
            log(SecurityEvent.ORDER_REJECTED, Outcome.DENIED,
                    details("reason", "risk_check_failed",
                            "symbol", request.getSymbol(),
                            "side", request.getSide(),
                            "quantity", request.getQuantity(),
                            "price", request.getPrice()));
            throw new RuntimeException(riskError);
        }

        Order order = new Order();
        order.setUserId(userId);
        order.setSymbol(request.getSymbol());
        order.setSide(request.getSide());
        order.setOrderType(request.getType());
        order.setQuantity(request.getQuantity());
        order.setPrice(request.getPrice());
        order.setClientOrderId(request.getClientOrderId());
        order.setStatus("NEW");
        order.setFilledQty(BigDecimal.ZERO);
        order.setCreatedAt(LocalDateTime.now(ZoneOffset.UTC));
        order = orderRepository.save(order);

        logger.info("Order created: id={}, userId={}, {} {} {} x {} @ {}",
                order.getId(), userId, order.getSide(), order.getOrderType(),
                order.getSymbol(), order.getQuantity(), order.getPrice());

        // Logged before matching, so order_created comes before its trade_executed events.
        log(SecurityEvent.ORDER_CREATED, Outcome.SUCCESS,
                details("orderId", order.getId(),
                        "symbol", order.getSymbol(),
                        "side", order.getSide(),
                        "orderType", order.getOrderType(),
                        "quantity", order.getQuantity(),
                        "price", order.getPrice(),
                        "clientOrderId", order.getClientOrderId()));

        matchingEngine.match(order);
        return order;
    }

    /**
     * Cancel an order.
     * VULN: IDOR - can cancel any user's order by ID.
     * VULN: No ownership verification.
     */
    public Order cancelOrder(Long userId, Long orderId) {
        return coordinator.execute(() -> {
            // VULN: No ownership check - userId parameter is ignored
            Optional<Order> orderOpt = orderRepository.findById(orderId);
            if (orderOpt.isEmpty()) {
                throw new RuntimeException("Order not found: " + orderId);
            }

            Order order = orderOpt.get();
            // VULN: Should check order.getUserId().equals(userId) but doesn't

            if ("FILLED".equals(order.getStatus()) || "CANCELLED".equals(order.getStatus())) {
                log(SecurityEvent.ORDER_CANCELLED, Outcome.FAILURE,
                        details("reason", "already_closed",
                                "orderId", order.getId(),
                                "symbol", order.getSymbol(),
                                "targetUserId", order.getUserId(),
                                "isOwner", isOwner(order.getUserId())));
                throw new RuntimeException("Order already " + order.getStatus());
            }

            order.setStatus("CANCELLED");
            order.setStatusReason(null);
            order = orderRepository.save(order);
            events.orderChanged(order);   // owner gets an ORDER_UPDATE, the book is rebroadcast

            logger.info("Order cancelled: id={}, by userId={} (owner={})",
                    orderId, userId, order.getUserId());

            log(SecurityEvent.ORDER_CANCELLED, Outcome.SUCCESS,
                    details("orderId", order.getId(),
                            "symbol", order.getSymbol(),
                            "targetUserId", order.getUserId(),
                            "isOwner", isOwner(order.getUserId())));
            return order;
        });
    }

    /**
     * Execute a market order immediately at the current price.
     * VULN: No slippage protection — fills at whatever the book and the house offer.
     */
    public Order executeMarketOrder(Long userId, String symbol, String side, BigDecimal quantity) {
        Optional<Symbol> symbolOpt = symbol == null ? Optional.empty() : symbolRepository.findById(symbol);
        if (symbolOpt.isEmpty()) {
            log(SecurityEvent.ORDER_REJECTED, Outcome.DENIED,
                    details("reason", "unknown_symbol",
                            "symbol", symbol,
                            "side", side,
                            "quantity", quantity));
            throw new RuntimeException("Unknown symbol: " + symbol);
        }

        BigDecimal currentPrice = "BUY".equalsIgnoreCase(side)
                ? symbolOpt.get().getAsk()   // Buy at ask
                : symbolOpt.get().getBid();  // Sell at bid

        if (currentPrice == null || currentPrice.compareTo(BigDecimal.ZERO) <= 0) {
            log(SecurityEvent.ORDER_REJECTED, Outcome.DENIED,
                    details("reason", "no_market_price",
                            "symbol", symbol,
                            "side", side,
                            "quantity", quantity,
                            "price", currentPrice));
            throw new RuntimeException("No valid market price for " + symbol);
        }

        OrderRequest request = new OrderRequest();
        request.setSymbol(symbol);
        request.setSide(side);
        request.setType("MARKET");
        request.setQuantity(quantity);
        request.setPrice(currentPrice);

        return placeOrder(userId, request);
    }

    /**
     * Hard-delete an order (REST DELETE).
     * VULN: IDOR + destructive, no ownership check. Runs under the matching lock so it can't
     * race a fill. Orders that already traded are referenced by trades and can't be deleted.
     */
    public boolean deleteOrder(Long orderId) {
        return coordinator.execute(() -> {
            Optional<Order> orderOpt = orderRepository.findById(orderId);
            if (orderOpt.isEmpty()) return false;
            Order order = orderOpt.get();
            BigDecimal filled = order.getFilledQty() != null ? order.getFilledQty() : BigDecimal.ZERO;
            if (filled.signum() > 0) {
                throw new IllegalStateException("Order " + orderId + " has trades and can't be deleted; cancel it instead");
            }
            orderRepository.delete(order);
            events.bookChanged(order.getSymbol());
            return true;
        });
    }

    /**
     * Get orders for a user.
     */
    public List<Order> getUserOrders(Long userId) {
        return orderRepository.findByUserId(userId);
    }

    // ------------------------------------------------------------------

    private void reject(String reason, OrderRequest request, String message) {
        log(SecurityEvent.ORDER_REJECTED, Outcome.DENIED,
                details("reason", reason,
                        "symbol", request.getSymbol(),
                        "side", request.getSide(),
                        "orderType", request.getType(),
                        "quantity", request.getQuantity(),
                        "price", request.getPrice()));
        throw new RuntimeException(message);
    }

    private static boolean tooPrecise(BigDecimal value) {
        return value != null && value.stripTrailingZeros().scale() > MAX_SCALE;
    }
}
