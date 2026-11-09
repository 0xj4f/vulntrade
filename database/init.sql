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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Account Level fields (VULN #96: PII stored in plaintext, no encryption)
    account_level INTEGER DEFAULT 1,           -- 1=BASIC, 2=VERIFIED
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    date_of_birth VARCHAR(20),                 -- VULN: stored as VARCHAR, not DATE
    phone_number VARCHAR(30),                  -- VULN: plaintext
    ssn VARCHAR(100),                          -- VULN #96: SSN stored in PLAINTEXT
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    country VARCHAR(100),
    photo_path VARCHAR(500),                   -- VULN #95: full filesystem path stored
    photo_filename VARCHAR(255),               -- VULN #95: original filename preserved
    verified_at TIMESTAMP,
    daily_withdrawn DECIMAL(20,8) DEFAULT 0,
    daily_deposited DECIMAL(20,8) DEFAULT 0,
    last_tx_reset DATE
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
    status_reason VARCHAR(32),        -- why the engine closed it (INSUFFICIENT_FUNDS, NO_LIQUIDITY, ...)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    executed_at TIMESTAMP,
    -- 1.0.0: which product service owns the order, and the money still locked for it
    product VARCHAR(10),              -- FX / EQUITIES / CRYPTO
    hold_left DECIMAL(20,8) DEFAULT 0, -- money still held for this open order (released when it closes)
    fee DECIMAL(20,8) DEFAULT 0       -- commission / fees charged so far
);

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    buy_order_id INTEGER REFERENCES orders(id),
    sell_order_id INTEGER REFERENCES orders(id),
    symbol VARCHAR(20) NOT NULL,
    quantity DECIMAL(20,8) NOT NULL,
    price DECIMAL(20,8) NOT NULL,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    product VARCHAR(10),              -- 1.0.0: FX / EQUITIES / CRYPTO
    buy_fee DECIMAL(20,8) DEFAULT 0,  -- fee paid by the buyer (USD)
    sell_fee DECIMAL(20,8) DEFAULT 0  -- fee paid by the seller (USD)
);

-- Positions table
CREATE TABLE IF NOT EXISTS positions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    symbol VARCHAR(20) NOT NULL,
    quantity DECIMAL(20,8) DEFAULT 0,
    avg_price DECIMAL(20,8) DEFAULT 0,
    unrealized_pnl DECIMAL(20,8) DEFAULT 0,
    realized_pnl DECIMAL(20,8) DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, symbol)
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    account_id INTEGER,               -- 1.0.0: NULL = MAIN account (users.balance), else accounts.id
    asset VARCHAR(10) DEFAULT 'USD',  -- 1.0.0: USD / EUR / BTC ...
    type VARCHAR(20) NOT NULL,        -- DEPOSIT/WITHDRAW/ADJUSTMENT/TRANSFER_IN/TRANSFER_OUT/TRADE_BUY/TRADE_SELL/TRADE_LEG/HOUSE_SEED
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
    symbol VARCHAR(255) NOT NULL,     -- VULN: wide enough to store a stored-XSS payload
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
    is_tradable BOOLEAN DEFAULT true,
    asset_class VARCHAR(10)           -- 1.0.0: EQUITY / CRYPTO / FX (which product service owns it)
);

-- Password reset tokens
-- VULN: No expiry column, token is predictable (timestamp-based)
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    token VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 1.0.0: one account per product, money per account + asset
-- ============================================================

-- Every user has MAIN + FX + EQUITIES + CRYPTO. MAIN's cash stays in users.balance.
CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    product VARCHAR(10) NOT NULL,     -- MAIN / FX / EQUITIES / CRYPTO
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, product)
);

-- Money in a product account, per asset. Shares are NOT here: they stay in positions.
CREATE TABLE IF NOT EXISTS balances (
    account_id INTEGER REFERENCES accounts(id),
    asset VARCHAR(10) NOT NULL,       -- USD / EUR / GBP / JPY / BTC / ETH ...
    available DECIMAL(24,8) NOT NULL DEFAULT 0,   -- usable now
    held DECIMAL(24,8) NOT NULL DEFAULT 0,        -- locked for open orders
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (account_id, asset)
);

-- Moving money between your own accounts (MAIN <-> FX / EQUITIES / CRYPTO)
CREATE TABLE IF NOT EXISTS transfers (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    from_product VARCHAR(10) NOT NULL,
    to_product VARCHAR(10) NOT NULL,
    asset VARCHAR(10) NOT NULL,
    amount DECIMAL(24,8) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes (minimal - intentionally missing some for performance vuln)
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_symbol ON orders(symbol);
CREATE INDEX idx_trades_symbol ON trades(symbol);
CREATE INDEX idx_positions_user_id ON positions(user_id);
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_orders_product_status ON orders(product, status);   -- each product service scans its open orders
