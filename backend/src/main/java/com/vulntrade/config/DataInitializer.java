package com.vulntrade.config;

import com.vulntrade.model.User;
import com.vulntrade.repository.UserRepository;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.password.PasswordEncoder;

@Configuration
public class DataInitializer {

    /**
     * Seeds users with properly BCrypt-encoded passwords.
     * Only runs if users table is empty (init.sql creates schema, this seeds users).
     */
    @Bean
    public CommandLineRunner seedUsers(UserRepository userRepository, PasswordEncoder passwordEncoder) {
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
                userRepository.save(admin);

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
            } else {
                System.out.println("[INIT] Users already exist, skipping seed.");
            }
        };
    }
}
