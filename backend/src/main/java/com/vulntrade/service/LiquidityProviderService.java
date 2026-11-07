package com.vulntrade.service;

import com.vulntrade.model.Order;
import com.vulntrade.model.Position;
import com.vulntrade.model.Symbol;
import com.vulntrade.model.User;
import com.vulntrade.repository.OrderRepository;
import com.vulntrade.repository.PositionRepository;
import com.vulntrade.repository.SymbolRepository;
import com.vulntrade.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Optional;

/**
 * Liquidity Provider Service — acts as the house / market maker.
 *
 * Provides counter-liquidity from the house account: MARKET orders and marketable LIMIT
 * orders that the book can't fill, and (through {@link HouseMarketMakerService}) resting
 * LIMIT orders that a later price move crosses. The matching engine settles every house
 * fill with the same never-negative rules as user fills.
 *
 * Configuration (application.yml):
 *   liquidity.house-user-id   — user ID of the house account (default: 1)
 *   liquidity.spread-percent  — spread fee as a percentage (default: 0.01)
 *   liquidity.enabled         — enable/disable the provider (default: true)
 */
@Service
public class LiquidityProviderService {

    private static final Logger logger = LoggerFactory.getLogger(LiquidityProviderService.class);

    private final OrderRepository orderRepository;
    private final UserRepository userRepository;
    private final PositionRepository positionRepository;
    private final SymbolRepository symbolRepository;

    @Value("${liquidity.house-user-id:1}")
    private Long houseUserId;

    @Value("${liquidity.spread-percent:0.01}")
    private BigDecimal spreadPercent;

    @Value("${liquidity.enabled:true}")
    private boolean enabled;

    public LiquidityProviderService(OrderRepository orderRepository,
                                     UserRepository userRepository,
                                     PositionRepository positionRepository,
                                     SymbolRepository symbolRepository) {
        this.orderRepository = orderRepository;
        this.userRepository = userRepository;
        this.positionRepository = positionRepository;
        this.symbolRepository = symbolRepository;
    }

    /**
     * Price at which the house trades with a trader on {@code traderSide}:
     * BUY → ask + spread (trader pays slightly more), SELL → bid − spread.
     * Returns null when there is no usable quote.
     */
    public BigDecimal fillPrice(Symbol sym, String traderSide) {
        if (sym == null) return null;
        BigDecimal m = spreadMultiplier();
        if ("BUY".equalsIgnoreCase(traderSide)) {
            BigDecimal ask = sym.getAsk();
            if (ask == null || ask.compareTo(BigDecimal.ZERO) <= 0) return null;
            return ask.add(ask.multiply(m)).setScale(8, RoundingMode.HALF_UP);
        }
        BigDecimal bid = sym.getBid();
        if (bid == null || bid.compareTo(BigDecimal.ZERO) <= 0) return null;
        return bid.subtract(bid.multiply(m)).setScale(8, RoundingMode.HALF_UP);
    }

    /** Same as {@link #fillPrice(Symbol, String)}, looked up by symbol. */
    public BigDecimal fillPrice(String symbol, String traderSide) {
        return symbolRepository.findById(symbol).map(s -> fillPrice(s, traderSide)).orElse(null);
    }

    /** spread-percent as a fraction (0.01% → 0.0001). */
    public BigDecimal spreadMultiplier() {
        return spreadPercent.divide(new BigDecimal("100"), 8, RoundingMode.HALF_UP);
    }

    /**
     * Record the house's side of a fill as its own order (the engine fills it right away).
     * Tagged "LP-" so it is never mistaken for a market-making ladder order.
     */
    public Order createHouseOrder(String symbol, String houseSide, BigDecimal quantity, BigDecimal price) {
        Order houseOrder = new Order();
        houseOrder.setUserId(houseUserId);
        houseOrder.setSymbol(symbol);
        houseOrder.setSide(houseSide);
        houseOrder.setOrderType("MARKET");
        houseOrder.setQuantity(quantity);
        houseOrder.setPrice(price);
        houseOrder.setStatus("NEW");
        houseOrder.setFilledQty(BigDecimal.ZERO);
        houseOrder.setClientOrderId("LP-" + System.currentTimeMillis());
        houseOrder.setCreatedAt(LocalDateTime.now(ZoneOffset.UTC));
        houseOrder = orderRepository.save(houseOrder);
        logger.debug("LP fill: house {} {} x {} @ {} (order #{})", houseSide, symbol, quantity, price, houseOrder.getId());
        return houseOrder;
    }

    // --- Getters for config (useful for debugging / API exposure) ---

    public Long getHouseUserId() { return houseUserId; }
    public BigDecimal getSpreadPercent() { return spreadPercent; }
    public boolean isEnabled() { return enabled; }
}
