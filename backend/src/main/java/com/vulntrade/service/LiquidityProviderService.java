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
import java.util.Optional;

/**
 * Liquidity Provider Service — acts as the house / market maker.
 *
 * Guarantees that MARKET orders always fill by providing counter-liquidity
 * from the house account when no matching orders exist in the book.
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
     * Attempt to fill a MARKET order against the house.
     *
     * @param marketOrder  the unfilled (or partially filled) MARKET order
     * @param quantity     the remaining quantity to fill
     * @return the synthetic house counter-order if filled, or null if unable
     */
    public Order fillMarketOrder(Order marketOrder, BigDecimal quantity) {
        if (!enabled) {
            logger.info("Liquidity provider disabled, skipping house fill");
            return null;
        }

        // Don't fill house orders against itself
        if (houseUserId.equals(marketOrder.getUserId())) {
            logger.debug("House order — no self-fill");
            return null;
        }

        // 1. Determine fill price from live market data + spread
        BigDecimal fillPrice = calculateFillPrice(marketOrder.getSymbol(), marketOrder.getSide());
        if (fillPrice == null) {
            logger.warn("No market price available for {} — cannot provide liquidity", marketOrder.getSymbol());
            return null;
        }

        // 2. Check house can fulfill the order
        String houseSide = "BUY".equals(marketOrder.getSide()) ? "SELL" : "BUY";

        if ("SELL".equals(houseSide)) {
            // House is selling to the trader (trader is buying)
            // House needs enough position
            if (!houseHasPosition(marketOrder.getSymbol(), quantity)) {
                logger.warn("House has insufficient position for {} {} — cannot fill",
                        quantity, marketOrder.getSymbol());
                return null;
            }
        } else {
            // House is buying from the trader (trader is selling)
            // House needs enough balance
            BigDecimal cost = quantity.multiply(fillPrice);
            if (!houseHasBalance(cost)) {
                logger.warn("House has insufficient balance for ${} — cannot fill", cost);
                return null;
            }
        }

        // 3. Create synthetic house counter-order
        Order houseOrder = new Order();
        houseOrder.setUserId(houseUserId);
        houseOrder.setSymbol(marketOrder.getSymbol());
        houseOrder.setSide(houseSide);
        houseOrder.setOrderType("MARKET");
        houseOrder.setQuantity(quantity);
        houseOrder.setPrice(fillPrice);
        houseOrder.setStatus("FILLED");
        houseOrder.setFilledQty(quantity);
        houseOrder.setFilledPrice(fillPrice);
        houseOrder.setClientOrderId("LP-" + System.currentTimeMillis());
        houseOrder.setCreatedAt(LocalDateTime.now());
        houseOrder.setExecutedAt(LocalDateTime.now());
        houseOrder = orderRepository.save(houseOrder);

        logger.info("LP fill: {} {} {} x {} @ {} (spread={}%, houseOrder=#{})",
                marketOrder.getSide(), marketOrder.getSymbol(),
                quantity, fillPrice, spreadPercent, houseOrder.getId());

        return houseOrder;
    }

    /**
     * Calculate the fill price with spread applied.
     *
     * BUY orders  → fill at ask + spread  (trader pays slightly more)
     * SELL orders → fill at bid - spread  (trader receives slightly less)
     */
    private BigDecimal calculateFillPrice(String symbol, String traderSide) {
        Optional<Symbol> symOpt = symbolRepository.findById(symbol);
        if (symOpt.isEmpty()) return null;

        Symbol sym = symOpt.get();
        BigDecimal spreadMultiplier = spreadPercent.divide(new BigDecimal("100"), 8, RoundingMode.HALF_UP);

        if ("BUY".equalsIgnoreCase(traderSide)) {
            // Trader buying → house selling → use ask price + spread
            BigDecimal ask = sym.getAsk();
            if (ask == null || ask.compareTo(BigDecimal.ZERO) <= 0) return null;
            BigDecimal spreadAmount = ask.multiply(spreadMultiplier);
            return ask.add(spreadAmount).setScale(8, RoundingMode.HALF_UP);
        } else {
            // Trader selling → house buying → use bid price - spread
            BigDecimal bid = sym.getBid();
            if (bid == null || bid.compareTo(BigDecimal.ZERO) <= 0) return null;
            BigDecimal spreadAmount = bid.multiply(spreadMultiplier);
            return bid.subtract(spreadAmount).setScale(8, RoundingMode.HALF_UP);
        }
    }

    /**
     * Check if the house has enough position to sell.
     */
    private boolean houseHasPosition(String symbol, BigDecimal quantity) {
        Optional<Position> posOpt = positionRepository.findByUserIdAndSymbol(houseUserId, symbol);
        if (posOpt.isEmpty()) return false;
        return posOpt.get().getQuantity().compareTo(quantity) >= 0;
    }

    /**
     * Check if the house has enough balance to buy.
     */
    private boolean houseHasBalance(BigDecimal cost) {
        Optional<User> userOpt = userRepository.findById(houseUserId);
        if (userOpt.isEmpty()) return false;
        return userOpt.get().getBalance().compareTo(cost) >= 0;
    }

    // --- Getters for config (useful for debugging / API exposure) ---

    public Long getHouseUserId() { return houseUserId; }
    public BigDecimal getSpreadPercent() { return spreadPercent; }
    public boolean isEnabled() { return enabled; }
}
