package com.vulntrade.repository;

import com.vulntrade.model.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByUsername(String username);

    Optional<User> findByEmail(String email);

    Optional<User> findFirstByApiKey(String apiKey);

    // VULN: Raw SQL query - SQL injection possible if called with unsanitized input
    @Query(value = "SELECT * FROM users WHERE username = ?1", nativeQuery = true)
    User findByUsernameNative(String username);

    List<User> findByRole(String role);

    List<User> findByIsActive(Boolean isActive);
}
