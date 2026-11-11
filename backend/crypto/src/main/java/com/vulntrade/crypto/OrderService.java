package com.vulntrade.crypto;

import com.vulntrade.model.Order;
import com.vulntrade.model.dto.OrderRequest;
import com.vulntrade.money.Accounts;
import com.vulntrade.money.Balances;
import com.vulntrade.repository.OrderRepository;
import com.vulntrade.security.logging.Outcome;
import com.vulntrade.security.logging.SecurityEvent;
import com.vulntrade.service.MatchingCoordinator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import static com.vulntrade.security.logging.SecurityEventLogger.*;

/**
 * Crypto Order Management: the life of an order on our exchange (open 24/7).
 *
 *   1. receive   {BTC-USD, BUY, LIMIT, 0.5, 65010}
 *   2. check     pair, side, type, enough USD (BUY) or coins (SELL)?      (before the lock)
 *   3. hold      BUY: qty x price + taker fee in USD; SELL: the coins       (under the lock)
 *   4. match     on our own order book; LIMIT remainders rest
 *
 * VULN #40 no price band, #41 clientOrderId replay, #44 cancel/delete any order, CR-3, CR-4, CR-7.
 */
@Service
public class OrderService {

    private static final Logger logger = LoggerFactory.getLogger(OrderService.class);
    private static final String PRODUCT = Accounts.CRYPTO;

    private static final Set<String> SIDES = Set.of("BUY", "SELL");
    private static final Set<String> TYPES = Set.of("LIMIT", "MARKET");
    private static final int MAX_SCALE = 8;   // DECIMAL(20,8)

    private final OrderRepository orderRepository;
    private final RiskService riskService;
    private final MatchingEngineService matchingEngine;
    private final PriceSimulatorService priceSimulator;
    private final MatchingCoordinator coordinator;
    private final TradingEvents events;
    private final Accounts accounts;
    private final Balances balances;

    public OrderService(OrderRepository orderRepository, RiskService riskService, MatchingEngineService matchingEngine,
                        PriceSimulatorService priceSimulator, MatchingCoordinator coordinator, TradingEvents events,
                        Accounts accounts, Balances balances) {
        this.orderRepository = orderRepository;
        this.riskService = riskService;
        this.matchingEngine = matchingEngine;
        this.priceSimulator = priceSimulator;
        this.coordinator = coordinator;
        this.events = events;
        this.accounts = accounts;
        this.balances = balances;
    }

    /**
     * Place a crypto order. {@code feeRole} (MAKER/TAKER) and {@code clientTime} are optional
     * client fields (VULN CR-3 / CR-4).
     */
    public Order placeOrder(Long userId, OrderRequest request, String feeRole, String clientTime) {
        if (request.getSide() != null) request.setSide(request.getSide().trim().toUpperCase(Locale.ROOT));
        if (request.getType() != null) request.setType(request.getType().trim().toUpperCase(Locale.ROOT));
        if (request.getType() == null) request.setType(request.getPrice() == null ? "MARKET" : "LIMIT");
        if (request.getSymbol() == null || request.getSymbol().isBlank()) {
            reject("missing_symbol", request, "Symbol is required");
        }
        request.setSymbol(request.getSymbol().trim().toUpperCase(Locale.ROOT));
        if (!SIDES.contains(request.getSide())) {
            reject("invalid_side", request, "Invalid side: " + request.getSide() + " (expected BUY or SELL)");
        }
        if (!TYPES.contains(request.getType())) {
            reject("invalid_type", request, "Invalid order type: " + request.getType() + " (expected LIMIT or MARKET)");
        }
        if (tooPrecise(request.getQuantity()) || tooPrecise(request.getPrice())) {
            reject("invalid_precision", request, "Quantity and price support at most " + MAX_SCALE + " decimal places");
        }
        if ("MARKET".equals(request.getType())) {
            request.setPrice(null);   // a market order takes whatever the book offers (CR-5)
        }
        BigDecimal hold = holdFor(request);
        String riskError = riskService.checkPreTrade(userId, request.getSymbol(), request.getSide(),
                request.getType(), request.getQuantity(), request.getPrice(), hold);
        if (riskError != null) {
            reject("risk_check_failed", request, riskError);
        }
        return coordinator.execute(() -> doPlace(userId, request, hold, feeRole, clientTime));
    }

    /**
     * What an order locks. BUY LIMIT: qty x price + the taker fee (USD). SELL: the coins.
     * A MARKET BUY has no price, so it locks nothing and pays each fill from available USD
     * (a fill it can't pay ends the order).
     */
    private static BigDecimal holdFor(OrderRequest r) {
        if (r.getQuantity() == null) return BigDecimal.ZERO;
        if ("SELL".equals(r.getSide())) return r.getQuantity();
        if (r.getPrice() == null) return BigDecimal.ZERO;
        BigDecimal value = r.getQuantity().multiply(r.getPrice());
        return value.add(Fees.of(value, Fees.TAKER)).setScale(8, RoundingMode.HALF_UP);
    }

    private Order doPlace(Long userId, OrderRequest request, BigDecimal hold, String feeRole, String clientTime) {
        if (priceSimulator.isHalted(request.getSymbol())) {
            log(SecurityEvent.ORDER_REJECTED, Outcome.DENIED,
                    details("reason", "trading_halted", "symbol", request.getSymbol(), "side", request.getSide(),
                            "quantity", request.getQuantity(), "price", request.getPrice(), "product", PRODUCT));
            throw new RuntimeException("Trading halted for " + request.getSymbol());
        }
        Order order = new Order();
        order.setUserId(userId);
        order.setSymbol(request.getSymbol());
        order.setSide(request.getSide());
        order.setOrderType(request.getType());
        order.setQuantity(request.getQuantity());
        order.setPrice(request.getPrice());
        order.setClientOrderId(request.getClientOrderId());   // VULN #41: never checked for duplicates
        order.setStatus("NEW");
        order.setFilledQty(BigDecimal.ZERO);
        // VULN CR-4: a time sent by the client becomes the order's place in the queue
        //            (clientTime in the past = jump ahead of everyone at that price)
        order.setCreatedAt(clientTime != null ? parseTime(clientTime) : LocalDateTime.now(ZoneOffset.UTC));
        order.setProduct(PRODUCT);
        order.setHoldLeft(hold);
        order.setFeeRole(feeRole == null ? null : feeRole.toUpperCase(Locale.ROOT));   // VULN CR-3
        order = orderRepository.save(order);
        if (hold.signum() > 0) {
            // Not re-checked under the lock (VULN #43): the check above may be stale already.
            balances.hold(accounts.find(userId, PRODUCT), MatchingEngineService.heldAsset(order), hold);
        }
        log(SecurityEvent.ORDER_CREATED, Outcome.SUCCESS,
                details("orderId", order.getId(), "symbol", order.getSymbol(), "side", order.getSide(),
                        "orderType", order.getOrderType(), "quantity", order.getQuantity(), "price", order.getPrice(),
                        "clientOrderId", order.getClientOrderId(), "product", PRODUCT,
                        "feeRole", order.getFeeRole(), "clientTime", clientTime));
        matchingEngine.match(order);
        return order;
    }

    /** VULN #44: no ownership check - anyone can cancel any crypto order by id. */
    public Order cancelOrder(Long userId, Long orderId) {
        Order before = orderRepository.findByIdAndProduct(orderId, PRODUCT)
                .orElseThrow(() -> new RuntimeException("Order not found: " + orderId));
        // VULN CR-7: the hold to give back is read BEFORE the lock. A fill that lands in between
        //            is paid from the hold AND the whole old hold is given back: money twice.
        BigDecimal holdToRelease = before.getHoldLeft() == null ? BigDecimal.ZERO : before.getHoldLeft();
        return coordinator.execute(() -> {
            Order order = orderRepository.findByIdAndProduct(orderId, PRODUCT)
                    .orElseThrow(() -> new RuntimeException("Order not found: " + orderId));
            if ("FILLED".equals(order.getStatus()) || "CANCELLED".equals(order.getStatus())) {
                log(SecurityEvent.ORDER_CANCELLED, Outcome.FAILURE,
                        details("reason", "already_closed", "orderId", order.getId(), "symbol", order.getSymbol(),
                                "targetUserId", order.getUserId(), "isOwner", isOwner(order.getUserId())));
                throw new RuntimeException("Order already " + order.getStatus());
            }
            order.setStatus("CANCELLED");
            order.setStatusReason(null);
            if (holdToRelease.signum() != 0) {
                balances.release(accounts.find(order.getUserId(), PRODUCT), MatchingEngineService.heldAsset(order),
                        holdToRelease);
            }
            order.setHoldLeft(BigDecimal.ZERO);
            order = orderRepository.save(order);
            events.orderChanged(order);
            logger.info("Order cancelled: id={}, by userId={} (owner={})", orderId, userId, order.getUserId());
            log(SecurityEvent.ORDER_CANCELLED, Outcome.SUCCESS,
                    details("orderId", order.getId(), "symbol", order.getSymbol(),
                            "targetUserId", order.getUserId(), "isOwner", isOwner(order.getUserId())));
            return order;
        });
    }

    /** Hard-delete an order that never traded; its hold goes back first. VULN #44: no ownership check. */
    public boolean deleteOrder(Long orderId) {
        return coordinator.execute(() -> {
            Order order = orderRepository.findByIdAndProduct(orderId, PRODUCT).orElse(null);
            if (order == null) return false;
            if (order.getFilledQty() != null && order.getFilledQty().signum() > 0) {
                throw new IllegalStateException("Order " + orderId + " has trades and can't be deleted; cancel it instead");
            }
            if (order.getHoldLeft() != null && order.getHoldLeft().signum() != 0) {
                balances.release(accounts.find(order.getUserId(), PRODUCT), MatchingEngineService.heldAsset(order),
                        order.getHoldLeft());
            }
            orderRepository.delete(order);
            events.bookChanged(order.getSymbol());
            log(SecurityEvent.SENSITIVE_DATA_DELETED, Outcome.SUCCESS,
                    details("resource", "order", "orderId", orderId, "targetUserId", order.getUserId()));
            return true;
        });
    }

    public List<Order> getUserOrders(Long userId) {
        return orderRepository.findByUserIdAndProductOrderByIdDesc(userId, PRODUCT);
    }

    // ------------------------------------------------------------------

    /** clientTime as epoch milliseconds or ISO-8601. */
    private static LocalDateTime parseTime(String clientTime) {
        try {
            return LocalDateTime.ofInstant(Instant.ofEpochMilli(Long.parseLong(clientTime.trim())), ZoneOffset.UTC);
        } catch (NumberFormatException notMillis) {
            return LocalDateTime.ofInstant(Instant.parse(clientTime.trim()), ZoneOffset.UTC);
        }
    }

    private void reject(String reason, OrderRequest request, String message) {
        log(SecurityEvent.ORDER_REJECTED, Outcome.DENIED,
                details("reason", reason, "symbol", request.getSymbol(), "side", request.getSide(),
                        "orderType", request.getType(), "quantity", request.getQuantity(),
                        "price", request.getPrice(), "product", PRODUCT));
        throw new RuntimeException(message);
    }

    private static boolean tooPrecise(BigDecimal value) {
        return value != null && value.stripTrailingZeros().scale() > MAX_SCALE;
    }
}
