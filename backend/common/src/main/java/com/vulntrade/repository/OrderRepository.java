package com.vulntrade.repository;

import com.vulntrade.model.Order;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {

    List<Order> findByUserId(Long userId);

    List<Order> findBySymbolAndStatus(String symbol, String status);

    List<Order> findBySymbolAndSideAndStatus(String symbol, String side, String status);

    // Resting-order finders that include PARTIAL, so partially-filled orders stay in the book.
    List<Order> findBySymbolAndSideAndStatusIn(String symbol, String side, java.util.List<String> statuses);

    List<Order> findBySymbolAndStatusIn(String symbol, java.util.List<String> statuses);

    List<Order> findByStatus(String status);

    /** Open orders of one user on one symbol, oldest first. */
    @Query("SELECT o FROM Order o WHERE o.symbol = :symbol AND o.status IN ('NEW','PARTIAL')"
            + " AND o.orderType = 'LIMIT' AND o.price IS NOT NULL AND o.userId <> :houseId"
            + " ORDER BY o.createdAt ASC, o.id ASC")
    List<Order> findRestingUserLimits(@Param("symbol") String symbol, @Param("houseId") Long houseId);

    /** The house's own market-making ladder (tagged by client order id AND owned by the house). */
    @Query("SELECT o FROM Order o WHERE o.userId = :houseId AND o.symbol = :symbol"
            + " AND o.status IN ('NEW','PARTIAL') AND o.clientOrderId LIKE 'HOUSE-MM-%'")
    List<Order> findOpenHouseQuotes(@Param("houseId") Long houseId, @Param("symbol") String symbol);

    /** MARKET orders left resting by older builds (a MARKET order must never rest). */
    @Query("SELECT o FROM Order o WHERE o.orderType = 'MARKET' AND o.status IN ('NEW','PARTIAL')")
    List<Order> findRestingMarketOrders();

    // ---- 1.0.0: each product service only touches its own orders ----------------

    /** One order of this product (an id from another product is "not found"). */
    java.util.Optional<Order> findByIdAndProduct(Long id, String product);

    List<Order> findByUserIdAndProductOrderByIdDesc(Long userId, String product);

    @Query("SELECT o FROM Order o WHERE o.orderType = 'MARKET' AND o.status IN ('NEW','PARTIAL') AND o.product = :product")
    List<Order> findRestingMarketOrders(@Param("product") String product);
}
