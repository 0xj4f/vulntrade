package com.vulntrade.model;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

import javax.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "trades")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Trade {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "buy_order_id")
    private Long buyOrderId;

    @Column(name = "sell_order_id")
    private Long sellOrderId;

    @Column(name = "symbol", length = 20, nullable = false)
    private String symbol;

    @Column(name = "quantity", precision = 20, scale = 8, nullable = false)
    private BigDecimal quantity;

    @Column(name = "price", precision = 20, scale = 8, nullable = false)
    private BigDecimal price;

    /** 1.0.0: FX / EQUITIES / CRYPTO */
    @Column(name = "product", length = 10)
    private String product;

    /** Fee paid by the buyer / the seller (USD). */
    @Column(name = "buy_fee", precision = 20, scale = 8)
    private BigDecimal buyFee = BigDecimal.ZERO;

    @Column(name = "sell_fee", precision = 20, scale = 8)
    private BigDecimal sellFee = BigDecimal.ZERO;

    @Column(name = "executed_at")
    private LocalDateTime executedAt = LocalDateTime.now();
}
