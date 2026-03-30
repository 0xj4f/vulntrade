package com.vulntrade.service;

import com.vulntrade.model.Position;
import com.vulntrade.model.Symbol;
import com.vulntrade.model.User;
import com.vulntrade.repository.PositionRepository;
import com.vulntrade.repository.SymbolRepository;
import com.vulntrade.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.Optional;

/**
 * Pre-trade risk checking service.
 * 
 * Validates:
 * - Symbol exists and is tradable
 * - Quantity > 0
 * - Price > 0 (for LIMIT orders)
 * - Buyer has sufficient balance
 * - Seller has sufficient position (asset ownership)
 */
@Service
public class RiskService {

    private static final Logger logger = LoggerFactory.getLogger(RiskService.class);
    private final UserRepository userRepository;
    private final PositionRepository positionRepository;
    private final SymbolRepository symbolRepository;

    public RiskService(UserRepository userRepository,
                       PositionRepository positionRepository,
                       SymbolRepository symbolRepository) {
        this.userRepository = userRepository;
        this.positionRepository = positionRepository;
        this.symbolRepository = symbolRepository;
    }

    /**
     * Pre-trade risk check — runs for ALL order types (MARKET and LIMIT).
     * 
     * @return null if check passes, error message if it fails
     */
    public String checkPreTrade(Long userId, String symbol, String side,
                                 String orderType, BigDecimal quantity, BigDecimal price) {

        // 1. Validate quantity > 0
        if (quantity == null || quantity.compareTo(BigDecimal.ZERO) <= 0) {
            return "Invalid quantity: must be greater than 0";
        }

        // 2. Validate price > 0 for LIMIT orders
        if ("LIMIT".equalsIgnoreCase(orderType)) {
            if (price == null || price.compareTo(BigDecimal.ZERO) <= 0) {
                return "Invalid price: must be greater than 0 for LIMIT orders";
            }
        }

        // 3. Validate symbol exists and is tradable
        Optional<Symbol> symbolOpt = symbolRepository.findById(symbol);
        if (symbolOpt.isEmpty()) {
            return "Unknown symbol: " + symbol;
        }
        Symbol sym = symbolOpt.get();
        if (!Boolean.TRUE.equals(sym.getIsTradable())) {
            return "Symbol " + symbol + " is not currently tradable";
        }

        // 4. Determine effective price for MARKET orders
        BigDecimal effectivePrice = price;
        if ("MARKET".equalsIgnoreCase(orderType)) {
            if ("BUY".equalsIgnoreCase(side)) {
                effectivePrice = sym.getAsk();
            } else {
                effectivePrice = sym.getBid();
            }
            if (effectivePrice == null || effectivePrice.compareTo(BigDecimal.ZERO) <= 0) {
                return "No valid market price available for " + symbol;
            }
        }

        // 5. Balance check for BUY orders
        if ("BUY".equalsIgnoreCase(side)) {
            User user = userRepository.findById(userId).orElse(null);
            if (user == null) {
                return "User not found";
            }

            BigDecimal orderValue = quantity.multiply(effectivePrice);
            BigDecimal balance = user.getBalance();

            logger.debug("Risk check BUY: userId={}, balance={}, orderValue={}", userId, balance, orderValue);

            if (balance.compareTo(orderValue) < 0) {
                return "Insufficient balance. Required: " + orderValue + ", Available: " + balance;
            }
        }

        // 6. Position check for SELL orders — must own enough of the asset
        if ("SELL".equalsIgnoreCase(side)) {
            Optional<Position> posOpt = positionRepository.findByUserIdAndSymbol(userId, symbol);
            if (posOpt.isEmpty() || posOpt.get().getQuantity().compareTo(quantity) < 0) {
                BigDecimal available = posOpt.map(Position::getQuantity).orElse(BigDecimal.ZERO);
                return "Insufficient position. Required: " + quantity + " " + symbol
                        + ", Available: " + available;
            }
        }

        return null;  // All checks passed
    }
}
