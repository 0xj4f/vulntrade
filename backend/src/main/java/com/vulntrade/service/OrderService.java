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
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static com.vulntrade.security.logging.SecurityEventLogger.*;

/**
 * Order management service.
 * 
 * VULN: No server-side validation of quantity (accepts negative).
 * VULN: No price band validation (can buy at $0.01).
 * VULN: clientOrderId not unique-enforced (replay possible).
 * VULN: Symbol not validated - can create orders for non-existent symbols.
 * VULN: IDOR on cancel - can cancel any user's order.
 */
@Service
public class OrderService {

    private static final Logger logger = LoggerFactory.getLogger(OrderService.class);

    private final OrderRepository orderRepository;
    private final SymbolRepository symbolRepository;
    private final RiskService riskService;
    private final MatchingEngineService matchingEngine;
    private final PriceSimulatorService priceSimulator;
    private final SimpMessagingTemplate messagingTemplate;

    public OrderService(OrderRepository orderRepository,
                        SymbolRepository symbolRepository,
                        RiskService riskService,
                        MatchingEngineService matchingEngine,
                        PriceSimulatorService priceSimulator,
                        SimpMessagingTemplate messagingTemplate) {
        this.orderRepository = orderRepository;
        this.symbolRepository = symbolRepository;
        this.riskService = riskService;
        this.matchingEngine = matchingEngine;
        this.priceSimulator = priceSimulator;
        this.messagingTemplate = messagingTemplate;
    }

    /**
     * Place a new order.
     * Validates symbol, enforces halt check for all types, runs risk checks.
     */
    public Order placeOrder(Long userId, OrderRequest request) {

        // Halt check for ALL order types
        if (priceSimulator.isHalted(request.getSymbol())) {
            log(SecurityEvent.ORDER_REJECTED, Outcome.DENIED,
                    details("reason", "trading_halted",
                            "symbol", request.getSymbol(),
                            "side", request.getSide(),
                            "quantity", request.getQuantity(),
                            "price", request.getPrice()));
            throw new RuntimeException("Trading halted for " + request.getSymbol());
        }

        // Pre-trade risk check (runs for ALL order types including MARKET)
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

        // Create order
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
        order.setCreatedAt(LocalDateTime.now());

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

        // Try to match immediately
        matchingEngine.tryMatch(order);

        // Notify user of order status
        messagingTemplate.convertAndSendToUser(
                String.valueOf(userId), "/queue/orders", order);

        // Update order book
        matchingEngine.broadcastOrderBook(order.getSymbol());

        return order;
    }

    /**
     * Cancel an order.
     * VULN: IDOR - can cancel any user's order by ID.
     * VULN: No ownership verification.
     */
    public Order cancelOrder(Long userId, Long orderId) {
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
        order = orderRepository.save(order);

        logger.info("Order cancelled: id={}, by userId={} (owner={})",
                orderId, userId, order.getUserId());

        // Notify order owner
        messagingTemplate.convertAndSendToUser(
                String.valueOf(order.getUserId()), "/queue/orders", order);

        // Update order book
        matchingEngine.broadcastOrderBook(order.getSymbol());

        log(SecurityEvent.ORDER_CANCELLED, Outcome.SUCCESS,
                details("orderId", order.getId(),
                        "symbol", order.getSymbol(),
                        "targetUserId", order.getUserId(),
                        "isOwner", isOwner(order.getUserId())));
        return order;
    }

    /**
     * Execute a market order immediately at current price.
     */
    public Order executeMarketOrder(Long userId, String symbol, String side, BigDecimal quantity) {
        // Get current price
        Optional<Symbol> symbolOpt = symbolRepository.findById(symbol);
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
                : symbolOpt.get().getBid();   // Sell at bid

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
     * Get orders for a user.
     */
    public List<Order> getUserOrders(Long userId) {
        return orderRepository.findByUserId(userId);
    }
}
