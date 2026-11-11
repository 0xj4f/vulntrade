package com.vulntrade.equities;

import com.vulntrade.model.Order;
import com.vulntrade.model.Symbol;
import com.vulntrade.money.Accounts;
import com.vulntrade.repository.OrderRepository;
import com.vulntrade.repository.SymbolRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.time.ZoneOffset;

/**
 * The house (user 1) as the liquidity provider of the simulated exchange XSIM: it takes the other
 * side of MARKET orders and marketable LIMIT orders the book can't fill, and (through
 * {@link HouseMarketMakerService}) of resting LIMIT orders a later price move crosses.
 *
 * Its money is the house's EQUITIES account (USD) and its shares are its positions.
 *
 * Configuration: liquidity.house-user-id (1), liquidity.spread-percent (0.01 = 0.01%), liquidity.enabled.
 */
@Service
public class LiquidityProviderService {

    private final OrderRepository orderRepository;
    private final SymbolRepository symbolRepository;
    private final Accounts accounts;

    @Value("${liquidity.house-user-id:1}")
    private Long houseUserId;

    @Value("${liquidity.spread-percent:0.01}")
    private BigDecimal spreadPercent;

    @Value("${liquidity.enabled:true}")
    private boolean enabled;

    public LiquidityProviderService(OrderRepository orderRepository, SymbolRepository symbolRepository,
                                    Accounts accounts) {
        this.orderRepository = orderRepository;
        this.symbolRepository = symbolRepository;
        this.accounts = accounts;
    }

    /**
     * Price at which the house trades with a trader on {@code traderSide}:
     * BUY -> ask + spread (trader pays slightly more), SELL -> bid - spread. Null without a quote.
     */
    public BigDecimal fillPrice(Symbol sym, String traderSide) {
        if (sym == null) return null;
        BigDecimal m = spreadPercent.divide(new BigDecimal("100"), 8, RoundingMode.HALF_UP);
        if ("BUY".equalsIgnoreCase(traderSide)) {
            BigDecimal ask = sym.getAsk();
            if (ask == null || ask.signum() <= 0) return null;
            return ask.add(ask.multiply(m)).setScale(8, RoundingMode.HALF_UP);
        }
        BigDecimal bid = sym.getBid();
        if (bid == null || bid.signum() <= 0) return null;
        return bid.subtract(bid.multiply(m)).setScale(8, RoundingMode.HALF_UP);
    }

    public BigDecimal fillPrice(String symbol, String traderSide) {
        return symbolRepository.findById(symbol).map(s -> fillPrice(s, traderSide)).orElse(null);
    }

    /** The house's side of a fill that is not saved yet (used to work out who pays what). */
    public Order houseSide(String symbol, String houseSide) {
        Order o = new Order();
        o.setUserId(houseUserId);
        o.setSymbol(symbol);
        o.setSide(houseSide);
        o.setProduct(Accounts.EQUITIES);
        return o;
    }

    /** Record the house's side of a fill as its own (filled) order, tagged "LP-". */
    public Order createHouseOrder(String symbol, String houseSide, BigDecimal quantity, BigDecimal price) {
        Order houseOrder = houseSide(symbol, houseSide);
        houseOrder.setOrderType("MARKET");
        houseOrder.setQuantity(quantity);
        houseOrder.setPrice(price);
        houseOrder.setStatus("NEW");
        houseOrder.setFilledQty(BigDecimal.ZERO);
        houseOrder.setClientOrderId("LP-" + System.currentTimeMillis());
        houseOrder.setCreatedAt(LocalDateTime.now(ZoneOffset.UTC));
        return orderRepository.save(houseOrder);
    }

    public boolean isHouse(Long userId) {
        return houseUserId.equals(userId);
    }

    /** The house's EQUITIES account (its trading cash). */
    public Long houseAccount() {
        return accounts.find(houseUserId, Accounts.EQUITIES);
    }

    public Long getHouseUserId() {
        return houseUserId;
    }

    public boolean isEnabled() {
        return enabled;
    }
}
