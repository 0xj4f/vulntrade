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

    List<Order> findByStatus(String status);
}
