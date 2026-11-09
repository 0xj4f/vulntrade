package com.vulntrade.crypto;

import com.vulntrade.model.Symbol;
import com.vulntrade.money.Accounts;
import com.vulntrade.money.Balances;
import com.vulntrade.repository.SymbolRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.Optional;

/**
 * Pre-trade checks for a crypto order. Advisory: they run BEFORE the matching lock, so two
 * orders sent at the same moment can both pass with the same USD or the same coins
 * (VULN #43 - and for coins the balance can then go below zero, #63 in crypto form).
 *
 * VULN CR-6: no minimum quantity - 0.00000001 BTC is accepted.
 * VULN #40: no price band.
 */
@Service
public class RiskService {

    private final SymbolRepository symbolRepository;
    private final Accounts accounts;
    private final Balances balances;

    public RiskService(SymbolRepository symbolRepository, Accounts accounts, Balances balances) {
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
        Optional<Symbol> sym = symbolRepository.findById(symbol);
        if (sym.isEmpty() || !"CRYPTO".equals(sym.get().getAssetClass())) {
            return "Unknown symbol: " + symbol;
        }
        if (!Boolean.TRUE.equals(sym.get().getIsTradable())) {
            return "Symbol " + symbol + " is not currently tradable";
        }
        Long account = accounts.find(userId, Accounts.CRYPTO);
        String asset = "BUY".equalsIgnoreCase(side) ? "USD" : Fees.coin(symbol);
        BigDecimal available = account == null ? BigDecimal.ZERO : balances.available(account, asset);
        if (available.compareTo(hold) < 0) {
            return "Insufficient " + asset + ". Required: " + hold + ", Available: " + available;
        }
        return null;
    }
}
