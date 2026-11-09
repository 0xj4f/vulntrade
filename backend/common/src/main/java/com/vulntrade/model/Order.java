package com.vulntrade.model;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

import javax.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "orders")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Order {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id")
    private Long userId;

    @Column(name = "symbol", length = 20, nullable = false)
    private String symbol;

    @Column(name = "side", length = 4, nullable = false)
    private String side;  // BUY/SELL

    @Column(name = "order_type", length = 10, nullable = false)
    private String orderType;  // LIMIT/MARKET/STOP

    @Column(name = "quantity", precision = 20, scale = 8, nullable = false)
    private BigDecimal quantity;
    // VULN: no validation - can be negative

    @Column(name = "price", precision = 20, scale = 8)
    private BigDecimal price;
    // VULN: no validation - can be 0 or negative

    @Column(name = "status", length = 20)
    private String status = "NEW";

    @Column(name = "filled_qty", precision = 20, scale = 8)
    private BigDecimal filledQty = BigDecimal.ZERO;

    @Column(name = "filled_price", precision = 20, scale = 8)
    private BigDecimal filledPrice;

    @Column(name = "client_order_id", length = 100)
    private String clientOrderId;
    // VULN: not unique - replay attacks possible

    /** Why the engine closed the order (INSUFFICIENT_FUNDS, INSUFFICIENT_POSITION, NO_LIQUIDITY). */
    @Column(name = "status_reason", length = 32)
    private String statusReason;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "executed_at")
    private LocalDateTime executedAt;

    // ---- 1.0.0 -------------------------------------------------------------

    /** Which product service owns the order: FX / EQUITIES / CRYPTO. */
    @Column(name = "product", length = 10)
    private String product;

    /** Money still held (locked) for this open order. Released when the order closes. */
    @Column(name = "hold_left", precision = 20, scale = 8)
    private BigDecimal holdLeft = BigDecimal.ZERO;

    /** Commission / fees charged so far (USD). */
    @Column(name = "fee", precision = 20, scale = 8)
    private BigDecimal fee = BigDecimal.ZERO;

    /** Equities: the commission the client asked for (VULN EQ-3). null = the standard commission. */
    @Column(name = "commission", precision = 20, scale = 8)
    private BigDecimal commission;

    /** Crypto: MAKER / TAKER chosen by the client (VULN CR-3). null = decided by the engine. */
    @Column(name = "fee_role", length = 5)
    private String feeRole;
}
