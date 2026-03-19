package com.vulntrade.service;

import com.vulntrade.model.Order;
import com.vulntrade.model.Symbol;
import com.vulntrade.model.dto.OrderRequest;
import com.vulntrade.repository.OrderRepository;
import com.vulntrade.repository.SymbolRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

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
     * VULN: No server-side validation of quantity, price, symbol.
     * VULN: clientOrderId not unique-enforced.
     * VULN: Balance check has TOCTOU race condition.
     */
    public Order placeOrder(Long userId, OrderRequest request) {
        // VULN: No validation of quantity > 0
        // VULN: No validation of price > 0
        // VULN: Symbol not validated against known symbols
        // VULN: clientOrderId not checked for uniqueness (replay possible)

        // Halt check only for LIMIT orders
        // VULN: Can execute MARKET orders while trading is halted
        if ("LIMIT".equalsIgnoreCase(request.getType())) {
            if (priceSimulator.isHalted(request.getSymbol())) {
                throw new RuntimeException("Trading halted for " + request.getSymbol());
            }
        }

        // Pre-trade risk check (VULN: skipped for MARKET, TOCTOU for LIMIT)
        String riskError = riskService.checkPreTrade(
                userId, request.getSymbol(), request.getSide(),
                request.getType(), request.getQuantity(), request.getPrice());

        if (riskError != null) {
            throw new RuntimeException(riskError);
        }

        // Create order
        Order order = new Order();
        order.setUserId(userId);
        order.setSymbol(request.getSymbol());
        order.setSide(request.getSide());
        order.setOrderType(request.getType());
        order.setQuantity(request.getQuantity());  // VULN: can be negative
        order.setPrice(request.getPrice());         // VULN: can be $0.01
        order.setClientOrderId(request.getClientOrderId()); // VULN: not unique
        order.setStatus("NEW");
        order.setFilledQty(BigDecimal.ZERO);
        order.setCreatedAt(LocalDateTime.now());

        order = orderRepository.save(order);
        logger.info("Order created: id={}, userId={}, {} {} {} x {} @ {}",
                order.getId(), userId, order.getSide(), order.getOrderType(),
                order.getSymbol(), order.getQuantity(), order.getPrice());

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

        return order;
    }

    /**
     * Execute a market order immediately at current price.
     * VULN: No slippage protection.
     * VULN: Race condition - price changes between validation and execution.
     * VULN: Can execute while trading is halted (halt check only in limit orders).
     */
    public Order executeMarketOrder(Long userId, String symbol, String side, BigDecimal quantity) {
        // VULN: No halt check for market orders
        // (halt check is only in placeOrder for LIMIT type)

        // Get current price
        Optional<Symbol> symbolOpt = symbolRepository.findById(symbol);
        BigDecimal currentPrice;
        if (symbolOpt.isPresent()) {
            currentPrice = "BUY".equalsIgnoreCase(side)
                    ? symbolOpt.get().getAsk()   // Buy at ask
                    : symbolOpt.get().getBid();   // Sell at bid
        } else {
            // VULN: Non-existent symbol gets arbitrary price
            currentPrice = new BigDecimal("100.00");
        }

        // VULN: No slippage protection - price could have changed
        // VULN: Race condition between getting price and creating order

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
