package com.vulntrade.equities;

import com.vulntrade.model.Position;
import com.vulntrade.model.Symbol;
import com.vulntrade.money.Accounts;
import com.vulntrade.money.Balances;
import com.vulntrade.repository.PositionRepository;
import com.vulntrade.repository.SymbolRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.Optional;

/**
 * Pre-trade checks for a stock order (the same controls as 0.6.0).
 *
 * Advisory: they run BEFORE the matching lock, so two orders sent at the same moment can both
 * pass with the same money (VULN #43, the "same USD hold used twice" race). Holding the money
 * happens under the lock, but without re-checking.
 *
 * VULN EQ-2: no lot-size check - 0.0001 shares is accepted.
 * VULN #40: no price band - a limit of 0.01 or 999999 is accepted.
 */
@Service
public class RiskService {

    private final PositionRepository positionRepository;
    private final SymbolRepository symbolRepository;
    private final Accounts accounts;
    private final Balances balances;

    public RiskService(PositionRepository positionRepository, SymbolRepository symbolRepository,
                       Accounts accounts, Balances balances) {
        this.positionRepository = positionRepository;
        this.symbolRepository = symbolRepository;
        this.accounts = accounts;
        this.balances = balances;
    }

    /** @return null if the order may go ahead, otherwise the reason it is refused. */
    public String checkPreTrade(Long userId, String symbol, String side, String orderType,
                                BigDecimal quantity, BigDecimal price, BigDecimal hold) {
        if (quantity == null || quantity.signum() <= 0) {
            return "Invalid quantity: must be greater than 0";
        }
        if ("LIMIT".equalsIgnoreCase(orderType) && (price == null || price.signum() <= 0)) {
            return "Invalid price: must be greater than 0 for LIMIT orders";
        }
        Optional<Symbol> symbolOpt = symbolRepository.findById(symbol);
        if (symbolOpt.isEmpty() || !"EQUITY".equals(symbolOpt.get().getAssetClass())) {
            return "Unknown symbol: " + symbol;
        }
        if (!Boolean.TRUE.equals(symbolOpt.get().getIsTradable())) {
            return "Symbol " + symbol + " is not currently tradable";
        }
        if ("BUY".equalsIgnoreCase(side)) {
            Long account = accounts.find(userId, Accounts.EQUITIES);
            BigDecimal available = account == null ? BigDecimal.ZERO : balances.available(account, "USD");
            if (available.compareTo(hold) < 0) {
                return "Insufficient balance. Required: " + hold + ", Available: " + available;
            }
        }
        if ("SELL".equalsIgnoreCase(side)) {
            Optional<Position> pos = positionRepository.findByUserIdAndSymbol(userId, symbol);
            if (pos.isEmpty() || pos.get().getQuantity().compareTo(quantity) < 0) {
                BigDecimal have = pos.map(Position::getQuantity).orElse(BigDecimal.ZERO);
                return "Insufficient position. Required: " + quantity + " " + symbol + ", Available: " + have;
            }
        }
        return null;
    }
}
