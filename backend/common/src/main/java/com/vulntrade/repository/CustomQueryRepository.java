package com.vulntrade.repository;

import org.springframework.stereotype.Repository;

import javax.persistence.EntityManager;
import javax.persistence.PersistenceContext;
import javax.persistence.Query;
import java.util.List;

/**
 * VULN: This repository uses raw SQL queries - SQL injection playground.
 * Intentionally vulnerable for red team training.
 */
@Repository
public class CustomQueryRepository {

    @PersistenceContext
    private EntityManager entityManager;

    /**
     * VULN: SQL injection in trade history query.
     * Parameters are concatenated directly into SQL string.
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> getTradeHistory(String userId, String startDate, String endDate, String symbol) {
        // VULN: Direct string concatenation - SQL injection
        String sql = "SELECT t.id, t.symbol, t.quantity, t.price, t.executed_at " +
                     "FROM trades t " +
                     "JOIN orders o ON (t.buy_order_id = o.id OR t.sell_order_id = o.id) " +
                     "WHERE o.user_id = " + userId;

        if (startDate != null && !startDate.isEmpty()) {
            sql += " AND t.executed_at >= '" + startDate + "'";  // VULN: SQLi
        }
        if (endDate != null && !endDate.isEmpty()) {
            sql += " AND t.executed_at <= '" + endDate + "'";    // VULN: SQLi
        }
        if (symbol != null && !symbol.isEmpty()) {
            sql += " AND t.symbol = '" + symbol + "'";           // VULN: SQLi
        }

        sql += " ORDER BY t.executed_at DESC";

        Query query = entityManager.createNativeQuery(sql);
        return query.getResultList();
    }

    /**
     * VULN: Raw SQL execution endpoint for admin.
     * Full SQL injection playground.
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> executeRawQuery(String sql) {
        // VULN: Executes arbitrary SQL
        Query query = entityManager.createNativeQuery(sql);
        return query.getResultList();
    }

    /**
     * VULN: Raw SQL execution for updates/inserts.
     */
    public int executeRawUpdate(String sql) {
        // VULN: Executes arbitrary SQL modifications
        Query query = entityManager.createNativeQuery(sql);
        return query.executeUpdate();
    }
}
