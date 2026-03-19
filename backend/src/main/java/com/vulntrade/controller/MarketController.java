package com.vulntrade.controller;

import com.vulntrade.model.Symbol;
import com.vulntrade.repository.SymbolRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/market")
public class MarketController {

    private final SymbolRepository symbolRepository;

    public MarketController(SymbolRepository symbolRepository) {
        this.symbolRepository = symbolRepository;
    }

    /**
     * Get all current prices - public endpoint.
     */
    @GetMapping("/prices")
    public ResponseEntity<List<Symbol>> getPrices() {
        return ResponseEntity.ok(symbolRepository.findAll());
    }

    /**
     * Get price for specific symbol.
     * VULN: Path traversal in symbol parameter (in later phase).
     */
    @GetMapping("/prices/{symbol}")
    public ResponseEntity<?> getPrice(@PathVariable String symbol) {
        return symbolRepository.findById(symbol)
                .map(s -> ResponseEntity.ok((Object) s))
                .orElse(ResponseEntity.notFound().build());
    }
}
