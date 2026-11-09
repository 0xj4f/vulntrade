package com.vulntrade.controller;

import com.vulntrade.model.Symbol;
import com.vulntrade.repository.SymbolRepository;
import com.vulntrade.service.CandleService;
import com.vulntrade.service.OrderBookService;
import com.vulntrade.service.PriceSimulatorService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/market")
public class MarketController {

    private final SymbolRepository symbolRepository;
    private final OrderBookService orderBookService;
    private final CandleService candleService;
    private final PriceSimulatorService priceSimulator;

    public MarketController(SymbolRepository symbolRepository,
                            OrderBookService orderBookService,
                            CandleService candleService,
                            PriceSimulatorService priceSimulator) {
        this.symbolRepository = symbolRepository;
        this.orderBookService = orderBookService;
        this.candleService = candleService;
        this.priceSimulator = priceSimulator;
    }

    /**
     * Get all current prices - public endpoint.
     * Each symbol also carries the session open and the % change since then.
     */
    @GetMapping("/prices")
    public ResponseEntity<List<Symbol>> getPrices() {
        List<Symbol> symbols = symbolRepository.findAll();
        symbols.forEach(this::withSessionChange);
        return ResponseEntity.ok(symbols);
    }

    /**
     * Get price for specific symbol.
     * VULN: Path traversal in symbol parameter.
     */
    @GetMapping("/prices/{symbol}")
    public ResponseEntity<?> getPrice(@PathVariable String symbol) {
        return symbolRepository.findById(symbol)
                .map(s -> ResponseEntity.ok((Object) withSessionChange(s)))
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Get order book for a symbol: every open LIMIT order (remaining quantity), best price
     * first, plus an aggregated per-price {@code levels} view for depth bars.
     * VULN: Exposes orderId, userId and username of each order (front-running, IDOR cancel).
     * VULN: Path traversal in symbol parameter.
     */
    @GetMapping("/orderbook/{symbol}")
    public ResponseEntity<?> getOrderBook(@PathVariable String symbol) {
        // VULN: symbol not sanitized
        OrderBookService.Book book = orderBookService.snapshot(symbol);

        Map<String, Object> orderBook = new LinkedHashMap<>();
        orderBook.put("symbol", symbol);
        orderBook.put("bids", book.bids.stream().map(MarketController::restEntry).collect(Collectors.toList()));
        orderBook.put("asks", book.asks.stream().map(MarketController::restEntry).collect(Collectors.toList()));
        orderBook.put("levels", book.levels());
        orderBook.put("bidCount", book.bids.size());
        orderBook.put("askCount", book.asks.size());
        orderBook.put("timestamp", System.currentTimeMillis());
        return ResponseEntity.ok(orderBook);
    }

    /**
     * OHLC candles for charts: {@code ?symbol=AAPL&interval=1m|5m|15m|1h&limit=300}.
     * Shape matches lightweight-charts: {time (epoch seconds), open, high, low, close, volume}.
     */
    @GetMapping("/candles")
    public ResponseEntity<?> getCandles(@RequestParam String symbol,
                                        @RequestParam(defaultValue = "1m") String interval,
                                        @RequestParam(defaultValue = "300") int limit) {
        if (!CandleService.isValidInterval(interval)) {
            return ResponseEntity.badRequest().body(Map.of("error", "interval must be one of 1m, 5m, 15m, 1h"));
        }
        if (!symbolRepository.existsById(symbol)) {
            return ResponseEntity.status(404).body(Map.of("error", "Unknown symbol: " + symbol));
        }
        int capped = Math.max(1, Math.min(limit, 1000));
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("symbol", symbol);
        body.put("interval", interval);
        body.put("candles", candleService.candles(symbol, interval, capped));
        return ResponseEntity.ok(body);
    }

    private Symbol withSessionChange(Symbol s) {
        BigDecimal open = priceSimulator.getOpenPrices().get(s.getSymbol());
        if (open != null && open.signum() > 0 && s.getCurrentPrice() != null) {
            s.setOpenPrice(open);
            s.setChangePct(s.getCurrentPrice().subtract(open).divide(open, 8, RoundingMode.HALF_UP)
                    .multiply(BigDecimal.valueOf(100)).setScale(4, RoundingMode.HALF_UP));
        }
        return s;
    }

    /** REST shape of a book entry (kept from earlier releases, plus originalQuantity). */
    private static Map<String, Object> restEntry(com.vulntrade.model.dto.OrderBookEntry e) {
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("orderId", e.getOrderId());            // VULN: order ID exposed
        entry.put("userId", e.getUserId());              // VULN: user ID exposed
        entry.put("price", e.getPrice());
        entry.put("quantity", e.getQuantity());          // remaining
        entry.put("originalQuantity", e.getOriginalQuantity());
        entry.put("clientOrderId", e.getClientOrderId());
        entry.put("createdAt", e.getCreatedAt());
        entry.put("username", e.getUsername());          // VULN: username exposed
        return entry;
    }
}
