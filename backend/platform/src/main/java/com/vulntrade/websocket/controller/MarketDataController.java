package com.vulntrade.websocket.controller;

import com.vulntrade.model.Symbol;
import com.vulntrade.repository.SymbolRepository;
import com.vulntrade.service.MatchingEngineService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * STOMP controller for market data requests.
 * The main price feed is published by PriceSimulatorService on a schedule.
 * This controller handles on-demand market data requests.
 */
@Controller
public class MarketDataController {

    private static final Logger logger = LoggerFactory.getLogger(MarketDataController.class);

    private final SymbolRepository symbolRepository;
    private final MatchingEngineService matchingEngine;
    private final SimpMessagingTemplate messagingTemplate;

    public MarketDataController(SymbolRepository symbolRepository,
                                 MatchingEngineService matchingEngine,
                                 SimpMessagingTemplate messagingTemplate) {
        this.symbolRepository = symbolRepository;
        this.matchingEngine = matchingEngine;
        this.messagingTemplate = messagingTemplate;
    }

    /**
     * /app/market.getSymbols
     * Returns all available symbols.
     * VULN: No entitlement check - all users get all symbols.
     */
    @MessageMapping("/market.getSymbols")
    public void getSymbols(SimpMessageHeaderAccessor headerAccessor) {
        List<Symbol> symbols = symbolRepository.findAll();

        // Convert to maps with extra internal data
        List<Map<String, Object>> symbolList = symbols.stream().map(s -> {
            Map<String, Object> map = new HashMap<>();
            map.put("symbol", s.getSymbol());
            map.put("name", s.getName());
            map.put("currentPrice", s.getCurrentPrice());
            map.put("bid", s.getBid());
            map.put("ask", s.getAsk());
            map.put("volume", s.getVolume());
            map.put("isTradable", s.getIsTradable());
            map.put("lastUpdated", s.getLastUpdated());
            return map;
        }).collect(Collectors.toList());

        Map<String, Object> response = new HashMap<>();
        response.put("type", "SYMBOLS");
        response.put("symbols", symbolList);

        // Send to requesting user
        if (headerAccessor.getUser() != null) {
            messagingTemplate.convertAndSendToUser(
                    headerAccessor.getUser().getName(),
                    "/queue/market", response);
        }
    }

    /**
     * /app/market.getOrderBook
     * Returns order book for a specific symbol.
     * VULN: Shows all pending orders (front-running possible).
     * VULN: Includes orderer's userId (information disclosure).
     */
    @MessageMapping("/market.getOrderBook")
    public void getOrderBook(@Payload Map<String, String> request,
                              SimpMessageHeaderAccessor headerAccessor) {
        String symbol = request.get("symbol");
        if (symbol != null) {
            matchingEngine.broadcastOrderBook(symbol);
        }
    }
}
