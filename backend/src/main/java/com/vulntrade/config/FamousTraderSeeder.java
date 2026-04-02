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

        seedMichaelBurry();
        seedCZ();
        seedJimSimons();
        seedMichaelSaylor();
        seedVitalikButerin();
        seed0xj4f();
        seedSatoshiNakamoto();
        seedJimCramer();
        seedCathieWood();
        seedWarrenBuffett();
        seedElonMusk();
        seedDFV();

        System.out.println("[INIT] Seeded 12 famous traders with trade histories.");
    }

    // ================================================================
    // Individual trader seeds
    // ================================================================

    private void seedMichaelBurry() {
        User u = createUser("mburry", "bigshort", "mburry@scionasset.com",
                "Michael", "Burry",
                "Scion Asset Management. Saw the 2008 crash coming. Permanently bearish. Water is the next big trade.",
                "500000.00");

        String[][] trades = {
            // symbol, side, qty, price, hoursAgo
            {"TSLA", "SELL", "200", "262.00", "168"},  // shorted TSLA 7 days ago
            {"TSLA", "SELL", "150", "258.50", "150"},
            {"TSLA", "SELL", "100", "255.00", "132"},
            {"TSLA", "BUY", "50", "251.00", "120"},     // covered some
            {"TSLA", "SELL", "200", "254.00", "108"},
            {"AAPL", "BUY", "300", "176.00", "160"},
            {"AAPL", "BUY", "200", "177.50", "140"},
            {"AAPL", "SELL", "100", "179.00", "96"},
            {"GME", "BUY", "500", "25.50", "156"},
            {"GME", "BUY", "300", "26.00", "130"},
            {"GME", "SELL", "200", "27.80", "100"},
            {"GME", "BUY", "400", "27.00", "72"},
            {"GOOGL", "SELL", "150", "143.50", "144"},   // short GOOGL
            {"GOOGL", "SELL", "100", "142.80", "120"},
            {"GOOGL", "BUY", "50", "141.50", "84"},
            {"MSFT", "SELL", "100", "382.00", "136"},
            {"MSFT", "SELL", "80", "380.50", "110"},
            {"NVDA", "SELL", "50", "910.00", "148"},    // short NVDA - thinks it's a bubble
            {"NVDA", "SELL", "40", "905.00", "124"},
            {"NVDA", "SELL", "30", "898.00", "96"},
            {"AMZN", "BUY", "100", "175.50", "152"},
            {"AMZN", "BUY", "80", "176.80", "128"},
            {"AMZN", "SELL", "50", "178.00", "80"},
            {"TSLA", "SELL", "100", "252.00", "72"},
            {"TSLA", "SELL", "80", "250.50", "48"},
            {"AAPL", "BUY", "150", "178.00", "36"},
            {"GME", "BUY", "200", "28.00", "24"},
            {"GOOGL", "SELL", "80", "142.00", "18"},
            {"TSLA", "BUY", "100", "249.00", "12"},     // covering a bit
            {"NVDA", "SELL", "20", "895.00", "6"},
            {"MSFT", "BUY", "30", "379.00", "4"},
            {"BTC-USD", "SELL", "2", "68000.00", "40"},  // even shorting BTC
            {"ETH-USD", "SELL", "10", "3480.00", "36"},
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"TSLA", "SELL", "245.00", "1.00", "15"},
            {"AAPL", "BUY", "174.00", "0.50", "15"},
            {"GME", "BUY", "26.00", "0.30", "15"},
            {"NVDA", "SELL", "880.00", "2.00", "15"},
            {"GOOGL", "SELL", "140.00", "0.30", "15"},
        });
    }

    private void seedCZ() {
        User u = createUser("cz_binance", "safu2024", "cz@binance.com",
                "Changpeng", "Zhao",
                "Founder of Binance. Funds are SAFU. Crypto maximalist. Built the largest exchange in the world.",
                "2000000.00");

        String[][] trades = {
            {"BTC-USD", "BUY", "5", "65500.00", "168"},
            {"BTC-USD", "BUY", "3", "66000.00", "150"},
            {"BTC-USD", "BUY", "4", "66800.00", "132"},
            {"BTC-USD", "BUY", "2", "67200.00", "108"},
            {"BTC-USD", "BUY", "3", "67000.00", "84"},
            {"ETH-USD", "BUY", "50", "3380.00", "160"},
            {"ETH-USD", "BUY", "30", "3400.00", "140"},
            {"ETH-USD", "BUY", "40", "3420.00", "110"},
            {"ETH-USD", "BUY", "20", "3440.00", "72"},
            {"SOL-USD", "BUY", "500", "178.00", "156"},
            {"SOL-USD", "BUY", "300", "180.00", "130"},
            {"SOL-USD", "BUY", "200", "182.50", "100"},
            {"SOL-USD", "BUY", "400", "183.00", "60"},
            {"XRP-USD", "BUY", "50000", "0.58", "148"},
            {"XRP-USD", "BUY", "30000", "0.60", "120"},
            {"AVAX-USD", "BUY", "1000", "36.00", "144"},
            {"AVAX-USD", "BUY", "800", "37.50", "100"},
            {"DOGE-USD", "BUY", "200000", "0.14", "140"},
            {"DOGE-USD", "BUY", "100000", "0.15", "96"},
            {"DOGE-USD", "SELL", "50000", "0.16", "48"},
            {"BTC-USD", "BUY", "2", "67400.00", "48"},
            {"ETH-USD", "BUY", "25", "3445.00", "36"},
            {"SOL-USD", "BUY", "150", "184.00", "24"},
            {"BTC-USD", "SELL", "1", "67800.00", "18"},  // taking some profit
            {"ETH-USD", "SELL", "15", "3460.00", "12"},
            {"PEPE-USD", "BUY", "50000000", "0.0000110", "130"},
            {"PEPE-USD", "BUY", "30000000", "0.0000118", "80"},
            {"XRP-USD", "BUY", "20000", "0.61", "36"},
            {"AVAX-USD", "BUY", "500", "38.00", "20"},
            {"SOL-USD", "SELL", "100", "185.00", "8"},
            {"BTC-USD", "BUY", "1", "67300.00", "4"},
            {"DOGE-USD", "BUY", "100000", "0.155", "6"},
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"BTC-USD", "BUY", "64000.00", "200.00", "15"},
            {"ETH-USD", "BUY", "3350.00", "15.00", "15"},
            {"SOL-USD", "BUY", "175.00", "1.00", "15"},
            {"DOGE-USD", "BUY", "0.130", "0.003", "15"},
            {"XRP-USD", "BUY", "0.560", "0.005", "15"},
            {"AVAX-USD", "BUY", "34.00", "0.50", "15"},
        });
    }

    private void seedJimSimons() {
        User u = createUser("jimsimons", "rentech1", "jim@rentech.com",
                "Jim", "Simons",
                "Renaissance Technologies. Medallion Fund. The greatest quant trader of all time. Math > feelings.",
                "1000000.00");

        // Jim Simons: high frequency, small positions, consistent gains across all symbols
        String[][] trades = {
            {"AAPL", "BUY", "100", "177.20", "165"}, {"AAPL", "SELL", "100", "177.80", "162"},
            {"GOOGL", "BUY", "80", "141.00", "160"}, {"GOOGL", "SELL", "80", "141.60", "157"},
            {"MSFT", "BUY", "50", "377.50", "155"}, {"MSFT", "SELL", "50", "378.20", "152"},
            {"TSLA", "BUY", "60", "247.00", "150"}, {"TSLA", "SELL", "60", "248.30", "147"},
            {"AMZN", "BUY", "70", "177.00", "145"}, {"AMZN", "SELL", "70", "177.60", "142"},
            {"BTC-USD", "BUY", "1", "66500.00", "140"}, {"BTC-USD", "SELL", "1", "67000.00", "137"},
            {"ETH-USD", "BUY", "15", "3400.00", "135"}, {"ETH-USD", "SELL", "15", "3430.00", "132"},
            {"NVDA", "BUY", "30", "885.00", "130"}, {"NVDA", "SELL", "30", "890.00", "127"},
            {"SOL-USD", "BUY", "100", "180.00", "125"}, {"SOL-USD", "SELL", "100", "183.00", "122"},
            {"GME", "BUY", "200", "27.00", "120"}, {"GME", "SELL", "200", "27.80", "117"},
            {"AAPL", "BUY", "120", "177.50", "115"}, {"AAPL", "SELL", "120", "178.10", "112"},
            {"GOOGL", "BUY", "90", "141.20", "110"}, {"GOOGL", "SELL", "90", "141.70", "107"},
            {"MSFT", "BUY", "40", "378.00", "105"}, {"MSFT", "SELL", "40", "378.80", "102"},
            {"TSLA", "BUY", "50", "248.00", "100"}, {"TSLA", "SELL", "50", "249.00", "97"},
            {"NVDA", "BUY", "25", "888.00", "95"}, {"NVDA", "SELL", "25", "891.50", "92"},
            {"BTC-USD", "BUY", "1", "67000.00", "90"}, {"BTC-USD", "SELL", "1", "67300.00", "87"},
            {"DOGE-USD", "BUY", "50000", "0.155", "85"}, {"DOGE-USD", "SELL", "50000", "0.160", "82"},
            {"XRP-USD", "BUY", "20000", "0.600", "80"}, {"XRP-USD", "SELL", "20000", "0.615", "77"},
            {"AAPL", "BUY", "80", "178.00", "72"}, {"AAPL", "SELL", "80", "178.40", "70"},
            {"ETH-USD", "BUY", "10", "3430.00", "60"}, {"ETH-USD", "SELL", "10", "3450.00", "58"},
            {"SOL-USD", "BUY", "80", "183.00", "48"}, {"SOL-USD", "SELL", "80", "184.50", "45"},
            {"NVDA", "BUY", "20", "890.00", "36"}, {"NVDA", "SELL", "20", "892.00", "33"},
            {"GOOGL", "BUY", "60", "141.50", "24"}, {"GOOGL", "SELL", "60", "142.00", "20"},
            {"MSFT", "BUY", "30", "378.50", "12"}, {"MSFT", "SELL", "30", "379.00", "8"},
            {"AAPL", "BUY", "50", "178.20", "4"},
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"AAPL", "BUY", "176.00", "0.30", "10"},
            {"GOOGL", "BUY", "140.00", "0.20", "10"},
            {"MSFT", "BUY", "376.00", "0.40", "10"},
            {"NVDA", "BUY", "884.00", "1.50", "10"},
            {"BTC-USD", "BUY", "65000.00", "300.00", "10"},
            {"ETH-USD", "BUY", "3380.00", "10.00", "10"},
        });
    }

    private void seedMichaelSaylor() {
        User u = createUser("msaylor", "btcmaxi1", "saylor@microstrategy.com",
                "Michael", "Saylor",
                "MicroStrategy CEO. Converted corporate treasury to BTC. Laser eyes. Bitcoin is digital gold. There is no second best.",
                "5000000.00");

        String[][] trades = {
            {"BTC-USD", "BUY", "10", "64000.00", "168"},
            {"BTC-USD", "BUY", "8", "64500.00", "156"},
            {"BTC-USD", "BUY", "12", "65000.00", "144"},
            {"BTC-USD", "BUY", "5", "65800.00", "132"},
            {"BTC-USD", "BUY", "7", "66200.00", "120"},
            {"BTC-USD", "BUY", "6", "66500.00", "108"},
            {"BTC-USD", "BUY", "4", "66800.00", "96"},
            {"BTC-USD", "BUY", "8", "67000.00", "84"},
            {"BTC-USD", "BUY", "3", "67200.00", "72"},
            {"BTC-USD", "BUY", "5", "67100.00", "60"},  // bought the dip
            {"BTC-USD", "BUY", "4", "67300.00", "48"},
            {"BTC-USD", "BUY", "6", "67400.00", "36"},
            {"BTC-USD", "BUY", "3", "67500.00", "24"},
            {"BTC-USD", "BUY", "2", "67600.00", "12"},
            {"BTC-USD", "BUY", "1", "67800.00", "4"},   // still buying
            {"ETH-USD", "BUY", "20", "3400.00", "140"}, // tiny ETH position "just in case"
            {"ETH-USD", "BUY", "10", "3430.00", "80"},
            // Never sells. Ever. Diamond hands on steroids.
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"BTC-USD", "BUY", "60000.00", "500.00", "30"},  // 30 buy orders stacked deep
        });
    }

    private void seedVitalikButerin() {
        User u = createUser("vbuterin", "ethereum", "vitalik@ethereum.org",
                "Vitalik", "Buterin",
                "Ethereum co-founder. Proof of Stake believer. Thinks in gas fees. Writes whitepapers in the shower.",
                "800000.00");

        String[][] trades = {
            {"ETH-USD", "BUY", "100", "3350.00", "168"},
            {"ETH-USD", "BUY", "80", "3380.00", "150"},
            {"ETH-USD", "BUY", "60", "3400.00", "132"},
            {"ETH-USD", "BUY", "50", "3420.00", "110"},
            {"ETH-USD", "BUY", "40", "3440.00", "84"},
            {"ETH-USD", "SELL", "20", "3460.00", "60"},  // donating to public goods
            {"ETH-USD", "BUY", "30", "3430.00", "48"},
            {"ETH-USD", "BUY", "25", "3445.00", "24"},
            {"SOL-USD", "BUY", "200", "178.00", "156"},   // checking out the competition
            {"SOL-USD", "BUY", "150", "181.00", "120"},
            {"SOL-USD", "SELL", "100", "183.50", "72"},
            {"AVAX-USD", "BUY", "500", "35.00", "148"},
            {"AVAX-USD", "BUY", "300", "37.00", "110"},
            {"AVAX-USD", "SELL", "200", "38.00", "60"},
            {"XRP-USD", "BUY", "10000", "0.580", "140"},  // diversifying L1s
            {"XRP-USD", "SELL", "5000", "0.610", "80"},
            {"BTC-USD", "BUY", "2", "66000.00", "130"},   // respects BTC
            {"BTC-USD", "BUY", "1", "67000.00", "72"},
            {"DOGE-USD", "BUY", "100000", "0.140", "100"}, // Elon keeps shilling
            {"DOGE-USD", "SELL", "80000", "0.158", "50"},
            {"ETH-USD", "BUY", "35", "3448.00", "36"},
            {"SOL-USD", "BUY", "100", "184.00", "18"},
            {"ETH-USD", "BUY", "20", "3450.00", "8"},
            {"AVAX-USD", "BUY", "200", "38.20", "12"},
            {"PEPE-USD", "BUY", "20000000", "0.0000115", "96"},  // for the memes
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"ETH-USD", "BUY", "3300.00", "20.00", "15"},
            {"SOL-USD", "BUY", "172.00", "1.00", "10"},
            {"AVAX-USD", "BUY", "33.00", "0.50", "10"},
            {"XRP-USD", "BUY", "0.550", "0.005", "10"},
        });
    }

    private void seed0xj4f() {
        User u = createUser("0xj4f", "vulntrade", "0xj4f@proton.me",
                "j4f", "0x",
                "Creator of VulnTrade. DevSecOps engineer. Eats bugs for breakfast. github.com/0xj4f -- FLAG{0xj4f_w4s_h3r3_bu1ld1ng_vuln5}",
                "250000.00");

        String[][] trades = {
            {"VULN", "BUY", "10000", "38.00", "168"},  // insider whale on VULN
            {"VULN", "BUY", "8000", "39.50", "150"},
            {"VULN", "BUY", "5000", "40.00", "132"},
            {"VULN", "BUY", "12000", "40.50", "110"},
            {"VULN", "BUY", "6000", "41.00", "84"},
            {"VULN", "BUY", "3000", "41.50", "60"},
            {"VULN", "BUY", "2000", "41.80", "36"},
            {"VULN", "SELL", "1000", "42.00", "24"},    // just testing the system ;)
            {"BTC-USD", "BUY", "1", "66500.00", "160"},
            {"BTC-USD", "BUY", "1", "67000.00", "96"},
            {"ETH-USD", "BUY", "10", "3400.00", "140"},
            {"ETH-USD", "BUY", "5", "3430.00", "72"},
            {"SOL-USD", "BUY", "50", "180.00", "120"},
            {"AAPL", "BUY", "100", "177.00", "100"},
            {"NVDA", "BUY", "20", "885.00", "80"},
            {"DOGE-USD", "BUY", "100000", "0.145", "110"},
            {"DOGE-USD", "SELL", "50000", "0.160", "48"},
            {"PEPE-USD", "BUY", "100000000", "0.0000100", "130"},  // 100M PEPE yolo
            {"PEPE-USD", "BUY", "50000000", "0.0000115", "60"},
            {"GME", "BUY", "200", "27.00", "90"},
            {"GME", "SELL", "100", "28.20", "40"},
            {"VULN", "BUY", "5000", "41.90", "12"},
            {"VULN", "BUY", "3000", "42.00", "4"},      // keep stacking VULN
            {"BTC-USD", "SELL", "0.5", "67500.00", "8"},  // taking some BTC profit
            {"XRP-USD", "BUY", "20000", "0.600", "50"},
            {"AVAX-USD", "BUY", "200", "37.00", "70"},
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"VULN", "BUY", "39.00", "0.30", "15"},
            {"BTC-USD", "BUY", "64000.00", "300.00", "10"},
            {"ETH-USD", "BUY", "3350.00", "15.00", "10"},
            {"PEPE-USD", "BUY", "0.0000090", "0.0000002", "10"},
        });
    }

    private void seedSatoshiNakamoto() {
        User u = createUser("satoshi", "nakamoto1", "satoshi@gmx.de",
                "Satoshi", "Nakamoto",
                "Creator of Bitcoin. Identity unknown. Disappeared in 2011. Holds ~1M BTC. This account is probably not real.",
                "10000000.00");

        // Very few but massive BTC trades - mysterious and deliberate
        String[][] trades = {
            {"BTC-USD", "BUY", "50", "64000.00", "168"},
            {"BTC-USD", "BUY", "30", "65000.00", "144"},
            {"BTC-USD", "BUY", "20", "66000.00", "120"},
            {"BTC-USD", "BUY", "25", "66500.00", "96"},
            {"BTC-USD", "BUY", "15", "67000.00", "72"},
            {"BTC-USD", "BUY", "10", "67300.00", "48"},
            // Never sells. The OG hodler.
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"BTC-USD", "BUY", "55000.00", "1000.00", "30"},  // 30 massive buy orders all the way down
        });
    }

    private void seedJimCramer() {
        User u = createUser("jimcramer", "inverse1", "cramer@cnbc.com",
                "Jim", "Cramer",
                "CNBC Mad Money host. Every pick goes the wrong way. The Inverse Cramer ETF should be real. BEAR STEARNS IS FINE!",
                "200000.00");

        // Jim Cramer: buys at absolute tops, sells at absolute bottoms. Every. Single. Time.
        String[][] trades = {
            // Bought TSLA at the top, it crashed
            {"TSLA", "BUY", "100", "262.00", "168"},    // bought the absolute top
            {"TSLA", "BUY", "80", "260.00", "150"},
            {"TSLA", "BUY", "60", "258.00", "132"},     // averaging up like a genius
            {"TSLA", "BUY", "50", "256.00", "110"},
            {"TSLA", "SELL", "30", "249.00", "72"},      // panic sold at bottom
            // Bought NVDA after it peaked
            {"NVDA", "BUY", "30", "920.00", "160"},     // NVDA to the moon!!1!
            {"NVDA", "BUY", "25", "915.00", "140"},
            {"NVDA", "BUY", "20", "910.00", "120"},
            {"NVDA", "SELL", "10", "893.00", "48"},      // maybe AI is overhyped?
            // Sold DOGE before the pump
            {"DOGE-USD", "BUY", "200000", "0.180", "156"},  // bought the top
            {"DOGE-USD", "SELL", "200000", "0.140", "100"}, // sold the bottom
            {"DOGE-USD", "BUY", "100000", "0.170", "60"},   // bought back higher
            // GME disaster
            {"GME", "BUY", "300", "34.00", "148"},       // buy buy buy!!
            {"GME", "BUY", "200", "32.00", "120"},
            {"GME", "SELL", "400", "27.50", "48"},        // sold at the very bottom
            {"GME", "BUY", "100", "29.00", "24"},         // bought back after it bounced
            // AAPL - even managed to lose on AAPL
            {"AAPL", "BUY", "200", "182.00", "144"},
            {"AAPL", "BUY", "150", "181.00", "120"},
            {"AAPL", "SELL", "200", "176.50", "48"},      // panic sold the dip
            {"AAPL", "BUY", "100", "179.00", "24"},       // bought back higher
            // MSFT blunder
            {"MSFT", "BUY", "60", "385.00", "136"},
            {"MSFT", "BUY", "40", "383.00", "108"},
            {"MSFT", "SELL", "80", "378.00", "36"},       // sold right before earnings beat
            // SOL - sold before the pump
            {"SOL-USD", "BUY", "100", "190.00", "130"},   // bought the top
            {"SOL-USD", "SELL", "100", "180.00", "60"},    // sold the bottom
            // PEPE disaster - the final meme
            {"PEPE-USD", "BUY", "50000000", "0.0000140", "110"},  // "this meme coin is going places"
            {"PEPE-USD", "SELL", "50000000", "0.0000100", "50"},   // "meme coins are dead"
            {"BTC-USD", "BUY", "1", "68500.00", "96"},    // bought BTC at the exact local top
            {"BTC-USD", "SELL", "1", "66000.00", "36"},    // sold at the exact local bottom
            {"AMZN", "BUY", "100", "181.00", "128"},
            {"AMZN", "SELL", "100", "176.00", "40"},
            {"XRP-USD", "BUY", "30000", "0.650", "100"},  // bought XRP top
            {"XRP-USD", "SELL", "30000", "0.590", "36"},   // sold XRP bottom
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"TSLA", "BUY", "252.00", "0.80", "10"},   // still buying TSLA dips
            {"NVDA", "BUY", "896.00", "1.50", "10"},
            {"AAPL", "BUY", "179.00", "0.30", "10"},
            {"GME", "BUY", "28.50", "0.20", "10"},
            {"DOGE-USD", "BUY", "0.160", "0.002", "10"},
        });
    }

    private void seedCathieWood() {
        User u = createUser("cathiewood", "arkinvest", "cathie@ark-invest.com",
                "Cathie", "Wood",
                "ARK Invest CEO. Innovation is undervalued. TSLA to $2000. Disruption or die. 5-year time horizon on everything.",
                "800000.00");

        String[][] trades = {
            {"TSLA", "BUY", "200", "245.00", "168"},
            {"TSLA", "BUY", "150", "247.00", "144"},
            {"TSLA", "BUY", "100", "249.00", "120"},
            {"TSLA", "BUY", "80", "250.00", "96"},
            {"TSLA", "BUY", "60", "248.00", "60"},
            {"NVDA", "BUY", "50", "880.00", "160"},
            {"NVDA", "BUY", "40", "885.00", "136"},
            {"NVDA", "BUY", "30", "890.00", "100"},
            {"NVDA", "SELL", "20", "895.00", "48"},
            {"SOL-USD", "BUY", "300", "175.00", "152"},
            {"SOL-USD", "BUY", "200", "180.00", "120"},
            {"SOL-USD", "BUY", "150", "183.00", "72"},
            {"DOGE-USD", "BUY", "300000", "0.140", "148"},
            {"DOGE-USD", "BUY", "200000", "0.150", "100"},
            {"DOGE-USD", "SELL", "100000", "0.160", "48"},
            {"BTC-USD", "BUY", "2", "65000.00", "140"},
            {"BTC-USD", "BUY", "1", "67000.00", "80"},
            {"ETH-USD", "BUY", "20", "3380.00", "130"},
            {"ETH-USD", "BUY", "15", "3420.00", "72"},
            {"AAPL", "BUY", "100", "176.50", "110"},
            {"AAPL", "SELL", "100", "178.00", "48"},    // sold AAPL - too boring
            {"PEPE-USD", "BUY", "30000000", "0.0000110", "90"},  // innovation in memes
            {"GME", "BUY", "200", "26.00", "80"},
            {"GME", "BUY", "100", "27.50", "36"},
            {"AVAX-USD", "BUY", "300", "36.00", "100"},
            {"AVAX-USD", "BUY", "200", "37.50", "48"},
            {"TSLA", "BUY", "50", "248.50", "24"},
            {"NVDA", "BUY", "20", "891.00", "12"},
            {"SOL-USD", "BUY", "100", "184.50", "8"},
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"TSLA", "BUY", "240.00", "1.00", "15"},
            {"NVDA", "BUY", "875.00", "2.00", "10"},
            {"SOL-USD", "BUY", "170.00", "1.00", "10"},
            {"DOGE-USD", "BUY", "0.130", "0.003", "10"},
        });
    }

    private void seedWarrenBuffett() {
        User u = createUser("wbuffett", "berkshire", "warren@berkshire.com",
                "Warren", "Buffett",
                "Oracle of Omaha. Berkshire Hathaway. Be greedy when others are fearful. Never invested in crypto. Loves Coca-Cola.",
                "3000000.00");

        // Conservative, value-oriented, huge AAPL position
        String[][] trades = {
            {"AAPL", "BUY", "500", "175.00", "168"},
            {"AAPL", "BUY", "400", "176.00", "150"},
            {"AAPL", "BUY", "300", "176.50", "132"},
            {"AAPL", "BUY", "200", "177.00", "110"},
            {"AAPL", "BUY", "150", "177.50", "84"},
            {"AAPL", "BUY", "100", "178.00", "48"},
            {"MSFT", "BUY", "100", "375.00", "160"},
            {"MSFT", "BUY", "80", "377.00", "130"},
            {"MSFT", "BUY", "60", "378.00", "96"},
            {"AMZN", "BUY", "150", "175.00", "152"},
            {"AMZN", "BUY", "100", "176.50", "120"},
            {"AMZN", "BUY", "80", "177.00", "80"},
            {"GOOGL", "BUY", "200", "140.00", "148"},
            {"GOOGL", "BUY", "150", "141.00", "116"},
            {"GOOGL", "BUY", "100", "141.50", "72"},
            {"NVDA", "BUY", "30", "880.00", "100"},     // dipping toes in tech
            {"NVDA", "BUY", "20", "888.00", "48"},
            {"AAPL", "BUY", "100", "178.20", "36"},     // can't stop buying AAPL
            {"MSFT", "BUY", "40", "378.50", "24"},
            {"AMZN", "BUY", "60", "177.80", "12"},
            {"GOOGL", "BUY", "80", "141.60", "8"},
            // No crypto. Never. "Rat poison squared."
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"AAPL", "BUY", "172.00", "0.50", "15"},
            {"MSFT", "BUY", "372.00", "0.80", "10"},
            {"AMZN", "BUY", "173.00", "0.50", "10"},
            {"GOOGL", "BUY", "138.00", "0.30", "10"},
        });
    }

    private void seedElonMusk() {
        User u = createUser("elonmusk", "mars2024", "elon@x.com",
                "Elon", "Musk",
                "CEO of Tesla, SpaceX, X. Doge father. Meme lord. Posts at 3am. Probably shitposting right now.",
                "1500000.00");

        String[][] trades = {
            {"TSLA", "BUY", "300", "244.00", "168"},
            {"TSLA", "BUY", "200", "246.00", "144"},
            {"TSLA", "BUY", "150", "248.00", "120"},
            {"TSLA", "BUY", "100", "250.00", "84"},
            {"TSLA", "SELL", "50", "249.00", "48"},     // exercising options
            {"DOGE-USD", "BUY", "500000", "0.130", "160"},  // DOGE to the moon
            {"DOGE-USD", "BUY", "300000", "0.145", "130"},
            {"DOGE-USD", "BUY", "200000", "0.155", "96"},
            {"DOGE-USD", "BUY", "100000", "0.160", "48"},
            {"DOGE-USD", "SELL", "100000", "0.163", "24"},
            {"GME", "BUY", "500", "26.00", "152"},       // retail solidarity
            {"GME", "BUY", "300", "27.00", "120"},
            {"GME", "SELL", "200", "28.00", "60"},
            {"PEPE-USD", "BUY", "200000000", "0.0000095", "148"},  // 200M PEPE why not
            {"PEPE-USD", "BUY", "100000000", "0.0000110", "100"},
            {"PEPE-USD", "SELL", "50000000", "0.0000125", "36"},
            {"BTC-USD", "BUY", "3", "65500.00", "140"},
            {"BTC-USD", "BUY", "2", "67000.00", "72"},
            {"BTC-USD", "SELL", "1", "67500.00", "24"},
            {"ETH-USD", "BUY", "15", "3400.00", "110"},
            {"SOL-USD", "BUY", "100", "180.00", "100"},
            {"SOL-USD", "BUY", "50", "183.00", "48"},
            {"TSLA", "BUY", "80", "248.50", "36"},
            {"DOGE-USD", "BUY", "200000", "0.158", "12"},
            {"NVDA", "BUY", "20", "890.00", "60"},
            {"XRP-USD", "BUY", "50000", "0.600", "80"},
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"TSLA", "BUY", "240.00", "1.00", "10"},
            {"DOGE-USD", "BUY", "0.120", "0.003", "15"},
            {"GME", "BUY", "24.00", "0.30", "10"},
            {"PEPE-USD", "BUY", "0.0000080", "0.0000002", "10"},
            {"BTC-USD", "BUY", "63000.00", "500.00", "10"},
        });
    }

    private void seedDFV() {
        User u = createUser("dfv_kitty", "gme4ever", "dfv@reddit.com",
                "Keith", "Gill",
                "DeepFuckingValue. Roaring Kitty. Turned $53k into $48M on GME. Diamond hands. I like the stock.",
                "500000.00");

        // Massive GME position, some AAPL. Never sells GME.
        String[][] trades = {
            {"GME", "BUY", "2000", "24.00", "168"},
            {"GME", "BUY", "1500", "25.00", "156"},
            {"GME", "BUY", "1000", "25.50", "144"},
            {"GME", "BUY", "800", "26.00", "132"},
            {"GME", "BUY", "600", "26.50", "120"},
            {"GME", "BUY", "500", "27.00", "108"},
            {"GME", "BUY", "400", "27.50", "96"},
            {"GME", "BUY", "300", "27.80", "84"},
            {"GME", "BUY", "200", "28.00", "72"},
            {"GME", "BUY", "200", "28.20", "60"},
            {"GME", "BUY", "150", "28.00", "48"},
            {"GME", "BUY", "100", "28.30", "36"},
            {"GME", "BUY", "100", "28.50", "24"},
            {"GME", "BUY", "50", "28.40", "12"},
            // Never. Sells. Diamond. Hands.
            {"AAPL", "BUY", "200", "176.00", "160"},
            {"AAPL", "BUY", "100", "177.50", "120"},
            {"AAPL", "BUY", "80", "178.00", "72"},
            {"AAPL", "SELL", "50", "178.50", "36"},     // only sells AAPL, never GME
            {"DOGE-USD", "BUY", "100000", "0.150", "100"},
            {"DOGE-USD", "BUY", "50000", "0.155", "48"},
        };
        executeTrades(u, trades);
        seedOpenLimitOrders(u, new String[][]{
            {"GME", "BUY", "22.00", "0.30", "30"},    // 30 buy orders stacked on GME
            {"AAPL", "BUY", "174.00", "0.40", "10"},
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

        // Initial deposit transaction
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

    /**
     * Execute a batch of trades for a trader.
     * Each trade creates: buy order, sell order, trade record, 2 transactions.
     * Admin acts as counterparty.
     */
    private void executeTrades(User trader, String[][] trades) {
        Long traderId = trader.getId();
        Long adminId = admin.getId();
        BigDecimal runningBalance = trader.getBalance();

        for (String[] t : trades) {
            String symbol = t[0];
            String side = t[1];  // BUY or SELL from trader's perspective
            BigDecimal qty = new BigDecimal(t[2]);
            BigDecimal price = new BigDecimal(t[3]);
            int hoursAgo = Integer.parseInt(t[4]);
            LocalDateTime when = LocalDateTime.now().minusHours(hoursAgo);
            BigDecimal tradeValue = qty.multiply(price);

            // Create trader's order (FILLED)
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

            // Create admin counterparty order (FILLED)
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

            // Create trade record
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

            // Update running balance
            if (side.equals("BUY")) {
                runningBalance = runningBalance.subtract(tradeValue);
            } else {
                runningBalance = runningBalance.add(tradeValue);
            }

            // Transaction for trader
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

        // Update trader's final balance
        trader.setBalance(runningBalance);
        userRepository.save(trader);

        // Build and save positions from trade history
        buildPositions(trader, trades);
    }

    /**
     * Compute net positions from trade history and save them.
     */
    private void buildPositions(User trader, String[][] trades) {
        // Accumulate: symbol -> {netQty, totalCost}
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
                // Reduce position
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
            pos.setQuantity(q.abs());  // positions stored as absolute value
            pos.setAvgPrice(avgPrice.abs());
            pos.setUpdatedAt(LocalDateTime.now());
            positionRepository.save(pos);
        }
    }

    /**
     * Seed open limit orders for a trader.
     * Each entry: {symbol, side, basePrice, priceStep, count}
     */
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

                // Vary quantity a bit for realism
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
