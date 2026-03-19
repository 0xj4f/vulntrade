package com.vulntrade.service;

import com.vulntrade.model.Order;
import com.vulntrade.model.Trade;
import com.vulntrade.model.Position;
import com.vulntrade.model.Transaction;
import com.vulntrade.model.dto.TradeNotification;
import com.vulntrade.model.dto.OrderBookEntry;
import com.vulntrade.repository.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Order matching engine.
 * 
 * VULN: Self-matching allowed (wash trading).
 * VULN: No circuit breaker on rapid price movement.
 * VULN: Matching processes synchronously (timing attacks).
 * VULN: Partial fills update positions with floating point errors.
 */
@Service
public class MatchingEngineService {

    private static final Logger logger = LoggerFactory.getLogger(MatchingEngineService.class);

    private final OrderRepository orderRepository;
    private final TradeRepository tradeRepository;
    private final PositionRepository positionRepository;
    private final UserRepository userRepository;
    private final TransactionRepository transactionRepository;
    private final SimpMessagingTemplate messagingTemplate;

    public MatchingEngineService(OrderRepository orderRepository,
                                  TradeRepository tradeRepository,
                                  PositionRepository positionRepository,
                                  UserRepository userRepository,
                                  TransactionRepository transactionRepository,
                                  SimpMessagingTemplate messagingTemplate) {
        this.orderRepository = orderRepository;
        this.tradeRepository = tradeRepository;
        this.positionRepository = positionRepository;
        this.userRepository = userRepository;
        this.transactionRepository = transactionRepository;
        this.messagingTemplate = messagingTemplate;
    }

    /**
     * Try to match an incoming order against the order book.
     * VULN: Self-matching allowed (wash trading).
     * VULN: No circuit breaker.
     * VULN: Synchronous processing (timing attacks).
     */
    public void tryMatch(Order incomingOrder) {
        String opposingSide = "BUY".equals(incomingOrder.getSide()) ? "SELL" : "BUY";

        // Find opposing orders
        List<Order> opposingOrders = orderRepository.findBySymbolAndSideAndStatus(
                incomingOrder.getSymbol(), opposingSide, "NEW");

        // Sort by price-time priority
        if ("BUY".equals(incomingOrder.getSide())) {
            // For buy orders, match against lowest sell prices first
            opposingOrders.sort((a, b) -> {
                int priceCompare = a.getPrice().compareTo(b.getPrice());
                return priceCompare != 0 ? priceCompare : a.getCreatedAt().compareTo(b.getCreatedAt());
            });
        } else {
            // For sell orders, match against highest buy prices first
            opposingOrders.sort((a, b) -> {
                int priceCompare = b.getPrice().compareTo(a.getPrice());
                return priceCompare != 0 ? priceCompare : a.getCreatedAt().compareTo(b.getCreatedAt());
            });
        }

        BigDecimal remainingQty = incomingOrder.getQuantity().subtract(
                incomingOrder.getFilledQty() != null ? incomingOrder.getFilledQty() : BigDecimal.ZERO);

        for (Order opposing : opposingOrders) {
            if (remainingQty.compareTo(BigDecimal.ZERO) <= 0) break;

            // Check price match
            boolean priceMatch;
            if ("BUY".equals(incomingOrder.getSide())) {
                priceMatch = incomingOrder.getPrice().compareTo(opposing.getPrice()) >= 0;
            } else {
                priceMatch = incomingOrder.getPrice().compareTo(opposing.getPrice()) <= 0;
            }

            if (!priceMatch) continue;

            // VULN: Self-matching allowed - no check if same user
            // A user can create both buy and sell orders and match with themselves

            BigDecimal opposingRemaining = opposing.getQuantity().subtract(
                    opposing.getFilledQty() != null ? opposing.getFilledQty() : BigDecimal.ZERO);
            BigDecimal fillQty = remainingQty.min(opposingRemaining);
            BigDecimal fillPrice = opposing.getPrice(); // Execute at resting order price

            // Execute the trade
            executeTrade(incomingOrder, opposing, fillQty, fillPrice);

            remainingQty = remainingQty.subtract(fillQty);
        }

        // Update incoming order status
        if (remainingQty.compareTo(BigDecimal.ZERO) <= 0) {
            incomingOrder.setStatus("FILLED");
            incomingOrder.setExecutedAt(LocalDateTime.now());
        } else if (incomingOrder.getFilledQty() != null &&
                   incomingOrder.getFilledQty().compareTo(BigDecimal.ZERO) > 0) {
            incomingOrder.setStatus("PARTIAL");
        }
        orderRepository.save(incomingOrder);
    }

    /**
     * Execute a trade between two orders.
     * VULN: Floating point precision errors in P&L calculation.
     * VULN: Position can go negative (unauthorized short selling).
     */
    private void executeTrade(Order buyOrder, Order sellOrder,
                               BigDecimal quantity, BigDecimal price) {
        // Determine which is buy and which is sell
        Order actualBuy = "BUY".equals(buyOrder.getSide()) ? buyOrder : sellOrder;
        Order actualSell = "SELL".equals(buyOrder.getSide()) ? buyOrder : sellOrder;

        // Create trade record
        Trade trade = new Trade();
        trade.setBuyOrderId(actualBuy.getId());
        trade.setSellOrderId(actualSell.getId());
        trade.setSymbol(actualBuy.getSymbol());
        trade.setQuantity(quantity);
        trade.setPrice(price);
        trade.setExecutedAt(LocalDateTime.now());
        final Trade savedTrade = tradeRepository.save(trade);

        // Update order fill quantities
        actualBuy.setFilledQty((actualBuy.getFilledQty() != null ? actualBuy.getFilledQty() : BigDecimal.ZERO).add(quantity));
        actualBuy.setFilledPrice(price);
        if (actualBuy.getFilledQty().compareTo(actualBuy.getQuantity()) >= 0) {
            actualBuy.setStatus("FILLED");
            actualBuy.setExecutedAt(LocalDateTime.now());
        } else {
            actualBuy.setStatus("PARTIAL");
        }
        orderRepository.save(actualBuy);

        actualSell.setFilledQty((actualSell.getFilledQty() != null ? actualSell.getFilledQty() : BigDecimal.ZERO).add(quantity));
        actualSell.setFilledPrice(price);
        if (actualSell.getFilledQty().compareTo(actualSell.getQuantity()) >= 0) {
            actualSell.setStatus("FILLED");
            actualSell.setExecutedAt(LocalDateTime.now());
        } else {
            actualSell.setStatus("PARTIAL");
        }
        orderRepository.save(actualSell);

        // Update buyer position
        updatePosition(actualBuy.getUserId(), actualBuy.getSymbol(), quantity, price, true);
        // Update seller position
        updatePosition(actualSell.getUserId(), actualSell.getSymbol(), quantity, price, false);

        // Update balances
        BigDecimal tradeValue = quantity.multiply(price);

        // Deduct from buyer
        userRepository.findById(actualBuy.getUserId()).ifPresent(buyer -> {
            buyer.setBalance(buyer.getBalance().subtract(tradeValue));
            userRepository.save(buyer);

            // Record transaction
            Transaction txn = new Transaction();
            txn.setUserId(buyer.getId());
            txn.setType("TRADE_BUY");
            txn.setAmount(tradeValue.negate());
            txn.setBalanceAfter(buyer.getBalance());
            txn.setDescription("Bought " + quantity + " " + actualBuy.getSymbol() + " @ " + price);
            txn.setReferenceId("TRADE-" + savedTrade.getId());
            transactionRepository.save(txn);
        });

        // Credit seller
        userRepository.findById(actualSell.getUserId()).ifPresent(seller -> {
            seller.setBalance(seller.getBalance().add(tradeValue));
            userRepository.save(seller);

            Transaction txn = new Transaction();
            txn.setUserId(seller.getId());
            txn.setType("TRADE_SELL");
            txn.setAmount(tradeValue);
            txn.setBalanceAfter(seller.getBalance());
            txn.setDescription("Sold " + quantity + " " + actualSell.getSymbol() + " @ " + price);
            txn.setReferenceId("TRADE-" + savedTrade.getId());
            transactionRepository.save(txn);
        });

        // Broadcast trade notification
        // VULN: Includes internal trade IDs and user IDs
        TradeNotification notification = new TradeNotification();
        notification.setTradeId(savedTrade.getId());
        notification.setSymbol(savedTrade.getSymbol());
        notification.setQuantity(savedTrade.getQuantity());
        notification.setPrice(savedTrade.getPrice());
        notification.setBuyUserId(actualBuy.getUserId());    // VULN: user ID disclosed
        notification.setSellUserId(actualSell.getUserId());  // VULN: user ID disclosed
        notification.setBuyOrderId(actualBuy.getId());       // VULN: order ID disclosed
        notification.setSellOrderId(actualSell.getId());     // VULN: order ID disclosed
        notification.setTimestamp(System.currentTimeMillis());

        messagingTemplate.convertAndSend("/topic/trades", notification);

        // Send order updates to specific users
        messagingTemplate.convertAndSendToUser(
                String.valueOf(actualBuy.getUserId()),
                "/queue/orders",
                actualBuy);
        messagingTemplate.convertAndSendToUser(
                String.valueOf(actualSell.getUserId()),
                "/queue/orders",
                actualSell);

        // Update order book broadcast
        broadcastOrderBook(actualBuy.getSymbol());

        logger.info("Trade executed: {} {} x {} @ {} (buy_order={}, sell_order={})",
                savedTrade.getSymbol(), quantity, price,
                actualBuy.getId(), actualSell.getId());
    }

    /**
     * Update user position.
     * VULN: Position can go negative (unauthorized short selling).
     * VULN: P&L calculation uses floating point (precision errors).
     */
    private void updatePosition(Long userId, String symbol, BigDecimal quantity,
                                 BigDecimal price, boolean isBuy) {
        Optional<Position> posOpt = positionRepository.findByUserIdAndSymbol(userId, symbol);
        Position position;

        if (posOpt.isPresent()) {
            position = posOpt.get();
            if (isBuy) {
                // Add to position
                BigDecimal totalCost = position.getAvgPrice().multiply(position.getQuantity())
                        .add(price.multiply(quantity));
                BigDecimal newQty = position.getQuantity().add(quantity);
                // VULN: floating point division for avg price
                position.setAvgPrice(totalCost.divide(newQty, 8, RoundingMode.HALF_UP));
                position.setQuantity(newQty);
            } else {
                // VULN: Position can go negative - no check
                position.setQuantity(position.getQuantity().subtract(quantity));
            }
        } else {
            position = new Position();
            position.setUserId(userId);
            position.setSymbol(symbol);
            if (isBuy) {
                position.setQuantity(quantity);
                position.setAvgPrice(price);
            } else {
                // VULN: Creating a negative position (naked short)
                position.setQuantity(quantity.negate());
                position.setAvgPrice(price);
            }
        }

        position.setUpdatedAt(LocalDateTime.now());
        positionRepository.save(position);
    }

    /**
     * Broadcast current order book.
     * VULN: Includes orderer's userId (information disclosure).
     * VULN: Shows all pending orders (front-running possible).
     */
    public void broadcastOrderBook(String symbol) {
        List<Order> orders = orderRepository.findBySymbolAndStatus(symbol, "NEW");

        List<OrderBookEntry> entries = orders.stream().map(o -> {
            OrderBookEntry entry = new OrderBookEntry();
            entry.setOrderId(o.getId());         // VULN: order ID exposed
            entry.setSymbol(o.getSymbol());
            entry.setSide(o.getSide());
            entry.setPrice(o.getPrice());
            entry.setQuantity(o.getQuantity().subtract(
                    o.getFilledQty() != null ? o.getFilledQty() : BigDecimal.ZERO));
            entry.setUserId(o.getUserId());      // VULN: user ID disclosed
            // Look up username for extra info disclosure
            userRepository.findById(o.getUserId()).ifPresent(u ->
                    entry.setUsername(u.getUsername()));  // VULN: username disclosed
            entry.setTimestamp(o.getCreatedAt().atZone(java.time.ZoneId.systemDefault())
                    .toInstant().toEpochMilli());
            return entry;
        }).collect(Collectors.toList());

        messagingTemplate.convertAndSend("/topic/orderbook", entries);
    }
}
