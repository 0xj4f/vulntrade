package com.vulntrade.repository;

import com.vulntrade.model.PriceAlert;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface PriceAlertRepository extends JpaRepository<PriceAlert, Long> {

    List<PriceAlert> findByUserId(Long userId);

    List<PriceAlert> findBySymbolAndIsTriggered(String symbol, Boolean isTriggered);

    List<PriceAlert> findByIsTriggered(Boolean isTriggered);

    long countByUserId(Long userId);
}
