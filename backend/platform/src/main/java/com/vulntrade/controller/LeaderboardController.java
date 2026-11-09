package com.vulntrade.controller;

import com.vulntrade.model.Position;
import com.vulntrade.model.Symbol;
import com.vulntrade.model.Trade;
import com.vulntrade.model.Transaction;
import com.vulntrade.model.User;
import com.vulntrade.money.UsdValue;
import com.vulntrade.repository.PositionRepository;
import com.vulntrade.repository.SymbolRepository;
import com.vulntrade.repository.TradeRepository;
import com.vulntrade.repository.TransactionRepository;
import com.vulntrade.repository.UserRepository;
import com.vulntrade.security.logging.Outcome;
import com.vulntrade.security.logging.SecurityEvent;
import io.jsonwebtoken.Claims;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import java.util.stream.Collectors;

import static com.vulntrade.security.logging.SecurityEventLogger.*;

/**
 * Leaderboard endpoint — ranks traders by ROI%.
 *
 * ROI = (cash + market value of positions − capital) / capital, where cash is the MAIN account plus
 * every product account's money valued in USD (1.0.0), and capital is the net of
 * everything that is not a trade: deposits, withdrawals and admin adjustments. Trades are
 * read from the trades table (via each ledger row's reference id), and one chronological
 * moving-average-cost pass gives realized P&amp;L and win rate for both the list and the
 * per-trader detail.
 *
 * VULN: notes field included in response (leaks FLAGs)
 * VULN: ?userId=X IDOR — look up any user's stats without ownership check
 * VULN: #1 flag reveals market manipulation is possible (FLAG 11)
 */
@RestController
@RequestMapping("/api/leaderboard")
public class LeaderboardController {

    private static final String LEADERBOARD_FLAG = "FLAG{m4rk3t_m4n1pul4t0r_numb3r_0n3}";
    private static final BigDecimal HUNDRED = new BigDecimal("100");
    private static final int SERIES_POINTS = 24;

    private final UserRepository userRepository;
    private final PositionRepository positionRepository;
    private final SymbolRepository symbolRepository;
    private final TransactionRepository transactionRepository;
    private final TradeRepository tradeRepository;
    private final JdbcTemplate jdbc;

    @Value("${liquidity.house-user-id:1}")
    private Long houseUserId;

    public LeaderboardController(UserRepository userRepository,
                                 PositionRepository positionRepository,
                                 SymbolRepository symbolRepository,
                                 TransactionRepository transactionRepository,
                                 TradeRepository tradeRepository,
                                 JdbcTemplate jdbc) {
        this.jdbc = jdbc;
        this.userRepository = userRepository;
        this.positionRepository = positionRepository;
        this.symbolRepository = symbolRepository;
        this.transactionRepository = transactionRepository;
        this.tradeRepository = tradeRepository;
    }

    @GetMapping
    public ResponseEntity<?> getLeaderboard(@RequestParam(required = false) Long userId) {
        Snapshot snap = loadSnapshot();
        List<Map<String, Object>> ranked = rank(snap);

        // VULN: IDOR — if userId provided, return that single user's stats (with real rank)
        if (userId != null) {
            Optional<User> userOpt = userRepository.findById(userId);
            if (userOpt.isEmpty()) {
                return ResponseEntity.notFound().build();
            }
            Map<String, Object> stats = ranked.stream()
                    .filter(e -> userId.equals(e.get("userId")))
                    .findFirst()
                    .orElseGet(() -> {
                        Map<String, Object> s = computeTraderStats(userOpt.get(), snap);
                        if (s != null) s.put("rank", 0);   // not ranked (e.g. no capital)
                        return s;
                    });
            if (stats == null) return ResponseEntity.notFound().build();
            if (!isOwner(userId)) {
                log(SecurityEvent.SENSITIVE_DATA_READ, Outcome.SUCCESS,
                        details("resource", "trader_stats", "targetUserId", userId));
            }
            return ResponseEntity.ok(stats);
        }

        Long myUserId = getAuthenticatedUserId();
        int myRank = 0;
        Map<String, Object> myStats = null;
        for (Map<String, Object> entry : ranked) {
            if (myUserId != null && myUserId.equals(entry.get("userId"))) {
                myRank = (Integer) entry.get("rank");
                myStats = entry;
                break;
            }
        }

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("leaderboard", ranked.stream().limit(10).collect(Collectors.toList()));
        response.put("myRank", myRank);
        response.put("totalTraders", ranked.size());
        if (myStats != null) response.put("me", myStats);

        if (myRank == 1) {
            response.put("flag", LEADERBOARD_FLAG);
        } else {
            response.put("flag", null);
            response.put("flagHint", "Reach #1 to unlock. Think about what prices you can control...");
        }
        return ResponseEntity.ok(response);
    }

    /**
     * Trader detail — per-symbol breakdown with realized P&amp;L progression.
     * VULN: IDOR — any authenticated user can look up any trader's detail.
     */
    @GetMapping("/{targetUserId}/detail")
    public ResponseEntity<?> getTraderDetail(@PathVariable Long targetUserId) {
        Optional<User> userOpt = userRepository.findById(targetUserId);
        if (userOpt.isEmpty()) return ResponseEntity.notFound().build();
        User user = userOpt.get();

        Snapshot snap = loadSnapshot(Set.of(targetUserId));
        TraderBook book = analyze(snap.transactionsByUser.getOrDefault(targetUserId, List.of()), snap.trades);
        Map<String, Position> posMap = snap.positionsByUser.getOrDefault(targetUserId, List.of()).stream()
                .collect(Collectors.toMap(Position::getSymbol, p -> p, (a, b) -> a));

        List<Map<String, Object>> symbols = new ArrayList<>();
        for (Map.Entry<String, SymbolBook> entry : book.bySymbol.entrySet()) {
            String sym = entry.getKey();
            SymbolBook sb = entry.getValue();
            Position pos = posMap.get(sym);

            Map<String, Object> symMap = new LinkedHashMap<>();
            symMap.put("symbol", sym);
            symMap.put("tradeCount", sb.tradeCount);
            symMap.put("totalBought", sb.boughtQty);
            symMap.put("totalSold", sb.soldQty);
            symMap.put("netPosition", sb.qty);
            symMap.put("avgBuyPrice", sb.boughtQty.signum() > 0
                    ? sb.boughtCost.divide(sb.boughtQty, 8, RoundingMode.HALF_UP) : BigDecimal.ZERO);
            symMap.put("avgCost", sb.avgCost());
            symMap.put("realizedPnl", sb.realized.setScale(2, RoundingMode.HALF_UP));
            symMap.put("wins", sb.wins);
            symMap.put("sells", sb.sells);

            Symbol s = snap.symbols.get(sym);
            if (s != null) {
                symMap.put("currentPrice", s.getCurrentPrice());
                if (pos != null && pos.getQuantity() != null && pos.getQuantity().signum() > 0) {
                    symMap.put("unrealizedPnl", s.getCurrentPrice().subtract(pos.getAvgPrice())
                            .multiply(pos.getQuantity()).setScale(2, RoundingMode.HALF_UP));
                    symMap.put("marketValue", s.getCurrentPrice().multiply(pos.getQuantity())
                            .setScale(2, RoundingMode.HALF_UP));
                }
            }
            symMap.put("pnlProgression", sb.progression);
            symbols.add(symMap);
        }
        symbols.sort((a, b) -> Integer.compare((int) b.get("tradeCount"), (int) a.get("tradeCount")));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("userId", targetUserId);
        result.put("username", user.getUsername());
        result.put("firstName", user.getFirstName());
        result.put("lastName", user.getLastName());
        result.put("profilePic", user.getProfilePic());
        result.put("tradeCount", book.tradeCount);
        result.put("winRate", book.winRate());
        result.put("realizedPnl", book.realized.setScale(2, RoundingMode.HALF_UP));
        result.put("symbols", symbols);
        // VULN: notes leak
        result.put("notes", user.getNotes());
        return ResponseEntity.ok(result);
    }

    // ================================================================
    // Ranking
    // ================================================================

    private List<Map<String, Object>> rank(Snapshot snap) {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (User u : snap.users) {
            if (!Boolean.TRUE.equals(u.getIsActive())) continue;
            if ("ADMIN".equalsIgnoreCase(u.getRole()) || Objects.equals(u.getId(), houseUserId)) continue;
            Map<String, Object> stats = computeTraderStats(u, snap);
            if (stats != null) rows.add(stats);
        }
        rows.sort((a, b) -> Double.compare(((Number) b.get("roi")).doubleValue(), ((Number) a.get("roi")).doubleValue()));
        for (int i = 0; i < rows.size(); i++) rows.get(i).put("rank", i + 1);
        return rows;
    }

    /** Stats for one trader, or null when they have no positive capital (nothing to rank). */
    private Map<String, Object> computeTraderStats(User user, Snapshot snap) {
        Long uid = user.getId();
        List<Transaction> txns = snap.transactionsByUser.getOrDefault(uid, List.of());

        // Capital = net contributions: everything that isn't a trade (amounts are signed).
        BigDecimal capital = txns.stream()
                .filter(t -> t.getType() == null || !t.getType().startsWith("TRADE_"))
                .map(t -> t.getAmount() != null ? t.getAmount() : BigDecimal.ZERO)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        if (capital.signum() <= 0) return null;

        // Cash = MAIN (users.balance) + the product accounts (USD, coins, FX currencies) in USD
        BigDecimal cash = user.getBalance() != null ? user.getBalance() : BigDecimal.ZERO;
        for (Map.Entry<String, BigDecimal> b : snap.balancesByUser.getOrDefault(uid, Map.of()).entrySet()) {
            cash = cash.add(UsdValue.of(b.getKey(), b.getValue(), snap.prices));
        }
        BigDecimal positionsValue = BigDecimal.ZERO;
        for (Position pos : snap.positionsByUser.getOrDefault(uid, List.of())) {
            Symbol s = snap.symbols.get(pos.getSymbol());
            if (s != null && pos.getQuantity() != null) {
                positionsValue = positionsValue.add(pos.getQuantity().multiply(s.getCurrentPrice()));
            }
        }
        BigDecimal portfolioValue = cash.add(positionsValue);
        BigDecimal pnl = portfolioValue.subtract(capital);
        BigDecimal roi = pnl.divide(capital, 6, RoundingMode.HALF_UP).multiply(HUNDRED).setScale(2, RoundingMode.HALF_UP);

        TraderBook book = analyze(txns, snap.trades);

        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("userId", uid);
        stats.put("username", user.getUsername());
        stats.put("firstName", user.getFirstName());
        stats.put("lastName", user.getLastName());
        stats.put("profilePic", user.getProfilePic());
        stats.put("roi", roi.doubleValue());
        stats.put("tradeCount", book.tradeCount);
        stats.put("winRate", book.winRate());
        stats.put("portfolioValue", portfolioValue.setScale(2, RoundingMode.HALF_UP));
        stats.put("capital", capital.setScale(2, RoundingMode.HALF_UP));
        stats.put("pnl", pnl.setScale(2, RoundingMode.HALF_UP));
        stats.put("realizedPnl", book.realized.setScale(2, RoundingMode.HALF_UP));
        stats.put("cash", cash.setScale(2, RoundingMode.HALF_UP));
        stats.put("topSymbol", book.topSymbol());
        stats.put("pnlSeries", book.series());
        stats.put("notes", user.getNotes());   // VULN: notes leak (flags)
        return stats;
    }

    // ================================================================
    // Trade analysis
    // ================================================================

    private static final class SymbolBook {
        int tradeCount, wins, sells;
        BigDecimal qty = BigDecimal.ZERO, cost = BigDecimal.ZERO;
        BigDecimal boughtQty = BigDecimal.ZERO, boughtCost = BigDecimal.ZERO, soldQty = BigDecimal.ZERO;
        BigDecimal realized = BigDecimal.ZERO;
        final List<Double> progression = new ArrayList<>();

        BigDecimal avgCost() {
            return qty.signum() > 0 ? cost.divide(qty, 8, RoundingMode.HALF_UP) : BigDecimal.ZERO;
        }
    }

    private static final class TraderBook {
        final LinkedHashMap<String, SymbolBook> bySymbol = new LinkedHashMap<>();
        int tradeCount, wins, sells;
        BigDecimal realized = BigDecimal.ZERO;
        final List<Double> realizedSeries = new ArrayList<>();

        double winRate() {
            double rate = sells > 0 ? wins * 100.0 / sells : 0.0;
            return Math.round(rate * 10.0) / 10.0;
        }

        String topSymbol() {
            return bySymbol.entrySet().stream()
                    .max(Comparator.comparingInt(e -> e.getValue().tradeCount))
                    .map(Map.Entry::getKey).orElse("N/A");
        }

        List<Double> series() {
            if (realizedSeries.size() <= SERIES_POINTS) return realizedSeries;
            List<Double> out = new ArrayList<>();
            double step = (realizedSeries.size() - 1) / (double) (SERIES_POINTS - 1);
            for (int i = 0; i < SERIES_POINTS; i++) out.add(realizedSeries.get((int) Math.round(i * step)));
            return out;
        }
    }

    /**
     * One chronological pass over a trader's TRADE_BUY/TRADE_SELL ledger rows with a moving
     * average cost: buys raise the average, sells realize (price − average) × qty and count
     * as a win when the price beats the average. A wash trade (both rows of the same trade
     * belong to this trader) counts once and is ignored for cost, P&amp;L and wins.
     */
    private static TraderBook analyze(List<Transaction> txns, Map<Long, Trade> trades) {
        List<Transaction> tradeRows = txns.stream()
                .filter(t -> "TRADE_BUY".equals(t.getType()) || "TRADE_SELL".equals(t.getType()))
                .sorted(Comparator.comparing(Transaction::getCreatedAt, Comparator.nullsFirst(Comparator.naturalOrder()))
                        .thenComparing(Transaction::getId, Comparator.nullsFirst(Comparator.naturalOrder())))
                .collect(Collectors.toList());

        Map<String, Long> rowsPerRef = tradeRows.stream()
                .filter(t -> t.getReferenceId() != null)
                .collect(Collectors.groupingBy(Transaction::getReferenceId, Collectors.counting()));

        TraderBook book = new TraderBook();
        Set<String> selfTradesSeen = new HashSet<>();
        for (Transaction tx : tradeRows) {
            Fill fill = Fill.of(tx, trades);
            if (fill == null) continue;
            SymbolBook sb = book.bySymbol.computeIfAbsent(fill.symbol, k -> new SymbolBook());

            boolean selfTrade = tx.getReferenceId() != null && rowsPerRef.getOrDefault(tx.getReferenceId(), 0L) > 1;
            if (selfTrade) {
                if (selfTradesSeen.add(tx.getReferenceId())) {
                    sb.tradeCount++;
                    book.tradeCount++;
                }
                continue;
            }
            sb.tradeCount++;
            book.tradeCount++;

            if (fill.buy) {
                sb.qty = sb.qty.add(fill.qty);
                sb.cost = sb.cost.add(fill.qty.multiply(fill.price));
                sb.boughtQty = sb.boughtQty.add(fill.qty);
                sb.boughtCost = sb.boughtCost.add(fill.qty.multiply(fill.price));
            } else {
                BigDecimal avg = sb.avgCost();
                BigDecimal matched = fill.qty.min(sb.qty);
                BigDecimal pnl = fill.price.subtract(avg).multiply(matched);
                sb.realized = sb.realized.add(pnl);
                book.realized = book.realized.add(pnl);
                sb.cost = sb.cost.subtract(avg.multiply(matched));
                sb.qty = sb.qty.subtract(matched);
                if (sb.qty.signum() == 0) sb.cost = BigDecimal.ZERO;
                sb.soldQty = sb.soldQty.add(fill.qty);
                sb.sells++;
                book.sells++;
                if (matched.signum() > 0 && fill.price.compareTo(avg) > 0) {
                    sb.wins++;
                    book.wins++;
                }
            }
            sb.progression.add(sb.realized.setScale(2, RoundingMode.HALF_UP).doubleValue());
            book.realizedSeries.add(book.realized.setScale(2, RoundingMode.HALF_UP).doubleValue());
        }
        return book;
    }

    /** One side of one trade, from the trades table (or, failing that, the ledger text). */
    private static final class Fill {
        final boolean buy;
        final String symbol;
        final BigDecimal qty, price;

        private Fill(boolean buy, String symbol, BigDecimal qty, BigDecimal price) {
            this.buy = buy;
            this.symbol = symbol;
            this.qty = qty;
            this.price = price;
        }

        static Fill of(Transaction tx, Map<Long, Trade> trades) {
            boolean buy = "TRADE_BUY".equals(tx.getType());
            Trade t = trades.get(tradeId(tx.getReferenceId()));
            if (t != null && t.getQuantity() != null && t.getPrice() != null) {
                return new Fill(buy, t.getSymbol(), t.getQuantity(), t.getPrice());
            }
            // "Bought 10 AAPL @ 178.5" (live) or "BUY 10 AAPL @ 178.5" (seeded)
            try {
                String[] parts = tx.getDescription().split("\\s+");
                return new Fill(buy, parts[2], new BigDecimal(parts[1]), new BigDecimal(parts[4]));
            } catch (Exception e) {
                return null;
            }
        }
    }

    private static Long tradeId(String referenceId) {
        if (referenceId == null || !referenceId.startsWith("TRADE-")) return null;
        try {
            return Long.parseLong(referenceId.substring("TRADE-".length()));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    // ================================================================
    // Data loading (batched — a handful of queries per request)
    // ================================================================

    private static final class Snapshot {
        List<User> users;
        Map<Long, List<Transaction>> transactionsByUser;
        Map<Long, List<Position>> positionsByUser;
        Map<String, Symbol> symbols;
        Map<String, BigDecimal> prices;
        Map<Long, Map<String, BigDecimal>> balancesByUser;   // userId -> asset -> amount (all product accounts)
        Map<Long, Trade> trades;
    }

    private Snapshot loadSnapshot() {
        return loadSnapshot(null);
    }

    private Snapshot loadSnapshot(Set<Long> onlyUsers) {
        Snapshot s = new Snapshot();
        s.users = onlyUsers == null ? userRepository.findAll() : userRepository.findAllById(onlyUsers);
        List<Transaction> txns = onlyUsers == null
                ? transactionRepository.findAll()
                : onlyUsers.stream().flatMap(id -> transactionRepository.findByUserId(id).stream()).collect(Collectors.toList());
        s.transactionsByUser = txns.stream().filter(t -> t.getUserId() != null)
                .collect(Collectors.groupingBy(Transaction::getUserId));
        List<Position> positions = onlyUsers == null
                ? positionRepository.findAll()
                : onlyUsers.stream().flatMap(id -> positionRepository.findByUserId(id).stream()).collect(Collectors.toList());
        s.positionsByUser = positions.stream().filter(p -> p.getUserId() != null)
                .collect(Collectors.groupingBy(Position::getUserId));
        s.symbols = symbolRepository.findAll().stream()
                .collect(Collectors.toMap(Symbol::getSymbol, x -> x, (a, b) -> a));
        s.prices = new HashMap<>();
        s.symbols.forEach((sym, x) -> s.prices.put(sym, x.getCurrentPrice()));
        s.balancesByUser = new HashMap<>();
        jdbc.query("SELECT a.user_id, b.asset, SUM(b.available + b.held) FROM balances b "
                + "JOIN accounts a ON a.id = b.account_id GROUP BY a.user_id, b.asset", rs -> {
            Long id = rs.getLong(1);
            if (onlyUsers == null || onlyUsers.contains(id)) {
                s.balancesByUser.computeIfAbsent(id, k -> new HashMap<>()).put(rs.getString(2), rs.getBigDecimal(3));
            }
        });
        Set<Long> tradeIds = txns.stream().map(t -> tradeId(t.getReferenceId()))
                .filter(Objects::nonNull).collect(Collectors.toSet());
        s.trades = new HashMap<>();
        tradeRepository.findAllById(tradeIds).forEach(t -> s.trades.put(t.getId(), t));
        return s;
    }

    /** userId of the caller: JWT claims (JwtAuthFilter) or the User entity (ApiKeyAuthFilter). */
    private Long getAuthenticatedUserId() {
        try {
            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth == null) return null;
            Object details = auth.getDetails();
            if (details instanceof Claims) {
                Object uid = ((Claims) details).get("userId");
                if (uid instanceof Number) return ((Number) uid).longValue();
            } else if (details instanceof User) {
                return ((User) details).getId();
            }
        } catch (Exception e) {
            // ignore
        }
        return null;
    }
}
