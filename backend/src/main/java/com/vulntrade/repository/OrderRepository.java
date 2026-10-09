package com.vulntrade.repository;

import com.vulntrade.model.Order;
import org.springframework.data.jpa.repository.JpaRepository;
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
}
