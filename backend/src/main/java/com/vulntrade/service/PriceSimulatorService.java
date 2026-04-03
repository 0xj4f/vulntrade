package com.vulntrade.service;

import com.vulntrade.model.Symbol;
import com.vulntrade.model.dto.PriceUpdate;
import com.vulntrade.repository.SymbolRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Random;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Price simulation engine.
 * Generates realistic price movements (random walk) and publishes to /topic/prices.
 * 
 * VULN: Price generation seed is fixed (predictable).
 * VULN: BTC-USD has no decimal precision limit.
 * VULN: Price feed includes internal fields not stripped.
 * VULN: No entitlement check - all users get all symbols.
 * VULN: Special symbol "VULN" has predictable price pattern.
 */
@Service
public class PriceSimulatorService {

    private static final Logger logger = LoggerFactory.getLogger(PriceSimulatorService.class);

    private final SymbolRepository symbolRepository;
    private final SimpMessagingTemplate messagingTemplate;

    // VULN: Fixed seed makes prices predictable
    private final Random random = new Random(42);

    // Track halted symbols
    private final ConcurrentHashMap<String, Boolean> haltedSymbols = new ConcurrentHashMap<>();

    // Track manually overridden symbols — simulator skips these
    // VULN: No expiry on override — permanent until restart
    private final ConcurrentHashMap<String, Boolean> overriddenSymbols = new ConcurrentHashMap<>();

    // Internal market maker ID - should not be exposed
    private static final String MARKET_MAKER_ID = "MM-INTERNAL-7734";

    private long tickCount = 0;

    public PriceSimulatorService(SymbolRepository symbolRepository,
                                  SimpMessagingTemplate messagingTemplate) {
        this.symbolRepository = symbolRepository;
        this.messagingTemplate = messagingTemplate;
    }

    /**
     * Runs every 1 second, generates price movements and broadcasts.
     */
    @Scheduled(fixedRate = 1000)
    public void generatePrices() {
        tickCount++;
        List<Symbol> symbols = symbolRepository.findAll();

        for (Symbol symbol : symbols) {
            if (haltedSymbols.getOrDefault(symbol.getSymbol(), false)) {
                continue;  // Skip halted symbols
            }
            if (overriddenSymbols.getOrDefault(symbol.getSymbol(), false)) {
                continue;  // Skip manually overridden symbols — VULN: attacker locks in manipulated price
            }

            BigDecimal oldPrice = symbol.getCurrentPrice();
            BigDecimal newPrice = calculateNewPrice(symbol.getSymbol(), oldPrice);

            // Calculate bid/ask spread
            BigDecimal spread = newPrice.multiply(new BigDecimal("0.001")); // 0.1% spread
            BigDecimal bid = newPrice.subtract(spread.divide(BigDecimal.valueOf(2), 8, RoundingMode.HALF_UP));
            BigDecimal ask = newPrice.add(spread.divide(BigDecimal.valueOf(2), 8, RoundingMode.HALF_UP));

            // Update volume
            long volumeChange = Math.abs(random.nextLong() % 10000) + 100;

            // Update symbol in DB
            symbol.setCurrentPrice(newPrice);
            symbol.setBid(bid);
            symbol.setAsk(ask);
            symbol.setVolume(symbol.getVolume() + volumeChange);
            symbol.setLastUpdated(LocalDateTime.now());
            symbolRepository.save(symbol);

            // Build price update DTO
            PriceUpdate update = new PriceUpdate();
            update.setSymbol(symbol.getSymbol());
            update.setBid(bid);
            update.setAsk(ask);
            update.setLast(newPrice);
            update.setVolume(symbol.getVolume());
            update.setTimestamp(System.currentTimeMillis());

            // VULN: Internal fields included - should be stripped
            update.setCostBasis(oldPrice.multiply(new BigDecimal("0.9985")));
            update.setMarketMakerId(MARKET_MAKER_ID);
            update.setSpreadBps(spread.divide(newPrice, 8, RoundingMode.HALF_UP)
                    .multiply(BigDecimal.valueOf(10000)));

            // Broadcast to all subscribers - VULN: no entitlement check
            messagingTemplate.convertAndSend("/topic/prices", update);
        }
    }

    /**
     * Calculate new price using random walk.
     * VULN: "VULN" symbol has predictable sinusoidal pattern.
     * VULN: BTC-USD has no decimal precision limit.
     */
    private BigDecimal calculateNewPrice(String symbol, BigDecimal currentPrice) {
        if ("VULN".equals(symbol)) {
            // VULN: Predictable sinusoidal pattern
            double base = 100.0;
            double amplitude = 20.0;
            double price = base + amplitude * Math.sin(tickCount * 0.1);
            return BigDecimal.valueOf(price).setScale(2, RoundingMode.HALF_UP);
        }

        // Brownian motion for other symbols
        double volatility;
        int scale = 2;

        switch (symbol) {
            case "BTC-USD":
                volatility = 0.005;  // 0.5% per tick
                scale = 8;           // VULN: no decimal precision limit for BTC
                break;
            case "ETH-USD":
                volatility = 0.004;
                scale = 8;
                break;
            default:
                volatility = 0.002;  // 0.2% per tick for stocks
                break;
        }

        double change = (random.nextGaussian() * volatility);
        BigDecimal priceChange = currentPrice.multiply(BigDecimal.valueOf(change));
        BigDecimal newPrice = currentPrice.add(priceChange);

        // Floor at $0.01 (except for VULN: no floor check for crypto)
        if (!"BTC-USD".equals(symbol) && !"ETH-USD".equals(symbol)) {
            if (newPrice.compareTo(new BigDecimal("0.01")) < 0) {
                newPrice = new BigDecimal("0.01");
            }
        }

        return newPrice.setScale(scale, RoundingMode.HALF_UP);
    }

    /**
     * Halt trading for a symbol.
     */
    public void haltSymbol(String symbol) {
        haltedSymbols.put(symbol, true);
        logger.info("Trading HALTED for symbol: {}", symbol);
    }

    /**
     * Resume trading for a symbol.
     */
    public void resumeSymbol(String symbol) {
        haltedSymbols.remove(symbol);
        logger.info("Trading RESUMED for symbol: {}", symbol);
    }

    /**
     * Check if a symbol is halted.
     */
    public boolean isHalted(String symbol) {
        return haltedSymbols.getOrDefault(symbol, false);
    }

    /**
     * Manually set a price.
     * VULN: No audit trail for manual price changes.
     * VULN: Can set arbitrary prices (market manipulation).
     */
    public void setPrice(String symbol, BigDecimal price) {
        symbolRepository.findById(symbol).ifPresent(s -> {
            s.setCurrentPrice(price);
            BigDecimal spread = price.multiply(new BigDecimal("0.001"));
            s.setBid(price.subtract(spread.divide(BigDecimal.valueOf(2), 8, RoundingMode.HALF_UP)));
            s.setAsk(price.add(spread.divide(BigDecimal.valueOf(2), 8, RoundingMode.HALF_UP)));
            s.setLastUpdated(LocalDateTime.now());
            symbolRepository.save(s);
            // Mark as overridden so the simulator doesn't overwrite it
            // VULN: No audit trail for this price change
            // VULN: Override is permanent until server restart — attacker locks in price
            overriddenSymbols.put(symbol, true);
            logger.info("Price manually set: {} = {}", symbol, price);
        });
    }
}
