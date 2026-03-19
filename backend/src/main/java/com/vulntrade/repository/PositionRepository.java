package com.vulntrade.repository;

import com.vulntrade.model.Position;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface PositionRepository extends JpaRepository<Position, Long> {

    List<Position> findByUserId(Long userId);

    Optional<Position> findByUserIdAndSymbol(Long userId, String symbol);
}
