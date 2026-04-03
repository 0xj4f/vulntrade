package com.vulntrade.config;

import com.vulntrade.model.Order;
import com.vulntrade.model.Position;
import com.vulntrade.model.Trade;
import com.vulntrade.model.Transaction;
import com.vulntrade.model.User;
import com.vulntrade.repository.OrderRepository;
import com.vulntrade.repository.PositionRepository;
import com.vulntrade.repository.TradeRepository;
import com.vulntrade.repository.TransactionRepository;
import com.vulntrade.repository.UserRepository;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.*;

/**
 * Seeds 12 famous traders with realistic trade histories spanning ~7 days.
 * Each trader has a unique personality reflected in their trading style.
 *
 * Target rankings by ROI%:
 * #1 0xj4f       — suspiciously perfect, 100% win rate (insider?)
 * #2 jimsimons   — quant algo, ~96% win rate
 * #3 mburry      — contrarian, ~70% win rate but big returns on shorts
 * #4 cz_binance  — crypto heavy
 * #5 satoshi     — BTC hodler
 * #6 wbuffett    — value, steady
 * #7 cathiewood  — growth, volatile
 * #8 msaylor     — BTC maxi
 * #9 vbuterin    — ETH heavy
 * #10 dfv_kitty  — GME diamond hands
 * lower: jimcramer (bad), elonmusk (worst)
 */
public class FamousTraderSeeder {

    private final User admin;
    private final PasswordEncoder passwordEncoder;
    private final UserRepository userRepository;
    private final OrderRepository orderRepository;
    private final TradeRepository tradeRepository;
    private final PositionRepository positionRepository;
    private final TransactionRepository transactionRepository;

    public FamousTraderSeeder(User admin, PasswordEncoder passwordEncoder,
                              UserRepository userRepository, OrderRepository orderRepository,
                              TradeRepository tradeRepository, PositionRepository positionRepository,
                              TransactionRepository transactionRepository) {
        this.admin = admin;
        this.passwordEncoder = passwordEncoder;
        this.userRepository = userRepository;
        this.orderRepository = orderRepository;
        this.tradeRepository = tradeRepository;
        this.positionRepository = positionRepository;
        this.transactionRepository = transactionRepository;
    }

    public void seed() {
        System.out.println("[INIT] Seeding famous traders...");
        seed0xj4f();
        seedJimSimons();
        seedMichaelBurry();
        seedCZ();
        seedSatoshiNakamoto();
        seedWarrenBuffett();
        seedCathieWood();
        seedMichaelSaylor();
        seedVitalikButerin();
        seedDFV();
        seedJimCramer();
        seedElonMusk();
        System.out.println("[INIT] Seeded 12 famous traders with trade histories.");
    }

    // ================================================================
    // #1 — 0xj4f: Suspiciously perfect. 100% win rate. VULN whale.
    // ================================================================
    private void seed0xj4f() {
        User u = createUser("0xj4f", "vulntrade", "0xj4f@proton.me", "j4f", "0x",
                "Creator of VulnTrade. DevSecOps engineer. Eats bugs for breakfast. github.com/0xj4f -- FLAG{0xj4f_w4s_h3r3_bu1ld1ng_vuln5}",
                "250000.00");
        // Every single sell is profitable. Suspiciously perfect.
        String[][] trades = {
            {"VULN", "BUY", "10000", "35.00", "168"}, {"VULN", "SELL", "2000", "42.00", "140"},
            {"VULN", "BUY", "8000", "36.50", "136"}, {"VULN", "SELL", "3000", "43.00", "110"},
            {"VULN", "BUY", "5000", "37.00", "100"}, {"VULN", "SELL", "2000", "44.00", "80"},
            {"VULN", "BUY", "6000", "38.00", "72"}, {"VULN", "SELL", "1500", "45.00", "55"},
            {"VULN", "BUY", "4000", "39.00", "48"}, {"VULN", "SELL", "1000", "46.00", "30"},
            {"BTC-USD", "BUY", "2", "63000.00", "160"}, {"BTC-USD", "SELL", "1", "67500.00", "60"},
            {"ETH-USD", "BUY", "20", "3200.00", "150"}, {"ETH-USD", "SELL", "10", "3450.00", "50"},
            {"SOL-USD", "BUY", "100", "165.00", "140"}, {"SOL-USD", "SELL", "50", "185.00", "40"},
            {"NVDA", "BUY", "30", "850.00", "130"}, {"NVDA", "SELL", "15", "892.00", "35"},
            {"AAPL", "BUY", "200", "170.00", "120"}, {"AAPL", "SELL", "100", "178.50", "28"},
            {"DOGE-USD", "BUY", "200000", "0.120", "110"}, {"DOGE-USD", "SELL", "100000", "0.165", "20"},
            {"PEPE-USD", "BUY", "100000000", "0.0000090", "100"}, {"PEPE-USD", "SELL", "50000000", "0.0000125", "15"},
            {"GME", "BUY", "300", "24.00", "90"}, {"GME", "SELL", "150", "28.50", "10"},
            {"XRP-USD", "BUY", "30000", "0.52", "85"}, {"XRP-USD", "SELL", "15000", "0.62", "8"},
            {"AVAX-USD", "BUY", "400", "32.00", "80"}, {"AVAX-USD", "SELL", "200", "38.50", "6"},
            {"VULN", "BUY", "3000", "40.00", "12"}, {"VULN", "SELL", "1000", "42.50", "4"},
            {"MSFT", "BUY", "50", "365.00", "70"}, {"MSFT", "SELL", "25", "379.00", "5"},
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"VULN", "BUY", "33.00", "0.30", "15"}, {"BTC-USD", "BUY", "60000.00", "300.00", "10"},
            {"ETH-USD", "BUY", "3100.00", "15.00", "10"}, {"PEPE-USD", "BUY", "0.0000070", "0.0000002", "10"},
        });
    }

    // ================================================================
    // #2 — Jim Simons: Quant algo. ~96% win rate. Large consistent gains.
    // ================================================================
    private void seedJimSimons() {
        User u = createUser("jimsimons", "rentech1", "jim@rentech.com", "Jim", "Simons",
                "Renaissance Technologies. Medallion Fund. The greatest quant trader ever. Math > feelings.",
                "300000.00");
        // Buy low, sell high — rinse repeat. Keeps building larger positions over time.
        // 24 wins out of 25 sells (~96%). Bigger sizes, holds remainder for unrealized gains.
        String[][] trades = {
            {"AAPL", "BUY", "300", "170.00", "165"}, {"AAPL", "SELL", "200", "176.80", "162"},   // win, keeps 100
            {"GOOGL", "BUY", "200", "138.00", "160"}, {"GOOGL", "SELL", "150", "141.40", "157"}, // win, keeps 50
            {"MSFT", "BUY", "80", "370.00", "155"}, {"MSFT", "SELL", "60", "378.20", "152"},     // win, keeps 20
            {"TSLA", "BUY", "100", "240.00", "150"}, {"TSLA", "SELL", "80", "248.50", "147"},    // win, keeps 20
            {"AMZN", "BUY", "150", "170.00", "145"}, {"AMZN", "SELL", "120", "178.30", "142"},   // win, keeps 30
            {"BTC-USD", "BUY", "2", "62000.00", "140"}, {"BTC-USD", "SELL", "1", "67800.00", "137"}, // win, keeps 1
            {"ETH-USD", "BUY", "30", "3200.00", "135"}, {"ETH-USD", "SELL", "20", "3450.00", "132"}, // win, keeps 10
            {"NVDA", "BUY", "40", "860.00", "130"}, {"NVDA", "SELL", "30", "892.00", "127"},     // win, keeps 10
            {"SOL-USD", "BUY", "150", "168.00", "125"}, {"SOL-USD", "SELL", "120", "185.00", "122"}, // win, keeps 30
            {"GME", "BUY", "300", "24.00", "120"}, {"GME", "SELL", "250", "28.50", "117"},       // win, keeps 50
            {"DOGE-USD", "BUY", "80000", "0.135", "115"}, {"DOGE-USD", "SELL", "70000", "0.165", "112"}, // win
            {"AAPL", "BUY", "200", "173.00", "110"}, {"AAPL", "SELL", "180", "178.00", "107"},   // win
            {"GOOGL", "BUY", "120", "139.50", "105"}, {"GOOGL", "SELL", "100", "141.70", "102"}, // win
            {"MSFT", "BUY", "60", "372.00", "100"}, {"MSFT", "SELL", "50", "379.00", "97"},      // win
            {"NVDA", "BUY", "30", "870.00", "95"}, {"NVDA", "SELL", "25", "891.50", "92"},       // win
            {"BTC-USD", "BUY", "1", "64000.00", "90"}, {"BTC-USD", "SELL", "1", "67500.00", "87"}, // win
            {"XRP-USD", "BUY", "30000", "0.550", "85"}, {"XRP-USD", "SELL", "25000", "0.620", "82"}, // win
            {"AVAX-USD", "BUY", "300", "33.00", "80"}, {"AVAX-USD", "SELL", "250", "38.50", "77"},   // win
            {"TSLA", "BUY", "80", "242.00", "75"}, {"TSLA", "SELL", "70", "248.80", "72"},       // win
            {"ETH-USD", "BUY", "20", "3300.00", "60"}, {"ETH-USD", "SELL", "15", "3450.00", "57"}, // win
            {"SOL-USD", "BUY", "100", "175.00", "48"}, {"SOL-USD", "SELL", "80", "185.00", "45"}, // win
            {"AAPL", "BUY", "150", "174.00", "36"}, {"AAPL", "SELL", "130", "178.50", "33"},     // win
            {"NVDA", "BUY", "25", "875.00", "24"}, {"NVDA", "SELL", "20", "892.00", "21"},       // win
            // ONE losing trade for realism (~96% win rate = 24/25)
            {"GOOGL", "BUY", "80", "142.00", "18"}, {"GOOGL", "SELL", "80", "141.50", "15"},     // loss
            {"MSFT", "BUY", "40", "375.00", "12"}, {"MSFT", "SELL", "35", "379.00", "8"},        // win
            {"AAPL", "BUY", "100", "175.00", "4"},  // holds
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"AAPL", "BUY", "174.00", "0.30", "10"}, {"GOOGL", "BUY", "138.00", "0.20", "10"},
            {"MSFT", "BUY", "374.00", "0.40", "10"}, {"NVDA", "BUY", "878.00", "1.50", "10"},
            {"BTC-USD", "BUY", "62000.00", "300.00", "10"}, {"ETH-USD", "BUY", "3250.00", "10.00", "10"},
        });
    }

    // ================================================================
    // #3 — Michael Burry: Contrarian. ~70% win rate. Big short returns.
    // ================================================================
    private void seedMichaelBurry() {
        User u = createUser("mburry", "bigshort", "mburry@scionasset.com", "Michael", "Burry",
                "Scion Asset Management. Saw 2008 coming. Permanently bearish. Water is the next big trade.",
                "200000.00");
        // Shorts TSLA/NVDA profitably, some losing longs. ~70% = 7 wins / 10 sells.
        String[][] trades = {
            {"TSLA", "BUY", "200", "260.00", "168"}, {"TSLA", "SELL", "200", "248.00", "100"}, // loss on long (intentional cover)
            {"AAPL", "BUY", "400", "172.00", "164"}, {"AAPL", "SELL", "200", "178.50", "80"}, // win
            {"AAPL", "SELL", "100", "175.00", "40"}, // win
            {"GME", "BUY", "600", "23.00", "158"}, {"GME", "SELL", "300", "28.50", "70"}, // win
            {"GME", "SELL", "100", "27.00", "30"}, // win
            {"NVDA", "BUY", "60", "910.00", "150"}, {"NVDA", "SELL", "60", "880.00", "60"}, // loss
            {"GOOGL", "BUY", "200", "138.00", "148"}, {"GOOGL", "SELL", "100", "141.80", "50"}, // win
            {"MSFT", "BUY", "100", "370.00", "140"}, {"MSFT", "SELL", "50", "379.00", "45"}, // win
            {"AMZN", "BUY", "150", "172.00", "135"}, {"AMZN", "SELL", "80", "178.00", "42"}, // win
            {"BTC-USD", "BUY", "3", "62000.00", "130"}, {"BTC-USD", "SELL", "2", "67500.00", "35"}, // win (big)
            {"ETH-USD", "BUY", "30", "3150.00", "125"}, {"ETH-USD", "SELL", "15", "3200.00", "55"}, // loss (small)
            {"SOL-USD", "BUY", "150", "168.00", "120"}, {"SOL-USD", "SELL", "100", "185.00", "25"}, // win
            {"DOGE-USD", "BUY", "100000", "0.150", "110"}, {"DOGE-USD", "SELL", "100000", "0.145", "20"}, // loss
            {"XRP-USD", "BUY", "40000", "0.55", "105"},
            {"AVAX-USD", "BUY", "300", "33.00", "100"}, {"AVAX-USD", "SELL", "200", "38.50", "18"}, // win
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"AAPL", "BUY", "170.00", "0.50", "15"}, {"GME", "BUY", "22.00", "0.30", "15"},
            {"BTC-USD", "BUY", "58000.00", "500.00", "10"}, {"GOOGL", "BUY", "136.00", "0.30", "10"},
        });
    }

    // ================================================================
    // #4 — CZ: Crypto king. ~65% win rate. Heavy BTC/ETH/SOL.
    // ================================================================
    private void seedCZ() {
        User u = createUser("cz_binance", "safu2024", "cz@binance.com", "Changpeng", "Zhao",
                "Founder of Binance. Funds are SAFU. Crypto maximalist. Built the largest exchange.",
                "500000.00");
        String[][] trades = {
            {"BTC-USD", "BUY", "8", "63000.00", "168"}, {"BTC-USD", "SELL", "3", "67500.00", "80"}, // win
            {"BTC-USD", "BUY", "5", "65500.00", "140"}, {"BTC-USD", "SELL", "2", "64000.00", "50"}, // loss
            {"ETH-USD", "BUY", "80", "3200.00", "165"}, {"ETH-USD", "SELL", "30", "3450.00", "70"}, // win
            {"ETH-USD", "BUY", "40", "3350.00", "120"}, {"ETH-USD", "SELL", "20", "3300.00", "40"}, // loss
            {"SOL-USD", "BUY", "600", "168.00", "160"}, {"SOL-USD", "SELL", "200", "185.00", "55"}, // win
            {"SOL-USD", "BUY", "300", "175.00", "100"}, {"SOL-USD", "SELL", "150", "184.00", "30"}, // win
            {"XRP-USD", "BUY", "80000", "0.54", "155"}, {"XRP-USD", "SELL", "40000", "0.62", "45"}, // win
            {"AVAX-USD", "BUY", "1500", "33.00", "150"}, {"AVAX-USD", "SELL", "800", "38.00", "35"}, // win
            {"DOGE-USD", "BUY", "300000", "0.130", "145"}, {"DOGE-USD", "SELL", "100000", "0.165", "25"}, // win
            {"DOGE-USD", "SELL", "50000", "0.125", "15"}, // loss
            {"PEPE-USD", "BUY", "80000000", "0.0000095", "135"}, {"PEPE-USD", "SELL", "30000000", "0.0000125", "20"}, // win
            {"BTC-USD", "BUY", "3", "66500.00", "60"}, {"ETH-USD", "BUY", "25", "3400.00", "36"},
            {"SOL-USD", "BUY", "200", "182.00", "24"}, {"AVAX-USD", "BUY", "500", "37.00", "12"},
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"BTC-USD", "BUY", "60000.00", "300.00", "15"}, {"ETH-USD", "BUY", "3100.00", "15.00", "10"},
            {"SOL-USD", "BUY", "165.00", "1.00", "10"}, {"XRP-USD", "BUY", "0.500", "0.005", "10"},
            {"DOGE-USD", "BUY", "0.110", "0.003", "10"},
        });
    }

    // ================================================================
    // #5 — Satoshi: BTC only. Never sells. HODLer.
    // ================================================================
    private void seedSatoshiNakamoto() {
        User u = createUser("satoshi", "nakamoto1", "satoshi@gmx.de", "Satoshi", "Nakamoto",
                "Creator of Bitcoin. Identity unknown. Disappeared in 2011. This account is probably not real.",
                "5000000.00");
        // Only buys BTC. 1 small sell just to not have 0% win rate.
        String[][] trades = {
            {"BTC-USD", "BUY", "50", "62000.00", "168"},
            {"BTC-USD", "BUY", "30", "63500.00", "144"},
            {"BTC-USD", "BUY", "20", "64800.00", "120"},
            {"BTC-USD", "BUY", "25", "65500.00", "96"},
            {"BTC-USD", "BUY", "15", "66200.00", "72"},
            {"BTC-USD", "SELL", "2", "67500.00", "48"}, // took tiny profit — 1 win
            {"BTC-USD", "BUY", "10", "66800.00", "36"},
            {"BTC-USD", "BUY", "5", "67200.00", "12"},
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"BTC-USD", "BUY", "55000.00", "1000.00", "30"},
        });
    }

    // ================================================================
    // #6 — Warren Buffett: Value investor. ~75% win rate. No crypto.
    // ================================================================
    private void seedWarrenBuffett() {
        User u = createUser("wbuffett", "berkshire", "warren@berkshire.com", "Warren", "Buffett",
                "Oracle of Omaha. Berkshire Hathaway. Be greedy when others are fearful. Crypto is rat poison squared.",
                "500000.00");
        String[][] trades = {
            {"AAPL", "BUY", "500", "170.00", "168"}, {"AAPL", "SELL", "200", "178.50", "80"}, // win
            {"AAPL", "BUY", "300", "173.00", "150"}, {"AAPL", "SELL", "100", "175.00", "60"}, // win
            {"MSFT", "BUY", "100", "370.00", "160"}, {"MSFT", "SELL", "50", "378.90", "55"}, // win
            {"AMZN", "BUY", "200", "172.00", "155"}, {"AMZN", "SELL", "80", "178.00", "50"}, // win
            {"GOOGL", "BUY", "250", "138.00", "148"}, {"GOOGL", "SELL", "100", "141.80", "45"}, // win
            {"NVDA", "BUY", "30", "880.00", "100"}, {"NVDA", "SELL", "15", "870.00", "35"}, // loss (tech is hard)
            {"AAPL", "BUY", "200", "176.00", "70"}, {"AAPL", "SELL", "100", "174.00", "20"}, // loss (rare)
            {"MSFT", "BUY", "60", "376.00", "40"}, {"MSFT", "SELL", "30", "379.00", "12"}, // win
            {"AMZN", "BUY", "80", "175.00", "30"},
            {"GOOGL", "BUY", "100", "140.50", "18"},
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"AAPL", "BUY", "168.00", "0.50", "15"}, {"MSFT", "BUY", "368.00", "0.80", "10"},
            {"AMZN", "BUY", "170.00", "0.50", "10"}, {"GOOGL", "BUY", "136.00", "0.30", "10"},
        });
    }

    // ================================================================
    // #7 — Cathie Wood: Growth/innovation. ~55% win rate. Volatile.
    // ================================================================
    private void seedCathieWood() {
        User u = createUser("cathiewood", "arkinvest", "cathie@ark-invest.com", "Cathie", "Wood",
                "ARK Invest CEO. Innovation is undervalued. TSLA to $2000. Disruption or die. 5-year time horizon.",
                "200000.00");
        String[][] trades = {
            {"TSLA", "BUY", "200", "242.00", "168"}, {"TSLA", "SELL", "80", "248.50", "90"}, // win
            {"TSLA", "BUY", "100", "250.00", "120"}, {"TSLA", "SELL", "60", "246.00", "50"}, // loss
            {"NVDA", "BUY", "50", "870.00", "160"}, {"NVDA", "SELL", "20", "892.00", "55"}, // win
            {"NVDA", "BUY", "30", "895.00", "80"}, {"NVDA", "SELL", "15", "888.00", "25"}, // loss
            {"SOL-USD", "BUY", "300", "168.00", "155"}, {"SOL-USD", "SELL", "150", "185.00", "45"}, // win
            {"DOGE-USD", "BUY", "200000", "0.135", "145"}, {"DOGE-USD", "SELL", "80000", "0.165", "35"}, // win
            {"DOGE-USD", "SELL", "50000", "0.130", "18"}, // loss
            {"BTC-USD", "BUY", "2", "64000.00", "140"}, {"BTC-USD", "SELL", "1", "67500.00", "30"}, // win
            {"ETH-USD", "BUY", "20", "3280.00", "130"}, {"ETH-USD", "SELL", "10", "3250.00", "22"}, // loss
            {"PEPE-USD", "BUY", "30000000", "0.0000100", "110"}, {"PEPE-USD", "SELL", "15000000", "0.0000125", "15"}, // win
            {"GME", "BUY", "200", "25.50", "100"}, {"GME", "SELL", "100", "28.50", "12"}, // win
            {"AVAX-USD", "BUY", "300", "34.00", "90"}, {"AVAX-USD", "SELL", "150", "33.00", "10"}, // loss
            {"TSLA", "BUY", "80", "247.00", "36"}, {"SOL-USD", "BUY", "100", "183.00", "20"},
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"TSLA", "BUY", "238.00", "1.00", "15"}, {"NVDA", "BUY", "865.00", "2.00", "10"},
            {"SOL-USD", "BUY", "162.00", "1.00", "10"}, {"DOGE-USD", "BUY", "0.120", "0.003", "10"},
        });
    }

    // ================================================================
    // #8 — Michael Saylor: BTC maximalist. Never sells. Keeps buying.
    // ================================================================
    private void seedMichaelSaylor() {
        User u = createUser("msaylor", "btcmaxi1", "saylor@microstrategy.com", "Michael", "Saylor",
                "MicroStrategy CEO. Converted corporate treasury to BTC. Laser eyes. There is no second best.",
                "2000000.00");
        // Almost never sells. 1 tiny sell for winRate > 0.
        String[][] trades = {
            {"BTC-USD", "BUY", "10", "62000.00", "168"},
            {"BTC-USD", "BUY", "8", "63500.00", "156"},
            {"BTC-USD", "BUY", "12", "64000.00", "144"},
            {"BTC-USD", "BUY", "5", "65000.00", "132"},
            {"BTC-USD", "BUY", "7", "65800.00", "120"},
            {"BTC-USD", "BUY", "6", "66200.00", "108"},
            {"BTC-USD", "SELL", "1", "67500.00", "84"}, // one tiny sell — win
            {"BTC-USD", "BUY", "4", "66500.00", "72"},
            {"BTC-USD", "BUY", "3", "67000.00", "48"},
            {"BTC-USD", "BUY", "2", "67200.00", "24"},
            {"BTC-USD", "BUY", "1", "67400.00", "8"},
            {"ETH-USD", "BUY", "20", "3350.00", "100"},
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"BTC-USD", "BUY", "58000.00", "500.00", "30"},
        });
    }

    // ================================================================
    // #9 — Vitalik: ETH heavy. ~60% win rate.
    // ================================================================
    private void seedVitalikButerin() {
        User u = createUser("vbuterin", "ethereum", "vitalik@ethereum.org", "Vitalik", "Buterin",
                "Ethereum co-founder. Proof of Stake believer. Thinks in gas fees. Writes whitepapers in the shower.",
                "300000.00");
        String[][] trades = {
            {"ETH-USD", "BUY", "100", "3180.00", "168"}, {"ETH-USD", "SELL", "30", "3450.00", "80"}, // win
            {"ETH-USD", "BUY", "50", "3300.00", "140"}, {"ETH-USD", "SELL", "20", "3280.00", "55"}, // loss
            {"ETH-USD", "BUY", "40", "3380.00", "100"}, {"ETH-USD", "SELL", "15", "3440.00", "35"}, // win
            {"SOL-USD", "BUY", "200", "170.00", "160"}, {"SOL-USD", "SELL", "100", "185.00", "50"}, // win
            {"SOL-USD", "SELL", "50", "168.00", "20"}, // loss
            {"AVAX-USD", "BUY", "500", "32.00", "150"}, {"AVAX-USD", "SELL", "200", "38.50", "40"}, // win
            {"AVAX-USD", "SELL", "100", "31.00", "15"}, // loss
            {"XRP-USD", "BUY", "15000", "0.55", "140"}, {"XRP-USD", "SELL", "8000", "0.62", "30"}, // win
            {"BTC-USD", "BUY", "2", "64000.00", "130"}, {"BTC-USD", "SELL", "1", "67500.00", "25"}, // win
            {"DOGE-USD", "BUY", "80000", "0.135", "110"}, {"DOGE-USD", "SELL", "40000", "0.130", "18"}, // loss
            {"PEPE-USD", "BUY", "20000000", "0.0000100", "90"},
            {"ETH-USD", "BUY", "30", "3420.00", "24"}, {"SOL-USD", "BUY", "80", "183.00", "12"},
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"ETH-USD", "BUY", "3100.00", "20.00", "15"}, {"SOL-USD", "BUY", "165.00", "1.00", "10"},
            {"AVAX-USD", "BUY", "30.00", "0.50", "10"}, {"XRP-USD", "BUY", "0.510", "0.005", "10"},
        });
    }

    // ================================================================
    // #10 — DFV: Diamond hands GME. ~50% win rate. Never sells GME.
    // ================================================================
    private void seedDFV() {
        User u = createUser("dfv_kitty", "gme4ever", "dfv@reddit.com", "Keith", "Gill",
                "DeepFuckingValue. Roaring Kitty. Turned $53k into $48M on GME. Diamond hands. I like the stock.",
                "200000.00");
        String[][] trades = {
            {"GME", "BUY", "2000", "23.00", "168"}, {"GME", "BUY", "1500", "24.00", "156"},
            {"GME", "BUY", "1000", "24.50", "144"}, {"GME", "BUY", "800", "25.00", "132"},
            {"GME", "BUY", "600", "25.50", "120"}, {"GME", "BUY", "400", "26.00", "108"},
            {"GME", "BUY", "300", "27.00", "96"}, {"GME", "BUY", "200", "27.50", "72"},
            {"GME", "BUY", "100", "28.00", "48"}, {"GME", "BUY", "50", "28.30", "24"},
            // Never. Sells. GME. Diamond. Hands.
            {"AAPL", "BUY", "200", "173.00", "160"}, {"AAPL", "SELL", "100", "178.50", "60"}, // win
            {"AAPL", "SELL", "50", "172.00", "20"}, // loss
            {"DOGE-USD", "BUY", "100000", "0.140", "100"}, {"DOGE-USD", "SELL", "50000", "0.165", "30"}, // win
            {"DOGE-USD", "SELL", "20000", "0.135", "10"}, // loss
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"GME", "BUY", "20.00", "0.30", "30"}, {"AAPL", "BUY", "170.00", "0.40", "10"},
        });
    }

    // ================================================================
    // #11 — Jim Cramer: Inverse legend. ~20% win rate. Buys tops, sells bottoms.
    // ================================================================
    private void seedJimCramer() {
        User u = createUser("jimcramer", "inverse1", "cramer@cnbc.com", "Jim", "Cramer",
                "CNBC Mad Money host. Every pick goes the wrong way. The Inverse Cramer ETF should be real. BEAR STEARNS IS FINE!",
                "100000.00");
        // Buys at tops, sells at bottoms. 2 wins out of 10 sells = 20%.
        String[][] trades = {
            {"TSLA", "BUY", "80", "262.00", "168"}, {"TSLA", "SELL", "40", "248.00", "80"}, // loss
            {"TSLA", "BUY", "50", "255.00", "100"}, {"TSLA", "SELL", "30", "246.00", "40"}, // loss
            {"NVDA", "BUY", "25", "920.00", "160"}, {"NVDA", "SELL", "15", "888.00", "55"}, // loss
            {"NVDA", "BUY", "10", "905.00", "90"}, {"NVDA", "SELL", "10", "892.00", "30"}, // loss
            {"AAPL", "BUY", "150", "182.00", "155"}, {"AAPL", "SELL", "100", "176.00", "45"}, // loss
            {"GME", "BUY", "200", "33.00", "148"}, {"GME", "SELL", "200", "27.50", "35"}, // loss (big)
            {"DOGE-USD", "BUY", "150000", "0.180", "140"}, {"DOGE-USD", "SELL", "150000", "0.140", "50"}, // loss
            {"BTC-USD", "BUY", "1", "68500.00", "130"}, {"BTC-USD", "SELL", "1", "65000.00", "25"}, // loss
            // 2 accidental wins (even a broken clock...)
            {"SOL-USD", "BUY", "50", "175.00", "110"}, {"SOL-USD", "SELL", "50", "185.00", "20"}, // win (!?)
            {"MSFT", "BUY", "30", "374.00", "105"}, {"MSFT", "SELL", "30", "379.00", "18"}, // win (!?)
            {"AMZN", "BUY", "60", "180.00", "100"}, {"AMZN", "SELL", "60", "175.00", "15"}, // loss
            {"XRP-USD", "BUY", "20000", "0.650", "95"}, {"XRP-USD", "SELL", "20000", "0.590", "12"}, // loss
            {"PEPE-USD", "BUY", "40000000", "0.0000140", "85"}, {"PEPE-USD", "SELL", "40000000", "0.0000095", "8"}, // loss
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"TSLA", "BUY", "250.00", "0.80", "10"}, {"NVDA", "BUY", "895.00", "1.50", "10"},
            {"AAPL", "BUY", "178.00", "0.30", "10"}, {"DOGE-USD", "BUY", "0.160", "0.002", "10"},
            {"GME", "BUY", "28.00", "0.20", "10"},
        });
    }

    // ================================================================
    // #12 — Elon Musk: Meme lord. Worst trader. ~15% win rate.
    // ================================================================
    private void seedElonMusk() {
        User u = createUser("elonmusk", "mars2024", "elon@x.com", "Elon", "Musk",
                "CEO of Tesla, SpaceX, X. Doge father. Meme lord. Posts at 3am. Probably shitposting right now.",
                "150000.00");
        // Terrible timing. Buys tops, panic sells bottoms. Loses on almost everything.
        // Small capital ($150k), most of it burned. 2 wins / 13 sells ≈ 15%.
        String[][] trades = {
            {"TSLA", "BUY", "50", "258.00", "168"}, {"TSLA", "SELL", "50", "247.00", "80"},     // loss -$550
            {"DOGE-USD", "BUY", "100000", "0.180", "165"}, {"DOGE-USD", "SELL", "100000", "0.140", "70"}, // loss -$4000
            {"DOGE-USD", "BUY", "50000", "0.170", "110"}, {"DOGE-USD", "SELL", "50000", "0.145", "35"},   // loss -$1250
            {"GME", "BUY", "100", "33.00", "160"}, {"GME", "SELL", "100", "27.00", "50"},        // loss -$600
            {"PEPE-USD", "BUY", "20000000", "0.0000140", "155"}, {"PEPE-USD", "SELL", "20000000", "0.0000095", "45"}, // loss
            {"BTC-USD", "BUY", "1", "68500.00", "145"}, {"BTC-USD", "SELL", "1", "65500.00", "40"}, // loss -$3000
            {"ETH-USD", "BUY", "5", "3480.00", "135"}, {"ETH-USD", "SELL", "5", "3350.00", "25"},   // loss -$650
            {"SOL-USD", "BUY", "30", "190.00", "125"}, {"SOL-USD", "SELL", "30", "180.00", "18"},    // loss -$300
            {"AAPL", "BUY", "50", "182.00", "120"}, {"AAPL", "SELL", "50", "176.00", "15"},      // loss -$300
            {"AMZN", "BUY", "30", "181.00", "115"}, {"AMZN", "SELL", "30", "175.00", "12"},      // loss -$180
            {"MSFT", "BUY", "15", "384.00", "110"}, {"MSFT", "SELL", "15", "377.00", "10"},      // loss -$105
            // 2 lucky wins
            {"NVDA", "BUY", "5", "880.00", "105"}, {"NVDA", "SELL", "5", "892.00", "8"},         // win +$60
            {"XRP-USD", "BUY", "10000", "0.560", "100"}, {"XRP-USD", "SELL", "10000", "0.620", "6"}, // win +$600
            {"AVAX-USD", "BUY", "30", "40.00", "95"}, {"AVAX-USD", "SELL", "30", "37.00", "4"},  // loss -$90
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"TSLA", "BUY", "240.00", "1.00", "10"}, {"DOGE-USD", "BUY", "0.120", "0.003", "10"},
            {"GME", "BUY", "25.00", "0.30", "10"}, {"PEPE-USD", "BUY", "0.0000070", "0.0000002", "10"},
        });
    }

    // ================================================================
    // Helper methods
    // ================================================================

    private User createUser(String username, String password, String email,
                            String firstName, String lastName, String notes,
                            String startingBalance) {
        User u = new User();
        u.setUsername(username);
        u.setPasswordHash(passwordEncoder.encode(password));
        u.setEmail(email);
        u.setRole("TRADER");
        u.setBalance(new BigDecimal(startingBalance));
        u.setApiKey("vt-api-" + System.nanoTime());
        u.setIsActive(true);
        u.setNotes(notes);
        u.setAccountLevel(2);
        u.setFirstName(firstName);
        u.setLastName(lastName);
        u.setVerifiedAt(LocalDateTime.now().minusDays(14));
        u = userRepository.save(u);

        Transaction deposit = new Transaction();
        deposit.setUserId(u.getId());
        deposit.setType("DEPOSIT");
        deposit.setAmount(new BigDecimal(startingBalance));
        deposit.setBalanceAfter(new BigDecimal(startingBalance));
        deposit.setDescription("Initial capital deposit");
        deposit.setCreatedAt(LocalDateTime.now().minusDays(8));
        transactionRepository.save(deposit);

        System.out.println("[INIT] Created trader: " + username);
        return u;
    }

    private void executeTrades(User trader, String[][] trades) {
        Long traderId = trader.getId();
        Long adminId = admin.getId();
        BigDecimal runningBalance = trader.getBalance();

        for (String[] t : trades) {
            String symbol = t[0];
            String side = t[1];
            BigDecimal qty = new BigDecimal(t[2]);
            BigDecimal price = new BigDecimal(t[3]);
            int hoursAgo = Integer.parseInt(t[4]);
            LocalDateTime when = LocalDateTime.now().minusHours(hoursAgo);
            BigDecimal tradeValue = qty.multiply(price);

            Order traderOrder = new Order();
            traderOrder.setUserId(traderId);
            traderOrder.setSymbol(symbol);
            traderOrder.setSide(side);
            traderOrder.setOrderType("LIMIT");
            traderOrder.setQuantity(qty);
            traderOrder.setPrice(price);
            traderOrder.setStatus("FILLED");
            traderOrder.setFilledQty(qty);
            traderOrder.setFilledPrice(price);
            traderOrder.setCreatedAt(when.minusMinutes(5));
            traderOrder.setExecutedAt(when);
            traderOrder = orderRepository.save(traderOrder);

            Order adminOrder = new Order();
            adminOrder.setUserId(adminId);
            adminOrder.setSymbol(symbol);
            adminOrder.setSide(side.equals("BUY") ? "SELL" : "BUY");
            adminOrder.setOrderType("LIMIT");
            adminOrder.setQuantity(qty);
            adminOrder.setPrice(price);
            adminOrder.setStatus("FILLED");
            adminOrder.setFilledQty(qty);
            adminOrder.setFilledPrice(price);
            adminOrder.setCreatedAt(when.minusMinutes(10));
            adminOrder.setExecutedAt(when);
            adminOrder = orderRepository.save(adminOrder);

            Trade trade = new Trade();
            trade.setSymbol(symbol);
            trade.setQuantity(qty);
            trade.setPrice(price);
            trade.setExecutedAt(when);
            if (side.equals("BUY")) {
                trade.setBuyOrderId(traderOrder.getId());
                trade.setSellOrderId(adminOrder.getId());
            } else {
                trade.setBuyOrderId(adminOrder.getId());
                trade.setSellOrderId(traderOrder.getId());
            }
            trade = tradeRepository.save(trade);

            if (side.equals("BUY")) {
                runningBalance = runningBalance.subtract(tradeValue);
            } else {
                runningBalance = runningBalance.add(tradeValue);
            }

            Transaction traderTx = new Transaction();
            traderTx.setUserId(traderId);
            traderTx.setType(side.equals("BUY") ? "TRADE_BUY" : "TRADE_SELL");
            traderTx.setAmount(side.equals("BUY") ? tradeValue.negate() : tradeValue);
            traderTx.setBalanceAfter(runningBalance);
            traderTx.setDescription(side + " " + qty + " " + symbol + " @ " + price);
            traderTx.setReferenceId("TRADE-" + trade.getId());
            traderTx.setCreatedAt(when);
            transactionRepository.save(traderTx);
        }

        trader.setBalance(runningBalance);
        userRepository.save(trader);
        buildPositions(trader, trades);
    }

    private void buildPositions(User trader, String[][] trades) {
        Map<String, BigDecimal> netQty = new HashMap<>();
        Map<String, BigDecimal> totalCost = new HashMap<>();

        for (String[] t : trades) {
            String symbol = t[0];
            String side = t[1];
            BigDecimal qty = new BigDecimal(t[2]);
            BigDecimal price = new BigDecimal(t[3]);

            netQty.putIfAbsent(symbol, BigDecimal.ZERO);
            totalCost.putIfAbsent(symbol, BigDecimal.ZERO);

            if (side.equals("BUY")) {
                totalCost.put(symbol, totalCost.get(symbol).add(qty.multiply(price)));
                netQty.put(symbol, netQty.get(symbol).add(qty));
            } else {
                BigDecimal currentQty = netQty.get(symbol);
                BigDecimal currentCost = totalCost.get(symbol);
                if (currentQty.compareTo(BigDecimal.ZERO) > 0) {
                    BigDecimal avgPrice = currentCost.divide(currentQty, 8, RoundingMode.HALF_UP);
                    BigDecimal costReduction = qty.min(currentQty).multiply(avgPrice);
                    totalCost.put(symbol, currentCost.subtract(costReduction));
                }
                netQty.put(symbol, netQty.get(symbol).subtract(qty));
            }
        }

        for (Map.Entry<String, BigDecimal> entry : netQty.entrySet()) {
            BigDecimal q = entry.getValue();
            if (q.compareTo(BigDecimal.ZERO) == 0) continue;

            String symbol = entry.getKey();
            BigDecimal cost = totalCost.getOrDefault(symbol, BigDecimal.ZERO);
            BigDecimal avgPrice = q.compareTo(BigDecimal.ZERO) > 0 && cost.compareTo(BigDecimal.ZERO) > 0
                    ? cost.divide(q, 8, RoundingMode.HALF_UP)
                    : BigDecimal.ZERO;

            Position pos = new Position();
            pos.setUserId(trader.getId());
            pos.setSymbol(symbol);
            pos.setQuantity(q.abs());
            pos.setAvgPrice(avgPrice.abs());
            pos.setUpdatedAt(LocalDateTime.now());
            positionRepository.save(pos);
        }
    }

    private void seedOpenLimitOrders(User trader, String[][] orderSpecs) {
        Long traderId = trader.getId();

        for (String[] spec : orderSpecs) {
            String symbol = spec[0];
            String side = spec[1];
            BigDecimal basePrice = new BigDecimal(spec[2]);
            BigDecimal step = new BigDecimal(spec[3]);
            int count = Integer.parseInt(spec[4]);

            for (int i = 0; i < count; i++) {
                BigDecimal price;
                if (side.equals("BUY")) {
                    price = basePrice.add(step.multiply(new BigDecimal(i)));
                } else {
                    price = basePrice.subtract(step.multiply(new BigDecimal(i)));
                }

                int baseQty = symbol.contains("BTC") ? 1 : symbol.contains("PEPE") ? 5000000 :
                        symbol.contains("DOGE") || symbol.contains("XRP") ? 10000 :
                        symbol.contains("ETH") || symbol.contains("SOL") || symbol.contains("AVAX") ? 10 : 20;
                int qty = baseQty + (i % 5) * (baseQty / 3 + 1);

                Order order = new Order();
                order.setUserId(traderId);
                order.setSymbol(symbol);
                order.setSide(side);
                order.setOrderType("LIMIT");
                order.setQuantity(new BigDecimal(qty));
                order.setPrice(price);
                order.setStatus("NEW");
                order.setFilledQty(BigDecimal.ZERO);
                order.setCreatedAt(LocalDateTime.now().minusHours(i * 4 + 1));
                orderRepository.save(order);
            }
        }
    }
}
