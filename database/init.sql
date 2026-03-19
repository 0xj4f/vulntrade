-- VulnTrade Database Schema
-- VULN: Missing CHECK constraints, weak types, no proper indexing

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    -- VULN: no UNIQUE constraint on username (allows case-variant duplicates)
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(100),
    role VARCHAR(20) DEFAULT 'TRADER',
    balance DECIMAL(20,8) DEFAULT 0.00,
    api_key VARCHAR(64),
    -- VULN: API key stored in plaintext
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    -- Used for storing admin notes (Flag 2 location)
    profile_pic VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    symbol VARCHAR(20) NOT NULL,
    side VARCHAR(4) NOT NULL,         -- BUY/SELL
    order_type VARCHAR(10) NOT NULL,  -- LIMIT/MARKET/STOP
    quantity DECIMAL(20,8) NOT NULL,  -- VULN: no CHECK > 0
    price DECIMAL(20,8),              -- VULN: no CHECK > 0
    status VARCHAR(20) DEFAULT 'NEW', -- NEW/PARTIAL/FILLED/CANCELLED
    filled_qty DECIMAL(20,8) DEFAULT 0,
    filled_price DECIMAL(20,8),
    client_order_id VARCHAR(100),     -- VULN: not UNIQUE
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    executed_at TIMESTAMP
);

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    buy_order_id INTEGER REFERENCES orders(id),
    sell_order_id INTEGER REFERENCES orders(id),
    symbol VARCHAR(20) NOT NULL,
    quantity DECIMAL(20,8) NOT NULL,
    price DECIMAL(20,8) NOT NULL,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Positions table
CREATE TABLE IF NOT EXISTS positions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    symbol VARCHAR(20) NOT NULL,
    quantity DECIMAL(20,8) DEFAULT 0,
    avg_price DECIMAL(20,8) DEFAULT 0,
    unrealized_pnl DECIMAL(20,8) DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, symbol)
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    type VARCHAR(20) NOT NULL,        -- DEPOSIT/WITHDRAW/TRADE/ADJUSTMENT
    amount DECIMAL(20,8) NOT NULL,
    balance_after DECIMAL(20,8),
    description TEXT,
    reference_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Price alerts table
CREATE TABLE IF NOT EXISTS price_alerts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    symbol VARCHAR(20) NOT NULL,
    target_price DECIMAL(20,8) NOT NULL,
    direction VARCHAR(5) NOT NULL,    -- ABOVE/BELOW
    is_triggered BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Audit log table
-- VULN: intentionally incomplete - many actions not logged
CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,
    action VARCHAR(100),
    details TEXT,                      -- VULN: no sanitization on insert
    ip_address VARCHAR(45),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Symbols table
CREATE TABLE IF NOT EXISTS symbols (
    symbol VARCHAR(20) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    current_price DECIMAL(20,8) NOT NULL,
    bid DECIMAL(20,8),
    ask DECIMAL(20,8),
    volume BIGINT DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_tradable BOOLEAN DEFAULT true
);

-- Create indexes (minimal - intentionally missing some for performance vuln)
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_symbol ON orders(symbol);
CREATE INDEX idx_trades_symbol ON trades(symbol);
CREATE INDEX idx_positions_user_id ON positions(user_id);
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
