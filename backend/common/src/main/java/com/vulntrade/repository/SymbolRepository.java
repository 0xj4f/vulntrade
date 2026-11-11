package com.vulntrade.repository;

import com.vulntrade.model.Symbol;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface SymbolRepository extends JpaRepository<Symbol, String> {

    List<Symbol> findByIsTradable(Boolean isTradable);
}
