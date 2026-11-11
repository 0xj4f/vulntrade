package com.vulntrade.config;

import com.vulntrade.model.Order;
import com.vulntrade.model.Position;
import com.vulntrade.model.Trade;
import com.vulntrade.model.Transaction;
import com.vulntrade.model.User;
import com.vulntrade.money.Accounts;
import com.vulntrade.money.Balances;
import com.vulntrade.money.Ledger;
import com.vulntrade.service.TransferService;
import com.vulntrade.repository.OrderRepository;
import com.vulntrade.repository.PositionRepository;
import com.vulntrade.repository.TradeRepository;
import com.vulntrade.repository.TransactionRepository;
import com.vulntrade.repository.UserRepository;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Configuration
public class DataInitializer {

    /**
     * Seeds users with properly BCrypt-encoded passwords.
     * Only runs if users table is empty (init.sql creates schema, this seeds users).
     */
    @Bean
    public CommandLineRunner seedUsers(UserRepository userRepository,
                                       PasswordEncoder passwordEncoder,
                                       PositionRepository positionRepository,
                                       OrderRepository orderRepository,
                                       TransactionRepository transactionRepository,
                                       TradeRepository tradeRepository,
                                       Accounts accounts,
                                       Balances balances,
                                       Ledger ledger,
                                       JdbcTemplate jdbc,
                                       SeedStatus seedStatus,
                                       TransferService transferService) {
        return args -> {
            seedOldData(userRepository, passwordEncoder, positionRepository, orderRepository,
                    transactionRepository, tradeRepository);
            seedAccounts(userRepository, accounts, balances, ledger, jdbc, transferService);
            seedStatus.markReady();
        };
    }

    // ================================================================
    // 1.0.0: accounts per product, house money, order ownership
    // ================================================================

    /** The house (admin, user 1) trading money per product service. Seeded once (keyed on HOUSE_SEED rows). */
    private static final Object[][] HOUSE_MONEY = {
        {Accounts.EQUITIES, "USD", "1000000000"},
        {Accounts.CRYPTO,   "USD", "1000000000"},
        {Accounts.FX,       "USD", "100000000"},
        {Accounts.FX,       "EUR", "100000000"},
        {Accounts.FX,       "GBP", "100000000"},
        {Accounts.FX,       "JPY", "15000000000"},
    };
    private static final long HOUSE_USER_ID = 1L;

    /**
     * Every seeded user gets MAIN + FX + EQUITIES + CRYPTO. Safe to run on every start.
     *
     * Seeded users get no demo deposit (that is for new sign-ups, see AuthController.register):
     * instead a quarter of their own MAIN cash (max 10,000) is TRANSFERRED to each product account.
     * A transfer is not capital, so the seeded leaderboard ROIs stay exactly as in 0.6.0.
     * The house gets its trading money per product instead (HOUSE_MONEY).
     */
    private void seedAccounts(UserRepository userRepository, Accounts accounts, Balances balances,
                              Ledger ledger, JdbcTemplate jdbc, TransferService transferService) {
        for (User u : userRepository.findAll()) {
            boolean fresh = accounts.openAll(u.getId(), false);
            if (fresh && u.getId() != HOUSE_USER_ID) {
                BigDecimal main = userRepository.findBalanceById(u.getId());
                BigDecimal each = main == null ? BigDecimal.ZERO
                        : main.divide(BigDecimal.valueOf(4), 0, java.math.RoundingMode.DOWN).min(Accounts.DEMO_FUNDS);
                if (each.signum() > 0) {
                    for (String product : Accounts.PRODUCTS) {
                        transferService.transfer(u.getId(), Accounts.MAIN, product, each);
                    }
                }
            }
        }
        // Crypto is money, not shares (1.0.0): seeded coin positions become CRYPTO balances
        for (java.util.Map<String, Object> p : jdbc.queryForList("SELECT p.id, p.user_id, p.symbol, p.quantity "
                + "FROM positions p JOIN symbols s ON s.symbol = p.symbol WHERE s.asset_class = 'CRYPTO'")) {
            Long userId = ((Number) p.get("user_id")).longValue();
            String coin = ((String) p.get("symbol")).split("-")[0];
            BigDecimal qty = (BigDecimal) p.get("quantity");
            if (qty.signum() > 0) {
                balances.credit(accounts.find(userId, Accounts.CRYPTO), coin, qty);
            }
            jdbc.update("DELETE FROM positions WHERE id = ?", p.get("id"));
        }
        for (Object[] m : HOUSE_MONEY) {
            String product = (String) m[0], asset = (String) m[1];
            Long accountId = accounts.find(HOUSE_USER_ID, product);
            Integer already = jdbc.queryForObject("SELECT COUNT(*) FROM transactions WHERE user_id = ? "
                    + "AND account_id = ? AND asset = ? AND type = 'HOUSE_SEED'", Integer.class, HOUSE_USER_ID, accountId, asset);
            if (accountId != null && already != null && already == 0) {
                BigDecimal amount = new BigDecimal((String) m[2]);
                BigDecimal after = balances.credit(accountId, asset, amount);
                ledger.record(HOUSE_USER_ID, accountId, asset, "HOUSE_SEED", amount, after,
                        "House trading money for " + product, null);
            }
        }
        // Every order belongs to the product service of its symbol
        jdbc.update("UPDATE orders o SET product = CASE s.asset_class WHEN 'CRYPTO' THEN 'CRYPTO' "
                + "WHEN 'FX' THEN 'FX' ELSE 'EQUITIES' END FROM symbols s WHERE s.symbol = o.symbol AND o.product IS NULL");
        jdbc.update("UPDATE trades t SET product = o.product FROM orders o WHERE o.id = t.buy_order_id AND t.product IS NULL");
        System.out.println("[INIT] Accounts ready (MAIN + FX + EQUITIES + CRYPTO per user, house money seeded).");
    }

    private void seedOldData(UserRepository userRepository,
                             PasswordEncoder passwordEncoder,
                             PositionRepository positionRepository,
                             OrderRepository orderRepository,
                             TransactionRepository transactionRepository,
                             TradeRepository tradeRepository) {
        {
            if (userRepository.count() == 0) {
                System.out.println("[INIT] Seeding default users...");

                // Admin user - admin/admin123 (weak creds intentional)
                User admin = new User();
                admin.setUsername("admin");
                admin.setPasswordHash(passwordEncoder.encode("admin123"));
                admin.setEmail("admin@vulntrade.local");
                admin.setRole("ADMIN");
                admin.setBalance(new java.math.BigDecimal("1000000000.00"));
                admin.setApiKey("vt-api-key-12345-not-so-secret");
                admin.setIsActive(true);
                admin.setNotes("Admin account. FLAG{1d0r_4dm1n_pr0f1l3_n0t3s} - TODO: move this to a secure location");
                // Account Level: admin is auto-verified
                admin.setAccountLevel(2);
                admin.setFirstName("System");
                admin.setLastName("Administrator");
                admin.setSsn("FLAG{ssn_exposed_in_jwt}");  // VULN #93/#100: flag hidden in admin SSN
                admin.setVerifiedAt(LocalDateTime.now().minusDays(365));
                admin = userRepository.save(admin);

                // Trader 1 - trader1/password
                User trader1 = new User();
                trader1.setUsername("trader1");
                trader1.setPasswordHash(passwordEncoder.encode("password"));
                trader1.setEmail("trader1@vulntrade.local");
                trader1.setRole("TRADER");
                trader1.setBalance(new java.math.BigDecimal("10000.00"));
                trader1.setApiKey("vt-api-trader1-key");
                trader1.setIsActive(true);
                trader1.setNotes("Test trader account 1");
                trader1.setAccountLevel(1);  // BASIC - needs to complete verification
                trader1 = userRepository.save(trader1);

                // Record initial signup bonus in transaction history
                Transaction t1Deposit = new Transaction();
                t1Deposit.setUserId(trader1.getId());
                t1Deposit.setType("DEPOSIT");
                t1Deposit.setAmount(new BigDecimal("10000.00"));
                t1Deposit.setBalanceAfter(new BigDecimal("10000.00"));
                t1Deposit.setDescription("Initial signup bonus");
                t1Deposit.setCreatedAt(LocalDateTime.now());
                transactionRepository.save(t1Deposit);

                // Trader 2 - trader2/password
                User trader2 = new User();
                trader2.setUsername("trader2");
                trader2.setPasswordHash(passwordEncoder.encode("password"));
                trader2.setEmail("trader2@vulntrade.local");
                trader2.setRole("TRADER");
                trader2.setBalance(new java.math.BigDecimal("50000.00"));
                trader2.setApiKey("vt-api-trader2-key");
                trader2.setIsActive(true);
                trader2.setNotes("Test trader account 2 - has secret portfolio FLAG{h0r1z0nt4l_pr1v3sc_p0rtf0l10}");
                // Account Level 2: pre-verified with full PII (VULN #96: all plaintext)
                trader2.setAccountLevel(2);
                trader2.setFirstName("Sarah");
                trader2.setLastName("Connor");
                trader2.setDateOfBirth("1965-05-13");
                trader2.setPhoneNumber("+1-555-0199");
                trader2.setSsn("987-65-4321");  // VULN #96: SSN stored in plaintext
                trader2.setAddressLine1("2309 Destino Dr");
                trader2.setCity("Los Angeles");
                trader2.setState("CA");
                trader2.setZipCode("90046");
                trader2.setCountry("US");
                trader2.setVerifiedAt(LocalDateTime.now().minusDays(30));
                trader2 = userRepository.save(trader2);

                // Record initial deposit in transaction history
                Transaction t2Deposit = new Transaction();
                t2Deposit.setUserId(trader2.getId());
                t2Deposit.setType("DEPOSIT");
                t2Deposit.setAmount(new BigDecimal("50000.00"));
                t2Deposit.setBalanceAfter(new BigDecimal("50000.00"));
                t2Deposit.setDescription("Initial signup bonus");
                t2Deposit.setCreatedAt(LocalDateTime.now());
                transactionRepository.save(t2Deposit);

                // API user - apiuser/apipass
                User apiUser = new User();
                apiUser.setUsername("apiuser");
                apiUser.setPasswordHash(passwordEncoder.encode("apipass"));
                apiUser.setEmail("api@vulntrade.local");
                apiUser.setRole("API");
                apiUser.setBalance(new java.math.BigDecimal("100000.00"));
                apiUser.setApiKey("vt-api-key-12345-not-so-secret");
                apiUser.setIsActive(true);
                apiUser.setNotes("API service account");
                userRepository.save(apiUser);

                // Developer user - dev/dev123 (debug mode account)
                User dev = new User();
                dev.setUsername("dev");
                dev.setPasswordHash(passwordEncoder.encode("dev123"));
                dev.setEmail("dev@gmail.com");
                dev.setRole("DEVELOPER");
                dev.setBalance(new java.math.BigDecimal("50000.00"));
                dev.setApiKey("vt-api-dev-key");
                dev.setIsActive(true);
                dev.setNotes("Developer debug account");
                dev.setAccountLevel(2);
                dev.setFirstName("Dev");
                dev.setLastName("User");
                dev.setVerifiedAt(LocalDateTime.now().minusDays(7));
                dev = userRepository.save(dev);

                // Record initial deposit for dev
                Transaction devDeposit = new Transaction();
                devDeposit.setUserId(dev.getId());
                devDeposit.setType("DEPOSIT");
                devDeposit.setAmount(new BigDecimal("50000.00"));
                devDeposit.setBalanceAfter(new BigDecimal("50000.00"));
                devDeposit.setDescription("Initial signup bonus");
                devDeposit.setCreatedAt(LocalDateTime.now());
                transactionRepository.save(devDeposit);

                // Seed 10 limit BUY orders for dev across symbols
                seedDevOrders(dev, orderRepository);

                System.out.println("[INIT] Seeded 5 base users: admin, trader1, trader2, apiuser, dev");

                // ========================================================
                // Seed admin (house) positions and sell orders
                // so new traders can buy immediately after registering
                // ========================================================
                seedHouseInventory(admin, positionRepository, orderRepository);

                // ========================================================
                // Seed famous traders with realistic trade histories
                // ========================================================
                seedFamousTraders(admin, passwordEncoder, userRepository,
                        orderRepository, tradeRepository, positionRepository,
                        transactionRepository);

            } else {
                System.out.println("[INIT] Users already exist, skipping seed.");
            }
        }
    }

    /**
     * Give the admin/house account inventory (positions) in every symbol.
     *
     * The house's two-sided order book is quoted live by the product market makers (tagged
     * HOUSE-MM-* ladders that follow the price). VULN is the exception: it keeps a static
     * ladder around ~100 that never moves while its price swings on a predictable sine —
     * part of the predictable-price lesson. Ladder levels are sized at 2% of the position so
     * the house always keeps free inventory and cash.
     */
    private void seedHouseInventory(User admin,
                                     PositionRepository positionRepository,
                                     OrderRepository orderRepository) {
        System.out.println("[INIT] Seeding house inventory...");

        Long adminId = admin.getId();

        // symbol, quantity held, average cost
        Object[][] inventory = {
            {"AAPL",    100000, "178.55"},
            {"GOOGL",   100000, "141.85"},
            {"MSFT",    100000, "378.95"},
            {"TSLA",    100000, "248.60"},
            {"AMZN",    100000, "178.30"},
            {"BTC-USD",  10000, "67510.00"},
            {"ETH-USD", 100000, "3452.00"},
            {"VULN",   1000000, "100.05"},
            {"SOL-USD",  50000, "185.20"},
            {"DOGE-USD", 50000000, "0.1655"},
            {"NVDA",     50000, "892.70"},
            {"XRP-USD",  10000000, "0.622"},
            {"AVAX-USD", 200000, "38.60"},
            {"PEPE-USD", 999999999, "0.00001260"},
            {"GME",      500000, "28.60"},
        };

        for (Object[] item : inventory) {
            Position pos = new Position();
            pos.setUserId(adminId);
            pos.setSymbol((String) item[0]);
            pos.setQuantity(new BigDecimal((int) item[1]));
            pos.setAvgPrice(new BigDecimal((String) item[2]));
            pos.setUpdatedAt(LocalDateTime.now());
            positionRepository.save(pos);
        }

        // VULN: static ladder (asks from 100.05, bids from 99.95, 0.05 apart), 20,000 per level.
        BigDecimal vulnLevelQty = new BigDecimal("20000");
        for (int level = 0; level < 5; level++) {
            BigDecimal offset = new BigDecimal("0.05").multiply(new BigDecimal(level));
            for (String side : new String[]{"SELL", "BUY"}) {
                Order o = new Order();
                o.setUserId(adminId);
                o.setSymbol("VULN");
                o.setSide(side);
                o.setOrderType("LIMIT");
                o.setQuantity(vulnLevelQty);
                o.setPrice("SELL".equals(side) ? new BigDecimal("100.05").add(offset) : new BigDecimal("99.95").subtract(offset));
                o.setStatus("NEW");
                o.setFilledQty(BigDecimal.ZERO);
                o.setCreatedAt(LocalDateTime.now().minusMinutes(30 - level));
                orderRepository.save(o);
            }
        }

        System.out.println("[INIT] House inventory seeded (ladders are quoted live by the market maker).");
    }

    /**
     * Seed resting limit BUY orders for the developer account across various symbols.
     */
    private void seedDevOrders(User dev, OrderRepository orderRepository) {
        Long devId = dev.getId();

        Object[][] devOrders = {
            {"AAPL",    "BUY",  "50",  "175.00"},
            {"GOOGL",   "BUY",  "30",  "139.50"},
            {"MSFT",    "BUY",  "20",  "375.00"},
            {"AMZN",    "BUY",  "40",  "176.00"},
            {"BTC-USD", "BUY",  "1",   "66000.00"},
            {"ETH-USD", "BUY",  "10",  "3400.00"},
            {"VULN",    "BUY",  "500", "75.00"},   // below the sine's 80-120 range: rests
        };

        for (int i = 0; i < devOrders.length; i++) {
            Object[] o = devOrders[i];
            Order order = new Order();
            order.setUserId(devId);
            order.setSymbol((String) o[0]);
            order.setSide((String) o[1]);
            order.setOrderType("LIMIT");
            order.setQuantity(new BigDecimal((String) o[2]));
            order.setPrice(new BigDecimal((String) o[3]));
            order.setStatus("NEW");
            order.setFilledQty(BigDecimal.ZERO);
            order.setCreatedAt(LocalDateTime.now().minusHours(24 - i * 2));
            orderRepository.save(order);
        }

        System.out.println("[INIT] Seeded " + devOrders.length + " limit orders for dev user.");
    }

    /**
     * Seed 12 famous traders with realistic trade histories spanning ~7 days.
     */
    private void seedFamousTraders(User admin, PasswordEncoder passwordEncoder,
                                    UserRepository userRepository, OrderRepository orderRepository,
                                    TradeRepository tradeRepository, PositionRepository positionRepository,
                                    TransactionRepository transactionRepository) {
        new FamousTraderSeeder(admin, passwordEncoder, userRepository, orderRepository,
                tradeRepository, positionRepository, transactionRepository).seed();
    }
}
