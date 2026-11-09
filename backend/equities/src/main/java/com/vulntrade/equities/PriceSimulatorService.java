package com.vulntrade.equities;

import com.vulntrade.model.Symbol;
import com.vulntrade.model.dto.PriceUpdate;
import com.vulntrade.repository.SymbolRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.vulntrade.events.EventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Price simulation engine for the stock exchange (EQUITY symbols only).
 * Generates price movements (random walk) and publishes them, through Redis and equities-gateway,
 * to /topic/equities/prices. The platform listens to the same ticks for price alerts.
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

    private static final BigDecimal CRYPTO_FLOOR = new BigDecimal("0.00000001");
    private static final BigDecimal STOCK_FLOOR = new BigDecimal("0.01");

    private final SymbolRepository symbolRepository;
    private final EventPublisher events;
    private final CandleService candleService;

    // VULN: Fixed seed makes prices predictable
    private final Random random = new Random(42);

    // Track halted symbols
    private final ConcurrentHashMap<String, Boolean> haltedSymbols = new ConcurrentHashMap<>();

    // Track manually overridden symbols — simulator skips these
    // VULN: No expiry on override — permanent until restart
    private final ConcurrentHashMap<String, Boolean> overriddenSymbols = new ConcurrentHashMap<>();

    // Session open (first price seen since start) — for change %.
    private final ConcurrentHashMap<String, BigDecimal> openPrices = new ConcurrentHashMap<>();

    // One monitor per symbol, shared by the tick and setPrice, so a tick can't overwrite a
    // manual price that was set while it was running.
    private final ConcurrentHashMap<String, Object> symbolLocks = new ConcurrentHashMap<>();

    // Internal market maker ID - should not be exposed
    private static final String MARKET_MAKER_ID = "MM-INTERNAL-7734";

    private volatile long tickCount = 0;

    public PriceSimulatorService(SymbolRepository symbolRepository,
                                 EventPublisher events,
                                 CandleService candleService) {
        this.symbolRepository = symbolRepository;
        this.events = events;
        this.candleService = candleService;
    }

    /**
     * Runs every 1 second, generates price movements and broadcasts.
     */
    @Scheduled(fixedRate = 1000)
    public void generatePrices() {
        tickCount++;
        List<Symbol> symbols = symbolRepository.findAll();

        for (Symbol symbol : symbols) {
            String name = symbol.getSymbol();
            if (!"EQUITY".equals(symbol.getAssetClass())) {
                continue;  // 1.0.0: crypto and FX prices belong to their own services
            }
            synchronized (lockFor(name)) {
                if (haltedSymbols.getOrDefault(name, false)) {
                    continue;  // Skip halted symbols
                }
                if (overriddenSymbols.getOrDefault(name, false)) {
                    continue;  // Skip manually overridden symbols — VULN: attacker locks in manipulated price
                }

                BigDecimal oldPrice = symbol.getCurrentPrice();
                openPrices.putIfAbsent(name, oldPrice);
                BigDecimal newPrice = calculateNewPrice(name, oldPrice);

                // Update volume
                long volumeChange = Math.abs(random.nextLong() % 10000) + 100;

                applyQuote(symbol, newPrice);
                symbol.setVolume(symbol.getVolume() + volumeChange);
                symbolRepository.save(symbol);

                publish(symbol, oldPrice, volumeChange);
            }
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

        // Brownian motion for other symbols. Per-tick (1 s) volatility, calibrated so an hour
        // moves stocks ~2.4% and BTC ~5% (one sigma) — lively on a 1-minute chart without the
        // 10-30%/hour swings of earlier builds. The fixed-seed draw sequence is unchanged.
        double volatility = volatilityPerTick(symbol);

        double change = (random.nextGaussian() * volatility);
        BigDecimal priceChange = currentPrice.multiply(BigDecimal.valueOf(change));
        BigDecimal newPrice = currentPrice.add(priceChange);

        // Crypto pairs (*-USD) trade to 8 decimals — sub-cent coins (DOGE, XRP, PEPE) must
        // keep their precision. Stocks trade in cents with a $0.01 floor.
        if (isCrypto(symbol)) {
            if (newPrice.compareTo(CRYPTO_FLOOR) < 0) newPrice = CRYPTO_FLOOR;
            return newPrice.setScale(8, RoundingMode.HALF_UP);
        }
        if (newPrice.compareTo(STOCK_FLOOR) < 0) newPrice = STOCK_FLOOR;
        return newPrice.setScale(2, RoundingMode.HALF_UP);
    }

    /** One-second volatility per symbol (also used to back-fill candle history). */
    public static double volatilityPerTick(String symbol) {
        switch (symbol) {
            case "BTC-USD": return 0.0008;   // VULN: no decimal precision limit for BTC
            case "ETH-USD": return 0.0007;
            default:
                return symbol != null && symbol.endsWith("-USD") ? 0.0006 : 0.0004;
        }
    }

    private static boolean isCrypto(String symbol) {
        return symbol != null && symbol.endsWith("-USD");
    }

    /** Set last/bid/ask (0.1% spread around the price). */
    private void applyQuote(Symbol s, BigDecimal price) {
        BigDecimal half = price.multiply(new BigDecimal("0.001")).divide(BigDecimal.valueOf(2), 8, RoundingMode.HALF_UP);
        s.setCurrentPrice(price);
        s.setBid(price.subtract(half));
        s.setAsk(price.add(half));
        s.setLastUpdated(LocalDateTime.now(ZoneOffset.UTC));
    }

    /** Broadcast a PriceUpdate, fire crossed alerts, feed the candles. */
    private void publish(Symbol symbol, BigDecimal oldPrice, long volumeChange) {
        BigDecimal price = symbol.getCurrentPrice();
        long now = System.currentTimeMillis();

        PriceUpdate update = new PriceUpdate();
        update.setSymbol(symbol.getSymbol());
        update.setBid(symbol.getBid());
        update.setAsk(symbol.getAsk());
        update.setLast(price);
        update.setVolume(symbol.getVolume());
        update.setTimestamp(now);

        BigDecimal open = openPrices.getOrDefault(symbol.getSymbol(), oldPrice);
        update.setOpen(open);
        if (open != null && open.signum() > 0) {
            update.setChangePct(price.subtract(open).divide(open, 8, RoundingMode.HALF_UP)
                    .multiply(BigDecimal.valueOf(100)).setScale(4, RoundingMode.HALF_UP));
        }

        // VULN: Internal fields included - should be stripped
        BigDecimal basis = oldPrice != null ? oldPrice : price;
        update.setCostBasis(basis.multiply(new BigDecimal("0.9985")));
        update.setMarketMakerId(MARKET_MAKER_ID);
        if (price.signum() > 0) {
            update.setSpreadBps(symbol.getAsk().subtract(symbol.getBid())
                    .divide(price, 8, RoundingMode.HALF_UP)
                    .multiply(BigDecimal.valueOf(10000)));
        }

        // Broadcast to all subscribers - VULN: no entitlement check.
        // (The platform also hears this tick and fires price alerts - the stored-XSS sink #54.)
        events.toAll("equities", "/topic/equities/prices", update);

        candleService.onTick(symbol.getSymbol(), price, volumeChange, now, tickCount);
    }

    private Object lockFor(String symbol) {
        return symbolLocks.computeIfAbsent(symbol, s -> new Object());
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
        return symbol != null && haltedSymbols.getOrDefault(symbol, false);
    }

    public boolean isOverridden(String symbol) {
        return symbol != null && overriddenSymbols.getOrDefault(symbol, false);
    }

    /** Session open price per symbol (first price seen since the backend started). */
    public Map<String, BigDecimal> getOpenPrices() {
        return openPrices;
    }

    public long getTickCount() {
        return tickCount;
    }

    /**
     * Manually set a price, and publish it like a tick (feed, alerts, candles).
     * VULN: No authorization in the STOMP handler, no audit trail, arbitrary prices
     *       (market manipulation, #58). Only non-positive prices are refused.
     * VULN: Override is permanent until restart — the simulator stops moving the symbol.
     */
    public void setPrice(String symbol, BigDecimal price) {
        if (price == null || price.signum() <= 0) {
            throw new IllegalArgumentException("Price must be greater than 0");
        }
        synchronized (lockFor(symbol)) {
            Symbol s = symbolRepository.findById(symbol)
                    .orElseThrow(() -> new IllegalArgumentException("Unknown symbol: " + symbol));
            // Flag first, so a tick that loaded the old row skips this symbol.
            overriddenSymbols.put(symbol, true);
            BigDecimal oldPrice = s.getCurrentPrice();
            openPrices.putIfAbsent(symbol, oldPrice);
            applyQuote(s, price);
            symbolRepository.save(s);
            logger.info("Price manually set: {} = {}", symbol, price);
            publish(s, oldPrice, 0);
        }
    }
}
