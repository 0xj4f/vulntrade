package com.vulntrade.service;

import com.vulntrade.model.Position;
import com.vulntrade.repository.PositionRepository;
import com.vulntrade.repository.SymbolRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Portfolio service.
 * 
 * VULN: Accepts optional userId parameter - returns ANY user's portfolio (IDOR).
 */
@Service
public class PortfolioService {

    private final PositionRepository positionRepository;
    private final SymbolRepository symbolRepository;

    public PortfolioService(PositionRepository positionRepository,
                            SymbolRepository symbolRepository) {
        this.positionRepository = positionRepository;
        this.symbolRepository = symbolRepository;
    }

    /**
     * Get portfolio for a user.
     * VULN: No ownership check - returns any user's portfolio.
     */
    public List<Map<String, Object>> getPortfolio(Long userId) {
        List<Position> positions = positionRepository.findByUserId(userId);

        return positions.stream().map(pos -> {
            Map<String, Object> posMap = new HashMap<>();
            posMap.put("id", pos.getId());
            posMap.put("userId", pos.getUserId());   // VULN: userId exposed
            posMap.put("symbol", pos.getSymbol());
            posMap.put("quantity", pos.getQuantity());
            posMap.put("avgPrice", pos.getAvgPrice());

            // Calculate unrealized P&L using current price
            symbolRepository.findById(pos.getSymbol()).ifPresent(sym -> {
                BigDecimal currentPrice = sym.getCurrentPrice();
                BigDecimal unrealizedPnl = currentPrice.subtract(pos.getAvgPrice())
                        .multiply(pos.getQuantity())
                        .setScale(2, RoundingMode.HALF_UP);
                posMap.put("currentPrice", currentPrice);
                posMap.put("unrealizedPnl", unrealizedPnl);
                posMap.put("marketValue", currentPrice.multiply(pos.getQuantity())
                        .setScale(2, RoundingMode.HALF_UP));
            });

            posMap.put("updatedAt", pos.getUpdatedAt());
            return posMap;
        }).collect(Collectors.toList());
    }
}
