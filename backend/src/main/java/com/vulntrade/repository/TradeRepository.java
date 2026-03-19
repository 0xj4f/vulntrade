package com.vulntrade.repository;

import com.vulntrade.model.Trade;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface TradeRepository extends JpaRepository<Trade, Long> {

    List<Trade> findBySymbol(String symbol);

    List<Trade> findBySymbolOrderByExecutedAtDesc(String symbol);

    List<Trade> findByBuyOrderIdOrSellOrderId(Long buyOrderId, Long sellOrderId);
}
