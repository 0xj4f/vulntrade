-- VulnTrade Seed Data
-- NOTE: Users are seeded by Spring Boot DataInitializer (proper BCrypt hashes)
-- This file seeds symbols, positions, orders, and other reference data.

-- Symbols with initial prices
INSERT INTO symbols (symbol, name, current_price, bid, ask, volume, is_tradable) VALUES
    ('AAPL', 'Apple Inc.', 178.50, 178.45, 178.55, 52345678, true),
    ('GOOGL', 'Alphabet Inc.', 141.80, 141.75, 141.85, 23456789, true),
    ('MSFT', 'Microsoft Corp.', 378.90, 378.85, 378.95, 34567890, true),
    ('TSLA', 'Tesla Inc.', 248.50, 248.40, 248.60, 98765432, true),
    ('AMZN', 'Amazon.com Inc.', 178.25, 178.20, 178.30, 45678901, true),
    ('BTC-USD', 'Bitcoin USD', 67500.00, 67490.00, 67510.00, 12345678, true),
    ('ETH-USD', 'Ethereum USD', 3450.00, 3448.00, 3452.00, 8765432, true),
    ('VULN', 'VulnCorp (Fictional)', 42.00, 41.95, 42.05, 1000000, true),
    ('SOL-USD', 'Solana USD', 185.00, 184.80, 185.20, 6543210, true),
    ('DOGE-USD', 'Dogecoin USD', 0.16500, 0.16450, 0.16550, 234567890, true),
    ('NVDA', 'NVIDIA Corp.', 892.50, 892.30, 892.70, 41234567, true),
    ('XRP-USD', 'Ripple USD', 0.62000, 0.61800, 0.62200, 87654321, true),
    ('AVAX-USD', 'Avalanche USD', 38.50, 38.40, 38.60, 5432109, true),
    ('PEPE-USD', 'Pepe USD', 0.00001250, 0.00001240, 0.00001260, 999999999, true),
    ('GME', 'GameStop Corp.', 28.50, 28.40, 28.60, 15678432, true);

-- NOTE: Positions, orders, transactions, and audit_log entries
-- are seeded by Spring Boot DataInitializer after users are created.
-- This avoids FK constraint issues with user IDs.
