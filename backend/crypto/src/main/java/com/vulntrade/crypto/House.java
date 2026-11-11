package com.vulntrade.crypto;

import com.vulntrade.model.Order;
import com.vulntrade.money.Accounts;
import com.vulntrade.repository.OrderRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.ZoneOffset;

/**
 * The house (user 1) on our crypto exchange: the market-maker bot's account. Its money is the
 * house CRYPTO account (USD and coins). Unlike Equities there is no "house fills what the book
 * can't": clients trade with each other and with the bot's orders on the book.
 */
@Component
public class House {

    private final OrderRepository orderRepository;
    private final Accounts accounts;

    @Value("${liquidity.house-user-id:1}")
    private Long houseUserId;

    public House(OrderRepository orderRepository, Accounts accounts) {
        this.orderRepository = orderRepository;
        this.accounts = accounts;
    }

    public boolean isHouse(Long userId) {
        return houseUserId.equals(userId);
    }

    public Long userId() {
        return houseUserId;
    }

    public Long account() {
        return accounts.find(houseUserId, Accounts.CRYPTO);
    }

    /** The house's side of a fill, not saved yet (used to work out who pays what). */
    public Order side(String symbol, String side) {
        Order o = new Order();
        o.setUserId(houseUserId);
        o.setSymbol(symbol);
        o.setSide(side);
        o.setProduct(Accounts.CRYPTO);
        return o;
    }

    /** Record the house's side of a sweep fill as its own (filled) order, tagged "MM-". */
    public Order createOrder(String symbol, String side, BigDecimal quantity, BigDecimal price) {
        Order o = side(symbol, side);
        o.setOrderType("MARKET");
        o.setQuantity(quantity);
        o.setPrice(price);
        o.setStatus("NEW");
        o.setFilledQty(BigDecimal.ZERO);
        o.setClientOrderId("MM-" + System.currentTimeMillis());
        o.setCreatedAt(LocalDateTime.now(ZoneOffset.UTC));
        return orderRepository.save(o);
    }
}
