package com.vulntrade.service;

import com.vulntrade.model.Order;
import com.vulntrade.model.User;
import com.vulntrade.model.dto.OrderUpdate;
import com.vulntrade.model.dto.TradeNotification;
import com.vulntrade.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.*;

/**
 * Collects what a matching transaction changed and publishes it only after the commit:
 * <ul>
 *   <li>{@code /user/queue/order-updates} — one ORDER_UPDATE per changed order, to its owner
 *       (addressed by username: STOMP principals are usernames, not numeric ids);</li>
 *   <li>{@code /topic/trades} — one message per trade;</li>
 *   <li>{@code /topic/orderbook} and {@code /topic/orderbook/{symbol}} — once per touched symbol.</li>
 * </ul>
 * Nothing is sent for a rolled-back transaction. The house account never receives order
 * updates (anyone can register the username "admin" — usernames are not unique).
 */
@Component
public class TradingEvents {

    private static final Logger logger = LoggerFactory.getLogger(TradingEvents.class);
    private static final String OUTBOX_KEY = TradingEvents.class.getName() + ".outbox";

    private final SimpMessagingTemplate messaging;
    private final UserRepository userRepository;
    private final OrderBookService orderBookService;

    @Value("${liquidity.house-user-id:1}")
    private Long houseUserId;

    public TradingEvents(SimpMessagingTemplate messaging, UserRepository userRepository,
                         OrderBookService orderBookService) {
        this.messaging = messaging;
        this.userRepository = userRepository;
        this.orderBookService = orderBookService;
    }

    private static class Outbox {
        final LinkedHashMap<Long, Order> orders = new LinkedHashMap<>();
        final List<TradeNotification> trades = new ArrayList<>();
        final LinkedHashSet<String> books = new LinkedHashSet<>();
        // Built in beforeCommit (inside the transaction), sent in afterCommit.
        final List<Object[]> userMessages = new ArrayList<>();
        final List<OrderBookService.Book> bookSnapshots = new ArrayList<>();
    }

    public void orderChanged(Order order) {
        Outbox outbox = outbox();
        outbox.orders.put(order.getId(), order);
        outbox.books.add(order.getSymbol());
    }

    public void tradeExecuted(TradeNotification trade) {
        Outbox outbox = outbox();
        outbox.trades.add(trade);
        outbox.books.add(trade.getSymbol());
    }

    public void bookChanged(String symbol) {
        outbox().books.add(symbol);
    }

    private Outbox outbox() {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            throw new IllegalStateException("TradingEvents must be used inside a matching transaction");
        }
        Outbox outbox = (Outbox) TransactionSynchronizationManager.getResource(OUTBOX_KEY);
        if (outbox == null) {
            Outbox created = new Outbox();
            TransactionSynchronizationManager.bindResource(OUTBOX_KEY, created);
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void beforeCommit(boolean readOnly) {
                    prepare(created);
                }

                @Override
                public void afterCommit() {
                    publish(created);
                }

                @Override
                public void afterCompletion(int status) {
                    TransactionSynchronizationManager.unbindResourceIfPossible(OUTBOX_KEY);
                }
            });
            outbox = created;
        }
        return outbox;
    }

    /** Inside the transaction: resolve usernames and snapshot the books as they will commit. */
    private void prepare(Outbox outbox) {
        Set<Long> ownerIds = new HashSet<>();
        for (Order o : outbox.orders.values()) {
            if (o.getUserId() != null && !o.getUserId().equals(houseUserId)) ownerIds.add(o.getUserId());
        }
        Map<Long, String> usernames = new HashMap<>();
        if (!ownerIds.isEmpty()) {
            userRepository.findAllById(ownerIds).forEach((User u) -> usernames.put(u.getId(), u.getUsername()));
        }
        for (Order o : outbox.orders.values()) {
            String username = usernames.get(o.getUserId());
            if (username != null) {
                outbox.userMessages.add(new Object[]{username, OrderUpdate.of(o)});
            }
        }
        for (String symbol : outbox.books) {
            outbox.bookSnapshots.add(orderBookService.snapshot(symbol));
        }
    }

    /** After the commit: send everything. */
    private void publish(Outbox outbox) {
        try {
            for (Object[] m : outbox.userMessages) {
                messaging.convertAndSendToUser((String) m[0], "/queue/order-updates", m[1]);
            }
            for (TradeNotification t : outbox.trades) {
                messaging.convertAndSend("/topic/trades", t);
            }
            for (OrderBookService.Book book : outbox.bookSnapshots) {
                messaging.convertAndSend("/topic/orderbook", book.entries());
                messaging.convertAndSend("/topic/orderbook/" + book.symbol, book.toMessage());
            }
        } catch (Exception e) {
            logger.warn("Failed to publish trading events: {}", e.getMessage());
        }
    }
}
