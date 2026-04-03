package com.vulntrade.controller;

import com.vulntrade.model.Position;
import com.vulntrade.model.Transaction;
import com.vulntrade.model.User;
import com.vulntrade.repository.PositionRepository;
import com.vulntrade.repository.SymbolRepository;
import com.vulntrade.repository.TransactionRepository;
import com.vulntrade.repository.UserRepository;
import io.jsonwebtoken.Claims;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Leaderboard endpoint — ranks traders by ROI%.
 *
 * VULN: notes field included in response (leaks FLAGs)
 * VULN: ?userId=X IDOR — look up any user's stats without ownership check
 * VULN: #1 flag reveals market manipulation is possible
 */
@RestController
@RequestMapping("/api/leaderboard")
public class LeaderboardController {

    private static final String LEADERBOARD_FLAG = "FLAG{m4rk3t_m4n1pul4t0r_numb3r_0n3}";

    private final UserRepository userRepository;
    private final PositionRepository positionRepository;
    private final SymbolRepository symbolRepository;
    private final TransactionRepository transactionRepository;

    public LeaderboardController(UserRepository userRepository,
                                  PositionRepository positionRepository,
                                  SymbolRepository symbolRepository,
                                  TransactionRepository transactionRepository) {
        this.userRepository = userRepository;
        this.positionRepository = positionRepository;
        this.symbolRepository = symbolRepository;
        this.transactionRepository = transactionRepository;
    }

    @GetMapping
    public ResponseEntity<?> getLeaderboard(
            @RequestParam(required = false) Long userId) {

        // VULN: IDOR — if userId provided, return that single user's stats
        if (userId != null) {
            Optional<User> userOpt = userRepository.findById(userId);
            if (userOpt.isEmpty()) {
                return ResponseEntity.notFound().build();
            }
            Map<String, Object> stats = computeTraderStats(userOpt.get());
            if (stats == null) return ResponseEntity.notFound().build();
            stats.put("rank", 0);
            return ResponseEntity.ok(stats);
        }

        // Get ALL users with deposits (not just TRADER role — includes newly registered users)
        List<User> allUsers = userRepository.findAll().stream()
                .filter(u -> Boolean.TRUE.equals(u.getIsActive()))
                .filter(u -> !"ADMIN".equals(u.getRole()))  // exclude the house/admin account
                .collect(Collectors.toList());

        // Compute stats for each
        List<Map<String, Object>> leaderboard = new ArrayList<>();
        for (User trader : allUsers) {
            Map<String, Object> stats = computeTraderStats(trader);
            if (stats != null) {
                leaderboard.add(stats);
            }
        }

        // Sort by ROI descending
        leaderboard.sort((a, b) -> {
            double roiA = ((Number) a.get("roi")).doubleValue();
            double roiB = ((Number) b.get("roi")).doubleValue();
            return Double.compare(roiB, roiA);
        });

        // Assign ranks to all
        for (int i = 0; i < leaderboard.size(); i++) {
            leaderboard.get(i).put("rank", i + 1);
        }

        // Take top 10 for display
        List<Map<String, Object>> top10 = leaderboard.stream()
                .limit(10)
                .collect(Collectors.toList());

        // Check if authenticated user is #1
        Long myUserId = getAuthenticatedUserId();
        int myRank = 0;
        for (int i = 0; i < leaderboard.size(); i++) {
            Object entryUid = leaderboard.get(i).get("userId");
            if (entryUid != null && entryUid.equals(myUserId)) {
                myRank = i + 1;
                break;
            }
        }

        // Build response wrapper
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("leaderboard", top10);
        response.put("myRank", myRank);

        if (myRank == 1) {
            response.put("flag", LEADERBOARD_FLAG);
        } else {
            response.put("flag", null);
            response.put("flagHint", "Reach #1 to unlock. Think about what prices you can control...");
        }

        return ResponseEntity.ok(response);
    }

    /**
     * Trader detail — per-symbol breakdown with P&L progression.
     * VULN: IDOR — any authenticated user can look up any trader's detail.
     */
    @GetMapping("/{targetUserId}/detail")
    public ResponseEntity<?> getTraderDetail(@PathVariable Long targetUserId) {
        Optional<User> userOpt = userRepository.findById(targetUserId);
        if (userOpt.isEmpty()) return ResponseEntity.notFound().build();

        User user = userOpt.get();
        List<Transaction> transactions = transactionRepository.findByUserId(targetUserId);
        List<Transaction> tradeTxns = transactions.stream()
                .filter(t -> t.getType() != null && t.getType().startsWith("TRADE_"))
                .sorted(Comparator.comparing(Transaction::getCreatedAt))
                .collect(Collectors.toList());

        // Build per-symbol breakdown
        Map<String, SymbolDetail> symbolDetails = new LinkedHashMap<>();

        for (Transaction tx : tradeTxns) {
            String desc = tx.getDescription();
            if (desc == null) continue;

            try {
                String[] parts = desc.split("\\s+");
                if (parts.length < 5) continue;
                String side = parts[0];
                BigDecimal qty = new BigDecimal(parts[1]);
                String symbol = parts[2];
                BigDecimal price = new BigDecimal(parts[4]);

                SymbolDetail sd = symbolDetails.computeIfAbsent(symbol, k -> new SymbolDetail());
                sd.tradeCount++;

                if ("BUY".equals(side)) {
                    sd.totalBoughtQty = sd.totalBoughtQty.add(qty);
                    sd.totalBoughtCost = sd.totalBoughtCost.add(qty.multiply(price));
                } else {
                    sd.totalSoldQty = sd.totalSoldQty.add(qty);
                    sd.totalSoldRevenue = sd.totalSoldRevenue.add(qty.multiply(price));
                    // Calculate realized P&L on this sell
                    if (sd.totalBoughtQty.compareTo(BigDecimal.ZERO) > 0) {
                        BigDecimal avgBuy = sd.totalBoughtCost.divide(sd.totalBoughtQty, 8, RoundingMode.HALF_UP);
                        BigDecimal pnl = qty.multiply(price.subtract(avgBuy));
                        sd.realizedPnl = sd.realizedPnl.add(pnl);
                    }
                }

                // Track cumulative P&L progression for sparkline
                sd.pnlProgression.add(sd.realizedPnl.setScale(2, RoundingMode.HALF_UP).doubleValue());
            } catch (Exception e) {
                // skip
            }
        }

        // Get current positions for unrealized P&L
        List<Position> positions = positionRepository.findByUserId(targetUserId);
        Map<String, Position> posMap = positions.stream()
                .collect(Collectors.toMap(Position::getSymbol, p -> p, (a, b) -> a));

        // Build response
        List<Map<String, Object>> symbols = new ArrayList<>();
        for (Map.Entry<String, SymbolDetail> entry : symbolDetails.entrySet()) {
            String sym = entry.getKey();
            SymbolDetail sd = entry.getValue();
            Position pos = posMap.get(sym);

            Map<String, Object> symMap = new LinkedHashMap<>();
            symMap.put("symbol", sym);
            symMap.put("tradeCount", sd.tradeCount);
            symMap.put("totalBought", sd.totalBoughtQty);
            symMap.put("totalSold", sd.totalSoldQty);
            symMap.put("netPosition", sd.totalBoughtQty.subtract(sd.totalSoldQty));
            symMap.put("avgBuyPrice", sd.totalBoughtQty.compareTo(BigDecimal.ZERO) > 0
                    ? sd.totalBoughtCost.divide(sd.totalBoughtQty, 2, RoundingMode.HALF_UP)
                    : BigDecimal.ZERO);
            symMap.put("realizedPnl", sd.realizedPnl.setScale(2, RoundingMode.HALF_UP));

            // Current price + unrealized P&L
            symbolRepository.findById(sym).ifPresent(s -> {
                symMap.put("currentPrice", s.getCurrentPrice());
                if (pos != null) {
                    BigDecimal unrealized = s.getCurrentPrice().subtract(pos.getAvgPrice())
                            .multiply(pos.getQuantity()).setScale(2, RoundingMode.HALF_UP);
                    symMap.put("unrealizedPnl", unrealized);
                }
            });

            symMap.put("pnlProgression", sd.pnlProgression);
            symbols.add(symMap);
        }

        // Sort by trade count descending
        symbols.sort((a, b) -> Integer.compare((int) b.get("tradeCount"), (int) a.get("tradeCount")));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("userId", targetUserId);
        result.put("username", user.getUsername());
        result.put("firstName", user.getFirstName());
        result.put("lastName", user.getLastName());
        result.put("symbols", symbols);
        // VULN: notes leak
        result.put("notes", user.getNotes());

        return ResponseEntity.ok(result);
    }

    // ================================================================
    // Helpers
    // ================================================================

    private Long getAuthenticatedUserId() {
        try {
            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth != null && auth.getDetails() instanceof Claims) {
                Claims claims = (Claims) auth.getDetails();
                Object uid = claims.get("userId");
                if (uid instanceof Integer) return ((Integer) uid).longValue();
                if (uid instanceof Long) return (Long) uid;
            }
        } catch (Exception e) {
            // ignore
        }
        return null;
    }

    private Map<String, Object> computeTraderStats(User user) {
        Long uid = user.getId();
        List<Transaction> transactions = transactionRepository.findByUserId(uid);

        // Find starting capital (first DEPOSIT)
        BigDecimal startingCapital = transactions.stream()
                .filter(t -> "DEPOSIT".equals(t.getType()))
                .sorted(Comparator.comparing(Transaction::getCreatedAt))
                .map(Transaction::getAmount)
                .findFirst()
                .orElse(null);

        if (startingCapital == null || startingCapital.compareTo(BigDecimal.ZERO) <= 0) {
            return null;
        }

        BigDecimal currentCash = user.getBalance() != null ? user.getBalance() : BigDecimal.ZERO;

        List<Position> positions = positionRepository.findByUserId(uid);
        BigDecimal positionsValue = BigDecimal.ZERO;
        for (Position pos : positions) {
            var symOpt = symbolRepository.findById(pos.getSymbol());
            if (symOpt.isPresent()) {
                BigDecimal marketVal = pos.getQuantity().multiply(symOpt.get().getCurrentPrice());
                positionsValue = positionsValue.add(marketVal);
            }
        }

        BigDecimal portfolioValue = currentCash.add(positionsValue);
        BigDecimal roi = portfolioValue.subtract(startingCapital)
                .divide(startingCapital, 6, RoundingMode.HALF_UP)
                .multiply(new BigDecimal("100"))
                .setScale(2, RoundingMode.HALF_UP);

        List<Transaction> tradeTxns = transactions.stream()
                .filter(t -> t.getType() != null && t.getType().startsWith("TRADE_"))
                .collect(Collectors.toList());
        int tradeCount = tradeTxns.size();

        Map<String, BigDecimal> symbolTotalCost = new HashMap<>();
        Map<String, BigDecimal> symbolTotalQty = new HashMap<>();
        Map<String, Integer> symbolTradeCount = new HashMap<>();
        int wins = 0;
        int totalSells = 0;

        tradeTxns.sort(Comparator.comparing(Transaction::getCreatedAt));

        for (Transaction tx : tradeTxns) {
            String desc = tx.getDescription();
            if (desc == null) continue;

            try {
                String[] parts = desc.split("\\s+");
                if (parts.length < 5) continue;
                String side = parts[0];
                BigDecimal qty = new BigDecimal(parts[1]);
                String symbol = parts[2];
                BigDecimal price = new BigDecimal(parts[4]);

                symbolTradeCount.merge(symbol, 1, Integer::sum);

                if ("BUY".equals(side)) {
                    symbolTotalCost.merge(symbol, qty.multiply(price), BigDecimal::add);
                    symbolTotalQty.merge(symbol, qty, BigDecimal::add);
                } else if ("SELL".equals(side)) {
                    totalSells++;
                    BigDecimal avgBuy = BigDecimal.ZERO;
                    BigDecimal totQty = symbolTotalQty.getOrDefault(symbol, BigDecimal.ZERO);
                    BigDecimal totCost = symbolTotalCost.getOrDefault(symbol, BigDecimal.ZERO);
                    if (totQty.compareTo(BigDecimal.ZERO) > 0) {
                        avgBuy = totCost.divide(totQty, 8, RoundingMode.HALF_UP);
                    }
                    if (price.compareTo(avgBuy) > 0) {
                        wins++;
                    }
                    if (totQty.compareTo(BigDecimal.ZERO) > 0) {
                        BigDecimal costReduction = qty.min(totQty).multiply(avgBuy);
                        symbolTotalCost.put(symbol, totCost.subtract(costReduction));
                        symbolTotalQty.put(symbol, totQty.subtract(qty));
                    }
                }
            } catch (Exception e) {
                // skip
            }
        }

        double winRate = totalSells > 0 ? (wins * 100.0 / totalSells) : 0.0;

        String topSymbol = symbolTradeCount.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey)
                .orElse("N/A");

        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("userId", uid);
        stats.put("username", user.getUsername());
        stats.put("firstName", user.getFirstName());
        stats.put("lastName", user.getLastName());
        stats.put("profilePic", user.getProfilePic());
        stats.put("roi", roi.doubleValue());
        stats.put("tradeCount", tradeCount);
        stats.put("winRate", Math.round(winRate * 10.0) / 10.0);
        stats.put("portfolioValue", portfolioValue.setScale(2, RoundingMode.HALF_UP));
        stats.put("topSymbol", topSymbol);
        stats.put("notes", user.getNotes());

        return stats;
    }

    /** Mutable accumulator for per-symbol trade breakdown. */
    private static class SymbolDetail {
        int tradeCount = 0;
        BigDecimal totalBoughtQty = BigDecimal.ZERO;
        BigDecimal totalBoughtCost = BigDecimal.ZERO;
        BigDecimal totalSoldQty = BigDecimal.ZERO;
        BigDecimal totalSoldRevenue = BigDecimal.ZERO;
        BigDecimal realizedPnl = BigDecimal.ZERO;
        List<Double> pnlProgression = new ArrayList<>();
    }
}
