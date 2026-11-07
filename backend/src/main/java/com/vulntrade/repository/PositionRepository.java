package com.vulntrade.repository;

import com.vulntrade.model.Position;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

@Repository
public interface PositionRepository extends JpaRepository<Position, Long> {

    List<Position> findByUserId(Long userId);

    Optional<Position> findByUserIdAndSymbol(Long userId, String symbol);

    /** Quantity held, straight from the database (0 when there is no row). */
    @Query(value = "SELECT COALESCE((SELECT quantity FROM positions WHERE user_id = :userId AND symbol = :symbol), 0)",
            nativeQuery = true)
    BigDecimal findQuantity(@Param("userId") Long userId, @Param("symbol") String symbol);

    /**
     * Sell side of a fill: take shares out only if they are there, book the realized P&amp;L
     * against the average cost, and reset the average once the position is flat.
     * Returns 1 on success, 0 if the seller doesn't hold enough.
     */
    @Transactional
    @Modifying(flushAutomatically = true)
    @Query(value = "UPDATE positions SET "
            + " realized_pnl = COALESCE(realized_pnl, 0) + (CAST(:price AS NUMERIC) - COALESCE(avg_price, 0)) * :qty,"
            + " avg_price = CASE WHEN quantity - :qty = 0 THEN 0 ELSE avg_price END,"
            + " quantity = quantity - :qty,"
            + " updated_at = now() AT TIME ZONE 'UTC'"
            + " WHERE user_id = :userId AND symbol = :symbol AND quantity >= :qty",
            nativeQuery = true)
    int sellIfSufficient(@Param("userId") Long userId, @Param("symbol") String symbol,
                         @Param("qty") BigDecimal qty, @Param("price") BigDecimal price);

    /** Buy side of a fill: add shares and fold the fill into a weighted average cost. */
    @Transactional
    @Modifying(flushAutomatically = true)
    @Query(value = "INSERT INTO positions (user_id, symbol, quantity, avg_price, unrealized_pnl, realized_pnl, updated_at)"
            + " VALUES (:userId, :symbol, :qty, :price, 0, 0, now() AT TIME ZONE 'UTC')"
            + " ON CONFLICT (user_id, symbol) DO UPDATE SET"
            + " avg_price = ROUND((COALESCE(positions.avg_price, 0) * COALESCE(positions.quantity, 0)"
            + "             + EXCLUDED.avg_price * EXCLUDED.quantity)"
            + "             / NULLIF(COALESCE(positions.quantity, 0) + EXCLUDED.quantity, 0), 8),"
            + " quantity = COALESCE(positions.quantity, 0) + EXCLUDED.quantity,"
            + " updated_at = now() AT TIME ZONE 'UTC'",
            nativeQuery = true)
    int upsertBuy(@Param("userId") Long userId, @Param("symbol") String symbol,
                  @Param("qty") BigDecimal qty, @Param("price") BigDecimal price);
}
