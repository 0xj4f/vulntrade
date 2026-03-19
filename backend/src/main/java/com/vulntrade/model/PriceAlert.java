package com.vulntrade.model;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

import javax.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "price_alerts")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class PriceAlert {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id")
    private Long userId;

    @Column(name = "symbol", length = 20, nullable = false)
    private String symbol;

    @Column(name = "target_price", precision = 20, scale = 8, nullable = false)
    private BigDecimal targetPrice;

    @Column(name = "direction", length = 5, nullable = false)
    private String direction;  // ABOVE/BELOW

    @Column(name = "is_triggered")
    private Boolean isTriggered = false;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();
}
