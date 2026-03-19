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

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "executed_at")
    private LocalDateTime executedAt;
}
