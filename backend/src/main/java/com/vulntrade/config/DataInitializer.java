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
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
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
                                       TradeRepository tradeRepository) {
        return args -> {
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
        };
    }

    /**
     * Give the admin/house account inventory (positions) in all symbols
     * and place SELL limit orders at various price levels.
     * This creates a functioning order book for new traders to buy into.
     */
    private void seedHouseInventory(User admin,
                                     PositionRepository positionRepository,
                                     OrderRepository orderRepository) {
        System.out.println("[INIT] Seeding house inventory and order book...");

        Long adminId = admin.getId();

        // Define house inventory: symbol, quantity held, base ask price, price step
        // House inventory — large positions so the liquidity provider can fill orders
        Object[][] inventory = {
            {"AAPL",    100000, "178.55", "0.10"},
            {"GOOGL",   100000, "141.85", "0.10"},
            {"MSFT",    100000, "378.95", "0.15"},
            {"TSLA",    100000, "248.60", "0.20"},
            {"AMZN",    100000, "178.30", "0.10"},
            {"BTC-USD",  10000, "67510.00", "50.00"},
            {"ETH-USD", 100000, "3452.00", "5.00"},
            {"VULN",   1000000, "42.05", "0.05"},
            {"SOL-USD",  50000, "185.20", "0.50"},
            {"DOGE-USD", 50000000, "0.1655", "0.0010"},
            {"NVDA",     50000, "892.70", "1.00"},
            {"XRP-USD",  10000000, "0.622", "0.005"},
            {"AVAX-USD", 200000, "38.60", "0.20"},
            {"PEPE-USD", 999999999, "0.00001260", "0.00000010"},
            {"GME",      500000, "28.60", "0.20"},
        };

        for (Object[] item : inventory) {
            String symbol = (String) item[0];
            int qty = (int) item[1];
            BigDecimal basePrice = new BigDecimal((String) item[2]);
            BigDecimal priceStep = new BigDecimal((String) item[3]);

            // Create position for admin
            Position pos = new Position();
            pos.setUserId(adminId);
            pos.setSymbol(symbol);
            pos.setQuantity(new BigDecimal(qty));
            pos.setAvgPrice(basePrice);
            pos.setUpdatedAt(LocalDateTime.now());
            positionRepository.save(pos);

            // Place 5 sell orders at increasing price levels (ask side)
            int orderQtyPerLevel = qty / 5;
            for (int level = 0; level < 5; level++) {
                BigDecimal price = basePrice.add(priceStep.multiply(new BigDecimal(level)));
                Order sellOrder = new Order();
                sellOrder.setUserId(adminId);
                sellOrder.setSymbol(symbol);
                sellOrder.setSide("SELL");
                sellOrder.setOrderType("LIMIT");
                sellOrder.setQuantity(new BigDecimal(orderQtyPerLevel));
                sellOrder.setPrice(price);
                sellOrder.setStatus("NEW");
                sellOrder.setFilledQty(BigDecimal.ZERO);
                sellOrder.setCreatedAt(LocalDateTime.now().minusMinutes(30 - level));
                orderRepository.save(sellOrder);
            }

            // Place 5 buy orders at decreasing price levels (bid side)
            // So when traders SELL, there are buy orders to match against
            BigDecimal bidBase = basePrice.subtract(priceStep.multiply(new BigDecimal(2)));
            for (int level = 0; level < 5; level++) {
                BigDecimal price = bidBase.subtract(priceStep.multiply(new BigDecimal(level)));
                Order buyOrder = new Order();
                buyOrder.setUserId(adminId);
                buyOrder.setSymbol(symbol);
                buyOrder.setSide("BUY");
                buyOrder.setOrderType("LIMIT");
                buyOrder.setQuantity(new BigDecimal(orderQtyPerLevel));
                buyOrder.setPrice(price);
                buyOrder.setStatus("NEW");
                buyOrder.setFilledQty(BigDecimal.ZERO);
                buyOrder.setCreatedAt(LocalDateTime.now().minusMinutes(30 - level));
                orderRepository.save(buyOrder);
            }

            System.out.println("[INIT] Seeded " + symbol + ": position=" + qty
                    + ", 5 sell + 5 buy orders starting @ " + basePrice);
        }

        System.out.println("[INIT] House inventory and order book seeded.");
    }

    /**
     * Seed 10 limit BUY orders for the developer account across various symbols.
     */
    private void seedDevOrders(User dev, OrderRepository orderRepository) {
        Long devId = dev.getId();

        Object[][] devOrders = {
            {"AAPL",    "BUY",  "50",  "175.00"},
            {"GOOGL",   "BUY",  "30",  "139.50"},
            {"MSFT",    "BUY",  "20",  "375.00"},
            {"TSLA",    "SELL", "15",  "252.00"},
            {"AMZN",    "BUY",  "40",  "176.00"},
            {"BTC-USD", "BUY",  "1",   "66000.00"},
            {"ETH-USD", "BUY",  "10",  "3400.00"},
            {"VULN",    "BUY",  "500", "41.00"},
            {"AAPL",    "SELL", "25",  "182.00"},
            {"GOOGL",   "SELL", "20",  "145.00"},
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

        System.out.println("[INIT] Seeded 10 limit orders for dev user.");
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
