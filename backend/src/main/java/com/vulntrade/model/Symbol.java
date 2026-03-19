package com.vulntrade.model;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

import javax.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "symbols")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Symbol {

    @Id
    @Column(name = "symbol", length = 20)
    private String symbol;

    @Column(name = "name", length = 100, nullable = false)
    private String name;

    @Column(name = "current_price", precision = 20, scale = 8, nullable = false)
    private BigDecimal currentPrice;

    @Column(name = "bid", precision = 20, scale = 8)
    private BigDecimal bid;

    @Column(name = "ask", precision = 20, scale = 8)
    private BigDecimal ask;

    @Column(name = "volume")
    private Long volume = 0L;

    @Column(name = "last_updated")
    private LocalDateTime lastUpdated = LocalDateTime.now();

    @Column(name = "is_tradable")
    private Boolean isTradable = true;
}
