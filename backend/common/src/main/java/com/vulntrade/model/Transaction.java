package com.vulntrade.model;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

import javax.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "transactions")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Transaction {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id")
    private Long userId;

    /** Which account the money moved in. NULL = the MAIN account (users.balance). */
    @Column(name = "account_id")
    private Long accountId;

    /** Which currency/asset moved (USD, EUR, BTC ...). */
    @Column(name = "asset", length = 10)
    private String asset = "USD";

    @Column(name = "type", length = 20, nullable = false)
    private String type;  // DEPOSIT/WITHDRAW/ADJUSTMENT/TRANSFER_IN/TRANSFER_OUT/TRADE_BUY/TRADE_SELL/TRADE_LEG/HOUSE_SEED

    @Column(name = "amount", precision = 20, scale = 8, nullable = false)
    private BigDecimal amount;

    @Column(name = "balance_after", precision = 20, scale = 8)
    private BigDecimal balanceAfter;

    @Column(name = "description", columnDefinition = "TEXT")
    private String description;

    @Column(name = "reference_id", length = 100)
    private String referenceId;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();
}
