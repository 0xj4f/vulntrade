package com.vulntrade.config;

import com.vulntrade.model.Order;
import com.vulntrade.model.Position;
import com.vulntrade.model.User;
import com.vulntrade.repository.OrderRepository;
import com.vulntrade.repository.PositionRepository;
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
                                       OrderRepository orderRepository) {
        return args -> {
            if (userRepository.count() == 0) {
                System.out.println("[INIT] Seeding default users...");

                // Admin user - admin/admin123 (weak creds intentional)
                User admin = new User();
                admin.setUsername("admin");
                admin.setPasswordHash(passwordEncoder.encode("admin123"));
                admin.setEmail("admin@vulntrade.local");
                admin.setRole("ADMIN");
                admin.setBalance(new java.math.BigDecimal("1000000.00"));
                admin.setApiKey("vt-api-key-12345-not-so-secret");
                admin.setIsActive(true);
                admin.setNotes("Admin account. FLAG{1d0r_4dm1n_pr0f1l3_n0t3s} - TODO: move this to a secure location");
                admin = userRepository.save(admin);

                // Trader 1 - trader1/password
                User trader1 = new User();
                trader1.setUsername("trader1");
                trader1.setPasswordHash(passwordEncoder.encode("password"));
                trader1.setEmail("trader1@vulntrade.local");
                trader1.setRole("TRADER");
                trader1.setBalance(new java.math.BigDecimal("50000.00"));
                trader1.setApiKey("vt-api-trader1-key");
                trader1.setIsActive(true);
                trader1.setNotes("Test trader account 1");
                userRepository.save(trader1);

                // Trader 2 - trader2/password
                User trader2 = new User();
                trader2.setUsername("trader2");
                trader2.setPasswordHash(passwordEncoder.encode("password"));
                trader2.setEmail("trader2@vulntrade.local");
                trader2.setRole("TRADER");
                trader2.setBalance(new java.math.BigDecimal("75000.00"));
                trader2.setApiKey("vt-api-trader2-key");
                trader2.setIsActive(true);
                trader2.setNotes("Test trader account 2 - has secret portfolio FLAG{h0r1z0nt4l_pr1v3sc_p0rtf0l10}");
                userRepository.save(trader2);

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

                System.out.println("[INIT] Seeded 4 users: admin, trader1, trader2, apiuser");

                // ========================================================
                // Seed admin (house) positions and sell orders
                // so new traders can buy immediately after registering
                // ========================================================
                seedHouseInventory(admin, positionRepository, orderRepository);

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
        Object[][] inventory = {
            {"AAPL",    10000, "178.55", "0.10"},
            {"GOOGL",   10000, "141.85", "0.10"},
            {"MSFT",    10000, "378.95", "0.15"},
            {"TSLA",    10000, "248.60", "0.20"},
            {"AMZN",    10000, "178.30", "0.10"},
            {"BTC-USD",  500,  "67510.00", "50.00"},
            {"ETH-USD",  5000, "3452.00", "5.00"},
            {"VULN",    50000, "42.05", "0.05"},
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

            // Place 5 sell orders at increasing price levels
            // This gives the order book depth so traders can buy at various prices
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

            System.out.println("[INIT] Seeded " + symbol + ": position=" + qty
                    + ", 5 sell orders starting @ " + basePrice);
        }

        System.out.println("[INIT] House inventory and order book seeded.");
    }
}
