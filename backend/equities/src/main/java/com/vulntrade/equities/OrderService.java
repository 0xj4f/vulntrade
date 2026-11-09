package com.vulntrade.equities;

import com.vulntrade.model.Order;
import com.vulntrade.model.Symbol;
import com.vulntrade.model.dto.OrderRequest;
import com.vulntrade.money.Accounts;
import com.vulntrade.money.Balances;
import com.vulntrade.repository.OrderRepository;
import com.vulntrade.repository.SymbolRepository;
import com.vulntrade.security.logging.Outcome;
import com.vulntrade.security.logging.SecurityEvent;
import com.vulntrade.service.MatchingCoordinator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import static com.vulntrade.security.logging.SecurityEventLogger.*;

/**
 * Equities Order Management (the broker): the life of a stock order.
 *
 *   1. receive    {AAPL, BUY, LIMIT, 10, 178.60}
 *   2. check      symbol, side, type, market open?, enough USD / shares?     (before the lock)
 *   3. hold       qty x price + commission is locked in the EQUITIES account (under the lock)
 *   4. route      today always XSIM, our one simulated exchange (Smart Order Router = future slot)
 *   5. fills      MatchingEngineService settles them; the order ends FILLED, rests, or is cancelled
 *
 * VULN #40 no price band, #41 clientOrderId replay, #44 cancel/delete any order (no owner check),
 * #45 no slippage cap, EQ-1, EQ-4, EQ-5, EQ-7 (see the comments where they live).
 */
@Service
public class OrderService {

    private static final Logger logger = LoggerFactory.getLogger(OrderService.class);
    private static final String PRODUCT = Accounts.EQUITIES;

    private static final Set<String> SIDES = Set.of("BUY", "SELL");
    private static final Set<String> TYPES = Set.of("LIMIT", "MARKET");
    private static final int MAX_SCALE = 8;   // DECIMAL(20,8)

    private final OrderRepository orderRepository;
    private final SymbolRepository symbolRepository;
    private final RiskService riskService;
    private final MatchingEngineService matchingEngine;
    private final LiquidityProviderService house;
    private final PriceSimulatorService priceSimulator;
    private final MatchingCoordinator coordinator;
    private final TradingEvents events;
    private final MarketSession session;
    private final Accounts accounts;
    private final Balances balances;

    /** XTEST: a test exchange whose prices were frozen when the service started (VULN EQ-7). */
    private final Map<String, Symbol> xtestPrices = new ConcurrentHashMap<>();

    public OrderService(OrderRepository orderRepository, SymbolRepository symbolRepository, RiskService riskService,
                        MatchingEngineService matchingEngine, LiquidityProviderService house,
                        PriceSimulatorService priceSimulator, MatchingCoordinator coordinator, TradingEvents events,
                        MarketSession session, Accounts accounts, Balances balances) {
        this.orderRepository = orderRepository;
        this.symbolRepository = symbolRepository;
        this.riskService = riskService;
        this.matchingEngine = matchingEngine;
        this.house = house;
        this.priceSimulator = priceSimulator;
        this.coordinator = coordinator;
        this.events = events;
        this.session = session;
        this.accounts = accounts;
        this.balances = balances;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void freezeTestExchangePrices() {
        for (Symbol s : symbolRepository.findAll()) {
            if ("EQUITY".equals(s.getAssetClass())) {
                Symbol copy = new Symbol();
                copy.setSymbol(s.getSymbol());
                copy.setBid(s.getBid());
                copy.setAsk(s.getAsk());
                xtestPrices.put(s.getSymbol(), copy);
            }
        }
    }

    /**
     * Place a stock order. {@code channel} is "ws" when it came over the WebSocket.
     * {@code commission} and {@code exchange} are optional client fields (VULN EQ-3 / EQ-7).
     */
    public Order placeOrder(Long userId, OrderRequest request, String channel, BigDecimal commission, String exchange) {
        if (request.getSide() != null) {
            request.setSide(request.getSide().trim().toUpperCase(Locale.ROOT));
        }
        if (request.getType() != null) {
            request.setType(request.getType().trim().toUpperCase(Locale.ROOT));
        }
        if (request.getType() == null) {
            request.setType(request.getPrice() == null ? "MARKET" : "LIMIT");
        }
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

        // VULN EQ-1: the market-session check is skipped for orders that say they came over the
        //            WebSocket (X-Channel: ws). The gateway passes that header on as the client sent it.
        boolean viaWebSocket = "ws".equalsIgnoreCase(channel);
        if (!viaWebSocket && !session.isOpen()) {
            reject("market_closed", request, "Market is closed");
        }

        // A MARKET order from the trading screen (WebSocket) is priced at the live bid/ask.
        // VULN EQ-5: a MARKET order sent to the REST API without a price keeps price = null,
        //            so it holds $0 and passes the balance check: it can buy far more than it can pay.
        if ("MARKET".equals(request.getType()) && request.getPrice() == null && viaWebSocket) {
            symbolRepository.findById(request.getSymbol()).ifPresent(sym ->
                    request.setPrice("BUY".equals(request.getSide()) ? sym.getAsk() : sym.getBid()));
        }

        BigDecimal hold = holdFor(request, commission);
        String riskError = riskService.checkPreTrade(userId, request.getSymbol(), request.getSide(),
                request.getType(), request.getQuantity(), request.getPrice(), hold);
        if (riskError != null) {
            reject("risk_check_failed", request, riskError);
        }
        return coordinator.execute(() -> doPlace(userId, request, viaWebSocket, hold, commission, exchange));
    }

    /** Money a BUY locks: quantity x price (the house price for MARKET) + the commission. SELL locks nothing. */
    private BigDecimal holdFor(OrderRequest request, BigDecimal commission) {
        if (!"BUY".equals(request.getSide()) || request.getPrice() == null || request.getQuantity() == null) {
            return BigDecimal.ZERO;
        }
        BigDecimal price = request.getPrice();
        if ("MARKET".equals(request.getType())) {
            BigDecimal housePrice = house.fillPrice(request.getSymbol(), "BUY");
            if (housePrice != null) price = price.max(housePrice);
        }
        Order preview = new Order();
        preview.setQuantity(request.getQuantity());
        preview.setCommission(commission);
        BigDecimal value = request.getQuantity().multiply(price);
        return value.add(Commission.total(preview, request.getQuantity())).max(BigDecimal.ZERO).setScale(8, java.math.RoundingMode.HALF_UP);
    }

    private Order doPlace(Long userId, OrderRequest request, boolean viaWebSocket, BigDecimal hold,
                          BigDecimal commission, String exchange) {
        // VULN #46 (as EQ-1): a halted stock still trades when the order says it came over the WebSocket
        if (!viaWebSocket && priceSimulator.isHalted(request.getSymbol())) {
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
        order.setCreatedAt(LocalDateTime.now(ZoneOffset.UTC));
        order.setProduct(PRODUCT);
        order.setHoldLeft(hold);
        order.setCommission(commission);
        order = orderRepository.save(order);
        if (hold.signum() > 0) {
            // Not re-checked under the lock (VULN #43): the check above may be stale already.
            balances.hold(accounts.find(userId, PRODUCT), "USD", hold);
        }

        log(SecurityEvent.ORDER_CREATED, Outcome.SUCCESS,
                details("orderId", order.getId(), "symbol", order.getSymbol(), "side", order.getSide(),
                        "orderType", order.getOrderType(), "quantity", order.getQuantity(), "price", order.getPrice(),
                        "clientOrderId", order.getClientOrderId(), "product", PRODUCT,
                        "channel", viaWebSocket ? "ws" : "rest", "exchange", exchange));

        route(order, exchange);
        return order;
    }

    /**
     * "Route": which exchange gets the order. Today always XSIM, our one simulated exchange.
     * Future slot: a Smart Order Router that compares several exchanges (best execution).
     */
    private void route(Order order, String exchange) {
        if ("XTEST".equalsIgnoreCase(exchange)) {
            // VULN EQ-7: a hidden "exchange" parameter reaches XTEST, a test venue whose prices
            //            were frozen at startup: the house fills there at stale prices.
            Symbol stale = xtestPrices.get(order.getSymbol());
            BigDecimal price = stale == null ? null : ("BUY".equals(order.getSide()) ? stale.getAsk() : stale.getBid());
            String shortfall = price == null ? null : matchingEngine.fillFromHouse(order, price);
            if (MatchingEngineService.remaining(order).signum() > 0) {
                matchingEngine.closeOrder(order, "CANCELLED",
                        shortfall != null ? shortfall : MatchingEngineService.NO_LIQUIDITY);
            }
            orderRepository.save(order);
            events.orderChanged(order);
            return;
        }
        matchingEngine.match(order);
    }

    /**
     * Cancel an order.
     * VULN #44: no ownership check - anyone can cancel any stock order by id.
     */
    public Order cancelOrder(Long userId, Long orderId) {
        Order before = orderRepository.findByIdAndProduct(orderId, PRODUCT)
                .orElseThrow(() -> new RuntimeException("Order not found: " + orderId));
        // VULN EQ-4: the hold to give back is read here, BEFORE the lock. If a fill lands in
        //            between, the cancel still gives back the whole old hold: money released twice.
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
                balances.release(accounts.find(order.getUserId(), PRODUCT), "USD", holdToRelease);
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

    /**
     * Hard-delete an order that never traded (REST DELETE). Its hold goes back first.
     * VULN #44: no ownership check.
     */
    public boolean deleteOrder(Long orderId) {
        return coordinator.execute(() -> {
            Order order = orderRepository.findByIdAndProduct(orderId, PRODUCT).orElse(null);
            if (order == null) return false;
            BigDecimal filled = order.getFilledQty() != null ? order.getFilledQty() : BigDecimal.ZERO;
            if (filled.signum() > 0) {
                throw new IllegalStateException("Order " + orderId + " has trades and can't be deleted; cancel it instead");
            }
            if (order.getHoldLeft() != null && order.getHoldLeft().signum() != 0) {
                balances.release(accounts.find(order.getUserId(), PRODUCT), "USD", order.getHoldLeft());
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
