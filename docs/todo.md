# VulnTrade - Vulnerable Trading Platform
# Build Plan & Task Breakdown

## Project Overview
A deliberately vulnerable trading application for red team training.
Covers: WebSocket/STOMP exploitation, Java backend attacks, React frontend
misconfigurations, business logic flaws, and trading-specific vulnerabilities.

---

## PHASE 1: Foundation Infrastructure (Week 1)
### Goal: Skeleton project that compiles, runs, and connects

#### 1.1 Project Scaffolding
- [ ] Initialize monorepo structure
  - [ ] /backend (Spring Boot 2.7.x - intentionally not latest)
  - [ ] /frontend (React 18 with Create React App)
  - [ ] /database (PostgreSQL init scripts)
  - [ ] /docker (Dockerfiles + docker-compose.yml)
  - [ ] /docs (architecture diagrams, vuln catalog)
- [ ] Create root docker-compose.yml
  - [ ] backend service (Java 11 - intentionally old)
  - [ ] frontend service (nginx serving React build)
  - [ ] postgres service (PostgreSQL 13)
  - [ ] redis service (for session/cache - no auth intentionally)
  - [ ] adminer service (DB admin - exposed intentionally)
- [ ] Verify `docker-compose up` brings everything online
- [ ] Create health check endpoints

#### 1.2 Database Schema
- [ ] Create init.sql with all tables
  - [ ] users (id, username, password_hash, email, role, balance, 
              created_at, is_active, api_key)
  - [ ] orders (id, user_id, symbol, side, type, quantity, price, 
                status, created_at, executed_at, filled_qty, 
                filled_price, client_order_id)
  - [ ] trades (id, buy_order_id, sell_order_id, symbol, quantity, 
                price, executed_at)
  - [ ] positions (id, user_id, symbol, quantity, avg_price, 
                   unrealized_pnl)
  - [ ] transactions (id, user_id, type, amount, balance_after, 
                      description, created_at, reference_id)
  - [ ] price_alerts (id, user_id, symbol, target_price, direction, 
                      is_triggered, created_at)
  - [ ] audit_log (id, user_id, action, details, ip_address, 
                   timestamp) -- intentionally incomplete
  - [ ] symbols (symbol, name, current_price, bid, ask, volume, 
                 last_updated, is_tradable)
- [ ] Seed data
  - [ ] Admin user: admin/admin123 (weak creds - intentional)
  - [ ] Test traders: trader1/password, trader2/password
  - [ ] API user: apiuser with hardcoded API key
  - [ ] Sample symbols: AAPL, GOOGL, MSFT, TSLA, AMZN, BTC-USD, 
        ETH-USD, VULN (fictional vulnerable stock)
  - [ ] Initial balances and positions

#### 1.3 Backend Skeleton
- [ ] Spring Boot project with dependencies:
  - [ ] spring-boot-starter-websocket
  - [ ] spring-boot-starter-security
  - [ ] spring-boot-starter-data-jpa
  - [ ] spring-boot-starter-web
  - [ ] spring-boot-starter-actuator (exposed - intentional)
  - [ ] io.jsonwebtoken:jjwt (older version - intentional)
  - [ ] log4j 2.14.1 (vulnerable version - intentional)
  - [ ] jackson-databind (older version with gadgets)
  - [ ] commons-collections 3.2.1 (deserialization gadget)
  - [ ] h2 database (console enabled - intentional)
- [ ] Basic package structure
  - [ ] com.vulntrade.config
  - [ ] com.vulntrade.controller
  - [ ] com.vulntrade.service
  - [ ] com.vulntrade.model
  - [ ] com.vulntrade.repository
  - [ ] com.vulntrade.websocket
  - [ ] com.vulntrade.security
  - [ ] com.vulntrade.util

#### 1.4 Frontend Skeleton
- [ ] Create React App with:
  - [ ] @stomp/stompjs (WebSocket client)
  - [ ] sockjs-client
  - [ ] react-router-dom
  - [ ] axios
  - [ ] chart.js / lightweight-charts (price charts)
  - [ ] react-toastify (notifications)
- [ ] Basic page structure:
  - [ ] /login
  - [ ] /register
  - [ ] /dashboard (main trading view)
  - [ ] /portfolio
  - [ ] /history
  - [ ] /account
  - [ ] /admin (hidden but accessible)

---

## PHASE 2: Authentication & User Management (Week 1-2)
### Goal: Working auth with intentional vulnerabilities

#### 2.1 Backend Auth
- [ ] JWT authentication implementation
  - [ ] VULN: JWT signed with HS256 using weak secret "vulntrade-secret"
  - [ ] VULN: Accept alg:none tokens
  - [ ] VULN: JWT contains full user object including role
  - [ ] VULN: No token expiry validation (exp claim ignored)
  - [ ] VULN: Token not invalidated on password change
- [ ] Login endpoint: POST /api/auth/login
  - [ ] VULN: Returns different error for "user not found" vs 
        "wrong password" (user enumeration)
  - [ ] VULN: No rate limiting on login attempts
  - [ ] VULN: SQL injection in username field (partial - 
        one endpoint uses raw SQL)
- [ ] Register endpoint: POST /api/auth/register
  - [ ] VULN: No email verification
  - [ ] VULN: Allows duplicate usernames with different casing
  - [ ] VULN: Mass assignment - can set role=ADMIN in registration body
- [ ] Password reset: POST /api/auth/reset
  - [ ] VULN: Predictable reset token (timestamp-based)
  - [ ] VULN: Reset token doesn't expire
- [ ] API Key auth (alternative to JWT)
  - [ ] VULN: API keys stored in plaintext in database
  - [ ] VULN: API key transmitted in URL query parameter
  - [ ] X-API-Key header also accepted

#### 2.2 Frontend Auth
- [ ] Login page
  - [ ] VULN: JWT stored in localStorage
  - [ ] VULN: Token visible in React DevTools state
  - [ ] VULN: Password sent in URL on GET request (alternate login)
- [ ] Registration page
  - [ ] VULN: Client-side only validation (min password length 
        checked in JS only)
- [ ] Auth state management
  - [ ] VULN: Role checked client-side for admin routes
  - [ ] VULN: Admin route exists at /admin, hidden from nav but 
        not protected server-side for some endpoints

#### 2.3 Session Management
- [ ] WebSocket session tracking
  - [ ] VULN: WebSocket connection doesn't re-validate JWT after 
        initial connection
  - [ ] VULN: Session ID predictable (sequential integer)
  - [ ] VULN: No concurrent session limit

---

## PHASE 3: WebSocket/STOMP Implementation (Week 2)
### Goal: Full WebSocket trading functionality with STOMP vulnerabilities

#### 3.1 WebSocket Configuration
- [ ] STOMP over WebSocket setup
  - [ ] Endpoint: /ws (WebSocket) and /ws-sockjs (SockJS fallback)
  - [ ] VULN: No Origin header validation
  - [ ] VULN: CORS allows * 
  - [ ] VULN: SockJS fallback enables additional attack surface
  - [ ] VULN: No message size limit configured
  - [ ] VULN: No connection rate limiting
  
- [ ] STOMP destination configuration
  - [ ] /app/* - application destinations (client→server)
  - [ ] /topic/* - broadcast destinations (server→all clients)
  - [ ] /user/queue/* - user-specific destinations
  - [ ] VULN: /topic/admin/* subscribable by any authenticated user
  - [ ] VULN: Missing authorization on several /app/ destinations

#### 3.2 Market Data Feed (/topic/prices)
- [ ] Price simulation engine
  - [ ] Generates realistic price movements (random walk)
  - [ ] Publishes to /topic/prices every 1 second
  - [ ] Price data format:
    ```json
    {
      "symbol": "AAPL",
      "bid": 150.25,
      "ask": 150.30,
      "last": 150.27,
      "volume": 1234567,
      "timestamp": 1234567890
    }
    ```
  - [ ] VULN: Price feed includes internal fields 
        (cost basis, market maker ID) not stripped
  - [ ] VULN: No entitlement check - all users get all symbols

#### 3.3 Order Management STOMP Endpoints
- [ ] /app/trade.placeOrder
  - [ ] Accept: {symbol, side, type, quantity, price, clientOrderId}
  - [ ] VULN: No server-side validation of quantity (accepts negative)
  - [ ] VULN: No price band validation (can buy at $0.01)
  - [ ] VULN: clientOrderId not unique-enforced (replay possible)
  - [ ] VULN: Symbol not validated - can create orders for 
        non-existent symbols
  - [ ] VULN: Balance check uses READ UNCOMMITTED isolation 
        (race condition)
  
- [ ] /app/trade.cancelOrder
  - [ ] Accept: {orderId}
  - [ ] VULN: IDOR - can cancel any user's order by ID
  - [ ] VULN: No ownership verification
  
- [ ] /app/trade.executeMarket
  - [ ] Accept: {symbol, side, quantity}
  - [ ] Immediate execution at current market price
  - [ ] VULN: No slippage protection
  - [ ] VULN: Race condition - price changes between validation 
        and execution
  - [ ] VULN: Can execute while trading is halted (halt check 
        only in limit orders)

#### 3.4 Portfolio & Account STOMP Endpoints
- [ ] /app/trade.getPortfolio
  - [ ] Returns user's positions
  - [ ] VULN: Accepts optional userId parameter - returns ANY 
        user's portfolio
  
- [ ] /app/trade.getBalance
  - [ ] Returns user's cash balance
  - [ ] VULN: Response includes internal account flags
  
- [ ] /app/trade.withdraw
  - [ ] Accept: {amount, destinationAccount}
  - [ ] VULN: 2FA check only on frontend - backend doesn't verify
  - [ ] VULN: No withdrawal rate limit
  - [ ] VULN: Negative amount = deposit (sign flip vulnerability)
  - [ ] VULN: Race condition on concurrent withdrawals 
        (double-spend)
  
- [ ] /app/trade.deposit
  - [ ] Accept: {amount, sourceAccount}
  - [ ] VULN: No verification of source - free money

- [ ] /app/trade.getHistory
  - [ ] Accept: {startDate, endDate, symbol}
  - [ ] VULN: SQL injection in date parameters (raw SQL query)
  - [ ] VULN: No pagination limit (DoS via huge date range)

- [ ] /app/trade.setAlert
  - [ ] Accept: {symbol, targetPrice, direction}
  - [ ] VULN: Stored XSS via symbol field 
        (rendered in notification)
  - [ ] VULN: No limit on number of alerts (resource exhaustion)

#### 3.5 Admin STOMP Endpoints
- [ ] /app/admin.adjustBalance
  - [ ] Accept: {userId, amount, reason}
  - [ ] VULN: Authorization check uses JWT role from token body 
        (modifiable by client)
  - [ ] VULN: Reason field logged without sanitization (log injection)
  
- [ ] /app/admin.haltTrading
  - [ ] Accept: {symbol, reason}
  - [ ] VULN: Same JWT role check vulnerability
  - [ ] VULN: Halt status stored in Redis without authentication
  
- [ ] /app/admin.setPrice
  - [ ] Accept: {symbol, price}
  - [ ] VULN: Can set arbitrary prices (market manipulation)
  - [ ] VULN: No audit trail for manual price changes

#### 3.6 Broadcast Channels
- [ ] /topic/orderbook
  - [ ] Real-time order book updates
  - [ ] VULN: Includes orderer's userId (information disclosure)
  - [ ] VULN: Shows all pending orders (front-running possible)
  
- [ ] /topic/trades
  - [ ] Broadcast executed trades
  - [ ] VULN: Includes internal trade IDs enabling IDOR
  
- [ ] /topic/admin/alerts
  - [ ] System alerts for admins
  - [ ] VULN: Subscribable by any user (no authorization)
  - [ ] Leaks internal system metrics and errors

---

## PHASE 4: Trading Engine & Business Logic (Week 2-3)
### Goal: Functional matching engine with business logic vulnerabilities

#### 4.1 Order Matching Engine
- [ ] Simple price-time priority matching
  - [ ] Match buy orders with sell orders
  - [ ] Partial fills support
  - [ ] VULN: Matching engine processes orders synchronously 
        (timing attacks possible)
  - [ ] VULN: Self-matching allowed (wash trading)
  - [ ] VULN: No circuit breaker on rapid price movement

#### 4.2 Risk Engine (Intentionally Weak)
- [ ] Pre-trade risk checks
  - [ ] Balance check: balance >= order_value
  - [ ] VULN: Check and deduction not atomic (TOCTOU)
  - [ ] VULN: Risk check skipped for "MARKET" order type
  - [ ] VULN: Max order size only checked on frontend
  - [ ] VULN: No position concentration limit
  - [ ] VULN: No notional value limit
  
- [ ] Post-trade position update
  - [ ] Update positions table after execution
  - [ ] VULN: Position can go negative (short selling without 
        authorization)
  - [ ] VULN: P&L calculation uses floating point (precision errors)

#### 4.3 Price Simulation
- [ ] Market data simulator
  - [ ] Brownian motion price model
  - [ ] Supports: AAPL, GOOGL, MSFT, TSLA, AMZN, BTC-USD, ETH-USD
  - [ ] Special symbol "VULN" with predictable price pattern
  - [ ] VULN: Price generation seed is fixed (predictable)
  - [ ] VULN: BTC-USD has no decimal precision limit

---

## PHASE 5: REST API Layer (Week 3)
### Goal: REST endpoints alongside WebSocket (additional attack surface)

#### 5.1 REST Endpoints
- [ ] GET /api/market/prices
  - [ ] Returns current prices for all symbols
  - [ ] Public endpoint (no auth required)
  
- [ ] GET /api/market/orderbook/{symbol}
  - [ ] Returns order book for symbol
  - [ ] VULN: Path traversal in symbol parameter
  
- [ ] POST /api/orders
  - [ ] Alternative order placement via REST
  - [ ] VULN: Missing CSRF protection
  - [ ] VULN: Different validation rules than WebSocket endpoint
  
- [ ] GET /api/orders/{orderId}
  - [ ] VULN: IDOR - no ownership check
  
- [ ] GET /api/users/{userId}/portfolio
  - [ ] VULN: IDOR - accessible to any authenticated user
  
- [ ] GET /api/admin/users
  - [ ] Lists all users
  - [ ] VULN: Role check in Spring Security filter can be bypassed 
        via HTTP method override (X-HTTP-Method-Override header)
  
- [ ] POST /api/admin/execute-query
  - [ ] VULN: Raw SQL execution endpoint (SQL injection playground)
  - [ ] VULN: Supposedly admin-only but broken access control
  
- [ ] GET /api/export/trades
  - [ ] Export trades to CSV
  - [ ] VULN: CSV injection (formula injection in exported data)
  - [ ] VULN: No pagination - DoS via large export

#### 5.2 Spring Actuator (Intentionally Exposed)
- [ ] /actuator/health - public
- [ ] /actuator/env - VULN: exposed, shows secrets
- [ ] /actuator/beans - VULN: exposed
- [ ] /actuator/mappings - VULN: exposed, reveals all routes
- [ ] /actuator/heapdump - VULN: exposed, leaks memory
- [ ] /actuator/configprops - VULN: exposed
- [ ] /actuator/loggers - VULN: exposed, allows log level change
- [ ] /actuator/trace - VULN: shows recent HTTP requests with headers

#### 5.3 Hidden/Debug Endpoints
- [ ] /api/debug/user-info
  - [ ] VULN: Returns full user object including password hash
- [ ] /api/debug/execute
  - [ ] VULN: Remote code execution via Runtime.exec()
  - [ ] VULN: "Protected" by hardcoded debug key in source
- [ ] /h2-console
  - [ ] VULN: H2 database console enabled, no auth

---

## PHASE 6: Frontend Vulnerabilities (Week 3-4)
### Goal: React frontend with client-side security issues

#### 6.1 Trading Dashboard
- [ ] Real-time price ticker display
  - [ ] VULN: dangerouslySetInnerHTML used for symbol names
  - [ ] VULN: Price display trusts server data without sanitization
- [ ] Order entry form
  - [ ] VULN: Client-side only validation for max order size
  - [ ] VULN: Hidden form fields contain user ID (tamperable)
- [ ] Order book display
  - [ ] Shows live order book
  - [ ] VULN: Displays order IDs enabling targeted cancellation

#### 6.2 Portfolio View
- [ ] Holdings table
  - [ ] VULN: User ID passed in API call (changeable via DevTools)
- [ ] P&L calculations
  - [ ] VULN: Calculated client-side (manipulable)

#### 6.3 Account Management
- [ ] Deposit/Withdraw
  - [ ] VULN: 2FA modal is purely decorative (no server verification)
  - [ ] VULN: Amount validation in JS only
- [ ] Profile settings
  - [ ] VULN: Can change email without verification
  - [ ] VULN: Old password not required for password change

#### 6.4 Admin Panel
- [ ] Route: /admin
  - [ ] VULN: Only hidden via conditional render, not route guard
  - [ ] VULN: All admin API calls work if you know the endpoint
- [ ] User management
- [ ] Trading halt controls
- [ ] Balance adjustment
- [ ] Manual price override

#### 6.5 Build & Deployment Vulns
- [ ] VULN: Source maps included in production build
- [ ] VULN: .env file contains API URLs and feature flags
- [ ] VULN: No CSP header configured
- [ ] VULN: No CORS restriction on API calls
- [ ] VULN: Service worker caches sensitive data

---

## PHASE 7: Docker & Deployment (Week 4)
### Goal: One-command deployment with docker-compose

#### 7.1 Docker Configuration
- [ ] Backend Dockerfile
  - [ ] Base: openjdk:11 (older, intentional)
  - [ ] VULN: Runs as root in container
  - [ ] VULN: Debug port 5005 exposed
  - [ ] VULN: JMX port exposed without auth
- [ ] Frontend Dockerfile
  - [ ] Multi-stage build (node → nginx)
  - [ ] VULN: nginx misconfigured (directory listing enabled)
  - [ ] VULN: .git directory included in build
- [ ] PostgreSQL
  - [ ] VULN: Default postgres/postgres credentials
  - [ ] VULN: Port 5432 exposed to host
- [ ] Redis
  - [ ] VULN: No authentication required
  - [ ] VULN: Port 6379 exposed to host
- [ ] docker-compose.yml
  - [ ] All services on same network
  - [ ] VULN: No resource limits
  - [ ] VULN: Secrets in environment variables (visible in compose)

#### 7.2 Flags / CTF Integration
- [ ] Plant flags throughout the system
  - [ ] FLAG_1: In /actuator/env (easy)
  - [ ] FLAG_2: In admin user's profile notes (IDOR)
  - [ ] FLAG_3: In Redis (network pivot)
  - [ ] FLAG_4: In PostgreSQL hidden table (SQLi)
  - [ ] FLAG_5: In server filesystem /opt/flags/flag5.txt (RCE)
  - [ ] FLAG_6: In another user's portfolio (horizontal privesc)
  - [ ] FLAG_7: In WebSocket admin channel (subscription bypass)
  - [ ] FLAG_8: In heapdump (memory analysis)
  - [ ] FLAG_9: In H2 console (exposed debug endpoint)
  - [ ] FLAG_10: In JWT secret extraction → forge admin token 
        → access admin endpoint returning final flag

---

## PHASE 8: Documentation & Walkthrough (Week 4)
### Goal: Complete documentation for trainers and trainees

#### 8.1 Trainee Documentation
- [ ] README.md - Setup instructions only
- [ ] RULES.md - Engagement rules
- [ ] HINTS.md - Graduated hints per flag (ROT13 encoded)

#### 8.2 Trainer Documentation (separate repo/branch)
- [ ] SOLUTIONS.md - Full walkthrough for each vulnerability
- [ ] VULNERABILITY_CATALOG.md - Complete list with STRIDE/CWE mapping
- [ ] SCORING.md - Point system for each finding

#### 8.3 Vulnerability Catalog Structure
Each vulnerability documented as:



# Project Repo Structure

```
vulntrade/
├── docker-compose.yml
├── README.md
├── todo.md
├── .env                          # VULN: secrets in env file
│
├── backend/
│   ├── Dockerfile
│   ├── pom.xml
│   └── src/
│       └── main/
│           ├── java/com/vulntrade/
│           │   ├── VulnTradeApplication.java
│           │   │
│           │   ├── config/
│           │   │   ├── WebSocketConfig.java         # STOMP/WS configuration
│           │   │   ├── SecurityConfig.java           # Spring Security (weak)
│           │   │   ├── CorsConfig.java               # VULN: CORS *
│           │   │   ├── ActuatorConfig.java            # VULN: everything exposed
│           │   │   └── RedisConfig.java               # Redis connection
│           │   │
│           │   ├── security/
│           │   │   ├── JwtTokenProvider.java          # VULN: weak secret, alg:none
│           │   │   ├── JwtAuthFilter.java             # VULN: bypassable
│           │   │   ├── ApiKeyAuthFilter.java          # VULN: key in URL
│           │   │   └── WebSocketAuthInterceptor.java  # VULN: weak auth
│           │   │
│           │   ├── model/
│           │   │   ├── User.java
│           │   │   ├── Order.java
│           │   │   ├── Trade.java
│           │   │   ├── Position.java
│           │   │   ├── Transaction.java
│           │   │   ├── PriceAlert.java
│           │   │   ├── Symbol.java
│           │   │   ├── OrderBook.java
│           │   │   └── dto/
│           │   │       ├── OrderRequest.java          # VULN: no validation annotations
│           │   │       ├── WithdrawRequest.java
│           │   │       ├── DepositRequest.java
│           │   │       ├── LoginRequest.java
│           │   │       ├── RegisterRequest.java
│           │   │       ├── AdminBalanceRequest.java
│           │   │       ├── AlertRequest.java
│           │   │       └── TradeHistoryRequest.java
│           │   │
│           │   ├── repository/
│           │   │   ├── UserRepository.java
│           │   │   ├── OrderRepository.java
│           │   │   ├── TradeRepository.java
│           │   │   ├── PositionRepository.java
│           │   │   ├── TransactionRepository.java
│           │   │   ├── PriceAlertRepository.java
│           │   │   ├── SymbolRepository.java
│           │   │   └── CustomQueryRepository.java     # VULN: raw SQL
│           │   │
│           │   ├── service/
│           │   │   ├── AuthService.java               # VULN: user enumeration
│           │   │   ├── OrderService.java              # VULN: no ownership check
│           │   │   ├── TradeService.java              # Business logic
│           │   │   ├── MatchingEngine.java            # VULN: self-match, no circuit breaker
│           │   │   ├── RiskService.java               # VULN: bypassable, TOCTOU
│           │   │   ├── PortfolioService.java          # VULN: IDOR
│           │   │   ├── AccountService.java            # VULN: race condition on withdraw
│           │   │   ├── PriceSimulator.java            # VULN: predictable seed
│           │   │   ├── AlertService.java              # VULN: stored XSS
│           │   │   ├── AdminService.java              # VULN: broken auth
│           │   │   └── AuditService.java              # VULN: log injection
│           │   │
│           │   ├── websocket/
│           │   │   ├── TradingWebSocketHandler.java
│           │   │   ├── StompEventListener.java        # Connection/disconnect events
│           │   │   └── controller/
│           │   │       ├── TradeStompController.java   # /app/trade.* handlers
│           │   │       ├── AdminStompController.java   # /app/admin.* handlers
│           │   │       └── MarketDataController.java   # Price feed publisher
│           │   │
│           │   ├── controller/                        # REST controllers
│           │   │   ├── AuthController.java
│           │   │   ├── MarketController.java
│           │   │   ├── OrderController.java
│           │   │   ├── UserController.java
│           │   │   ├── AdminController.java           # VULN: method override bypass
│           │   │   ├── ExportController.java          # VULN: CSV injection
│           │   │   └── DebugController.java           # VULN: RCE, info disclosure
│           │   │
│           │   └── util/
│           │       ├── PriceUtils.java
│           │       └── SerializationHelper.java       # VULN: unsafe deserialization
│           │
│           └── resources/
│               ├── application.yml                    # VULN: secrets in plaintext
│               ├── application-dev.yml
│               ├── log4j2.xml                         # VULN: vulnerable Log4j config
│               └── static/                            # Fallback static files
│
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf                                     # VULN: directory listing, no CSP
│   ├── .env                                           # VULN: API URLs, flags
│   ├── package.json
│   └── src/
│       ├── index.js
│       ├── App.js
│       ├── config/
│       │   └── api.js                                 # VULN: hardcoded endpoints
│       │
│       ├── services/
│       │   ├── authService.js                         # VULN: token in localStorage
│       │   ├── websocketService.js                    # STOMP client
│       │   └── apiService.js                          # REST client
│       │
│       ├── context/
│       │   ├── AuthContext.js                          # VULN: role in client state
│       │   └── TradingContext.js                       # VULN: full state exposed
│       │
│       ├── components/
│       │   ├── common/
│       │   │   ├── Header.js
│       │   │   ├── Sidebar.js
│       │   │   └── Notification.js                    # VULN: renders HTML
│       │   │
│       │   ├── trading/
│       │   │   ├── PriceTicker.js                     # VULN: dangerouslySetInnerHTML
│       │   │   ├── OrderForm.js                       # VULN: client-side validation only
│       │   │   ├── OrderBook.js                       # Displays live order book
│       │   │   ├── TradeHistory.js
│       │   │   └── PriceChart.js
│       │   │
│       │   ├── portfolio/
│       │   │   ├── Holdings.js                        # VULN: userId in request
│       │   │   ├── PnLDisplay.js
│       │   │   └── BalanceCard.js
│       │   │
│       │   ├── account/
│       │   │   ├── DepositForm.js
│       │   │   ├── WithdrawForm.js                    # VULN: fake 2FA
│       │   │   ├── ProfileSettings.js
│       │   │   └── TwoFactorModal.js                  # VULN: decorative only
│       │   │
│       │   └── admin/
│       │       ├── AdminDashboard.js                  # VULN: client-side auth check
│       │       ├── UserManagement.js
│       │       ├── TradingHaltControl.js
│       │       ├── BalanceAdjuster.js
│       │       └── PriceOverride.js
│       │
│       └── pages/
│           ├── LoginPage.js
│           ├── RegisterPage.js
│           ├── DashboardPage.js
│           ├── PortfolioPage.js
│           ├── HistoryPage.js
│           ├── AccountPage.js
│           └── AdminPage.js                           # VULN: no route protection
│
├── database/
│   ├── init.sql                                       # Schema + seed data
│   ├── seed_data.sql                                  # Users, symbols, flags
│   └── flags.sql                                      # Hidden flag table
│
├── flags/
│   └── flag5.txt                                      # Flag for RCE challenge
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── VULNERABILITY_CATALOG.md
│   ├── HINTS.md
│   └── diagrams/
│       ├── data_flow.png
│       ├── trust_boundaries.png
│       └── stomp_destinations.png
│
└── solutions/                                         # Separate branch or encrypted
    ├── SOLUTIONS.md
    ├── SCORING.md
    └── exploits/
        ├── 01_actuator_enum.py
        ├── 02_jwt_forge.py
        ├── 03_idor_portfolio.py
        ├── 04_websocket_hijack.html
        ├── 05_race_condition_withdraw.py
        ├── 06_sqli_history.py
        ├── 07_stomp_admin_subscribe.js
        ├── 08_heapdump_analysis.py
        ├── 09_deserialization_rce.py
        └── 10_full_chain.py
```

## DATA STRUCTURES

``` 
┌─────────────────────────────────────────────────────────────┐
│                     DATABASE SCHEMA                          │
└─────────────────────────────────────────────────────────────┘

┌──────────────────────────┐       ┌──────────────────────────┐
│         users            │       │        symbols           │
├──────────────────────────┤       ├──────────────────────────┤
│ id          SERIAL PK    │       │ symbol     VARCHAR PK    │
│ username    VARCHAR(50)  │       │ name       VARCHAR(100)  │
│ password    VARCHAR(255) │──┐    │ current_price DECIMAL    │
│ email       VARCHAR(100) │  │    │ bid        DECIMAL       │
│ role        VARCHAR(20)  │  │    │ ask        DECIMAL       │
│ balance     DECIMAL(20,8)│  │    │ volume     BIGINT        │
│ api_key     VARCHAR(64)  │  │    │ last_updated TIMESTAMP   │
│ is_active   BOOLEAN      │  │    │ is_tradable BOOLEAN      │
│ notes       TEXT         │  │    └──────────┬───────────────┘
│ created_at  TIMESTAMP    │  │               │
│ profile_pic VARCHAR(255) │  │               │
└──────────┬───────────────┘  │               │
           │                  │               │
           │  ┌───────────────┘               │
           │  │                               │
           ▼  ▼                               │
┌──────────────────────────┐                  │
│         orders           │                  │
├──────────────────────────┤                  │
│ id          SERIAL PK    │                  │
│ user_id     INTEGER FK   │──► users.id      │
│ symbol      VARCHAR(20)  │──────────────────┘
│ side        VARCHAR(4)   │  (BUY/SELL)
│ order_type  VARCHAR(10)  │  (LIMIT/MARKET/STOP)
│ quantity    DECIMAL(20,8)│  ◄── VULN: no CHECK > 0
│ price       DECIMAL(20,8)│  ◄── VULN: no CHECK > 0
│ status      VARCHAR(20)  │  (NEW/PARTIAL/FILLED/CANCELLED)
│ filled_qty  DECIMAL(20,8)│
│ filled_price DECIMAL     │
│ client_order_id VARCHAR  │  ◄── VULN: not UNIQUE
│ created_at  TIMESTAMP    │
│ executed_at TIMESTAMP    │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│         trades           │
├──────────────────────────┤
│ id          SERIAL PK    │
│ buy_order_id  INTEGER FK │──► orders.id
│ sell_order_id INTEGER FK │──► orders.id
│ symbol      VARCHAR(20)  │
│ quantity    DECIMAL(20,8)│
│ price       DECIMAL(20,8)│
│ executed_at TIMESTAMP    │
└──────────────────────────┘

┌──────────────────────────┐     ┌──────────────────────────┐
│       positions          │     │     transactions         │
├──────────────────────────┤     ├──────────────────────────┤
│ id          SERIAL PK    │     │ id          SERIAL PK    │
│ user_id     INTEGER FK   │     │ user_id     INTEGER FK   │
│ symbol      VARCHAR(20)  │     │ type        VARCHAR(20)  │
│ quantity    DECIMAL(20,8)│     │ amount      DECIMAL(20,8)│
│ avg_price   DECIMAL(20,8)│     │ balance_after DECIMAL    │
│ unrealized_pnl DECIMAL   │     │ description TEXT         │
│ updated_at  TIMESTAMP    │     │ reference_id VARCHAR     │
└──────────────────────────┘     │ created_at  TIMESTAMP    │
                                 └──────────────────────────┘

┌──────────────────────────┐     ┌──────────────────────────┐
│      price_alerts        │     │      audit_log           │
├──────────────────────────┤     ├──────────────────────────┤
│ id          SERIAL PK    │     │ id          SERIAL PK    │
│ user_id     INTEGER FK   │     │ user_id     INTEGER      │
│ symbol      VARCHAR(20)  │     │ action      VARCHAR(100) │
│ target_price DECIMAL     │     │ details     TEXT         │
│ direction   VARCHAR(5)   │     │ ip_address  VARCHAR(45)  │
│ is_triggered BOOLEAN     │     │ timestamp   TIMESTAMP    │
│ created_at  TIMESTAMP    │     │ ◄── VULN: incomplete,    │
└──────────────────────────┘     │     many actions missing  │
                                 └──────────────────────────┘

┌──────────────────────────┐
│      flags (hidden)      │  ◄── Only discoverable via SQLi
├──────────────────────────┤
│ id          SERIAL PK    │
│ flag_name   VARCHAR(50)  │
│ flag_value  VARCHAR(100) │
│ hint        TEXT         │
└──────────────────────────┘
```

## DATA FLOW DIAGRAMS
```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                      │
│   TRADER'S BROWSER                                                                   │
│   ┌─────────────────────────────────────────────────────────────┐                   │
│   │  React Application                                          │                   │
│   │                                                              │                   │
│   │  ┌──────────┐  ┌───────────┐  ┌──────────┐                │                   │
│   │  │ Order    │  │ Portfolio │  │ Account  │                │                   │
│   │  │ Form     │  │ View     │  │ Mgmt     │                │                   │
│   │  └────┬─────┘  └─────┬─────┘  └────┬─────┘                │                   │
│   │       │              │              │                       │                   │
│   │       ▼              ▼              ▼                       │                   │
│   │  ┌──────────────────────────────────────────┐              │                   │
│   │  │         STOMP Client (stompjs)            │              │                   │
│   │  │                                           │              │                   │
│   │  │  SEND:                                    │              │                   │
│   │  │  /app/trade.placeOrder ──────────────────────────────────┼── STOMP FRAME ──┐ │
│   │  │  /app/trade.cancelOrder                   │              │                 │ │
│   │  │  /app/trade.withdraw                      │              │                 │ │
│   │  │  /app/trade.getPortfolio                  │              │                 │ │
│   │  │                                           │              │                 │ │
│   │  │  SUBSCRIBE:                               │              │                 │ │
│   │  │  /topic/prices ◄─────────────────────────────────────────┼── STOMP FRAME ──┤ │
│   │  │  /topic/orderbook ◄──────────────────────────────────────┼── STOMP FRAME ──┤ │
│   │  │  /topic/trades ◄────────────────────────────────────────┼── STOMP FRAME ──┤ │
│   │  │  /user/queue/orders ◄────────────────────────────────────┼── STOMP FRAME ──┤ │
│   │  │  /user/queue/portfolio ◄─────────────────────────────────┼── STOMP FRAME ──┤ │
│   │  │  /topic/admin/alerts ◄───────────────────────────────────┼── VULN! ────────┤ │
│   │  └──────────────────────────────────────────┘              │                 │ │
│   │                                                              │                 │ │
│   │  Also: REST calls via axios to /api/*  ─────────────────────┼── HTTPS ────────┤ │
│   │  Also: JWT in localStorage ◄── VULN!                        │                 │ │
│   └─────────────────────────────────────────────────────────────┘                 │ │
│                                                                                    │ │
└────────────────────────────────────────────────────────────────────────────────────┘ │
                                                                                      │
     ┌────────────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                      │
│   JAVA BACKEND (Spring Boot)                                                         │
│   ┌──────────────────────────────────────────────────────────────────────────────┐  │
│   │  ┌─────────────────┐    ┌──────────────────────┐   ┌─────────────────────┐  │  │
│   │  │ STOMP Controller │    │  REST Controller      │   │ Spring Security    │  │  │
│   │  │                  │    │                       │   │ Filter Chain       │  │  │
│   │  │ TradeStompCtrl   │    │ AuthController        │   │                    │  │  │
│   │  │ AdminStompCtrl   │    │ OrderController       │   │ JwtAuthFilter      │  │  │
│   │  │ MarketDataCtrl   │    │ AdminController       │   │ ◄── VULN: bypass  │  │  │
│   │  │ ◄── VULN:       │    │ DebugController       │   │                    │  │  │
│   │  │  missing auth on │    │ ◄── VULN: RCE        │   │ ApiKeyFilter       │  │  │
│   │  │  some handlers   │    │                       │   │ ◄── VULN: in URL  │  │  │
│   │  └────────┬─────────┘    └───────────┬───────────┘   └─────────┬──────────┘  │  │
│   │           │                          │                          │             │  │
│   │           ▼                          ▼                          │             │  │
│   │  ┌────────────────────────────────────────────────────────────┐│             │  │
│   │  │                    SERVICE LAYER                            ││             │  │
│   │  │                                                             ││             │  │
│   │  │  ┌──────────────┐  ┌───────────────┐  ┌────────────────┐ ││             │  │
│   │  │  │ OrderService  │  │ AccountService │  │ RiskService    │ ││             │  │
│   │  │  │              │  │               │  │                │ ││             │  │
│   │  │  │ ◄── VULN:   │  │ ◄── VULN:    │  │ ◄── VULN:     │ ││             │  │
│   │  │  │ no IDOR check│  │ race condition│  │ bypassable    │ ││             │  │
│   │  │  │ neg quantity │  │ on withdraw   │  │ TOCTOU        │ ││             │  │
│   │  │  └──────┬───────┘  └───────┬───────┘  └───────┬────────┘ ││             │  │
│   │  │         │                  │                   │          ││             │  │
│   │  │         ▼                  ▼                   ▼          ││             │  │
│   │  │  ┌──────────────────────────────────────────────────────┐││             │  │
│   │  │  │              MATCHING ENGINE                          │││             │  │
│   │  │  │  ◄── VULN: self-matching, no circuit breaker         │││             │  │
│   │  │  └──────────────────────┬───────────────────────────────┘││             │  │
│   │  └─────────────────────────┼────────────────────────────────┘│             │  │
│   │                            │                                  │             │  │
│   │                            ▼                                  │             │  │
│   │  ┌─────────────────────────────────────────────┐             │             │  │
│   │  │           DATA LAYER                         │             │             │  │
│   │  │                                              │             │             │  │
│   │  │  JPA Repositories ──► PostgreSQL             │             │             │  │
│   │  │  ◄── VULN: one repo                         │             │             │  │
│   │  │       uses raw SQL                           │             │             │  │
│   │  │                                              │             │             │  │
│   │  │  Redis Client ──────► Redis                  │             │             │  │
│   │  │  ◄── VULN: no auth   ◄── VULN: exposed     │             │             │  │
│   │  │                                              │             │             │  │
│   │  └─────────────────────────────────────────────┘             │             │  │
│   │                                                               │             │  │
│   │  Spring Actuator ──────► /actuator/*                         │             │  │
│   │  ◄── VULN: all exposed    env, heapdump, beans, mappings    │             │  │
│   │                                                               │             │  │
│   │  H2 Console ───────────► /h2-console                         │             │  │
│   │  ◄── VULN: no auth       ◄── VULN: enabled in prod          │             │  │
│   │                                                               │             │  │
│   └──────────────────────────────────────────────────────────────┘             │  │
│                                                                                │  │
└────────────────────────────────────────────────────────────────────────────────┘  │
```


WEBSOCKET STOMP MESSAGE FLOW
```
TRADER                    REACT                     SPRING BOOT                 DATABASE
  │                         │                            │                          │
  │  Click "Buy 100 AAPL"  │                            │                          │
  │────────────────────────►│                            │                          │
  │                         │                            │                          │
  │        [CLIENT-SIDE VALIDATION ONLY]                 │                          │
  │        [Check: qty > 0, symbol exists]               │                          │
  │        [Check: balance >= qty * price]  ◄── VULN: client only                  │
  │                         │                            │                          │
  │                         │  STOMP SEND                │                          │
  │                         │  /app/trade.placeOrder     │                          │
  │                         │  {                         │                          │
  │                         │    "symbol": "AAPL",       │                          │
  │                         │    "side": "BUY",          │                          │
  │                         │    "type": "LIMIT",        │                          │
  │                         │    "quantity": 100,         │  ◄── VULN: what if -100?│
  │                         │    "price": 150.00,        │  ◄── VULN: what if 0.01?│
  │                         │    "clientOrderId":"abc"   │  ◄── VULN: replay       │
  │                         │  }                         │                          │
  │                         │───────────────────────────►│                          │
  │                         │                            │                          │
  │                         │        [JWT extracted from STOMP headers]              │
  │                         │        [◄── VULN: JWT not revalidated after connect]  │
  │                         │                            │                          │
  │                         │                 ┌──────────┴──────────┐               │
  │                         │                 │ TradeStompController│               │
  │                         │                 │  handlePlaceOrder() │               │
  │                         │                 └──────────┬──────────┘               │
  │                         │                            │                          │
  │                         │                 ┌──────────┴──────────┐               │
  │                         │                 │    RiskService      │               │
  │                         │                 │  checkPreTrade()    │               │
  │                         │                 │  ◄── VULN: READ     │               │
  │                         │                 │  UNCOMMITTED balance│               │
  │                         │                 │  check (TOCTOU)     │──SELECT ──────►│
  │                         │                 └──────────┬──────────┘  balance      │
  │                         │                            │  ◄──── $50,000 ─────────│
  │                         │                            │                          │
  │                         │                 ┌──────────┴──────────┐               │
  │                         │                 │   OrderService      │               │
  │                         │                 │  createOrder()      │               │
  │                         │                 │  ◄── VULN: no       │               │
  │                         │                 │  ownership set      │               │
  │                         │                 │  properly           │──INSERT ──────►│
  │                         │                 └──────────┬──────────┘  order        │
  │                         │                            │                          │
  │                         │                 ┌──────────┴──────────┐               │
  │                         │                 │  MatchingEngine     │               │
  │                         │                 │  tryMatch()         │               │
  │                         │                 │  ◄── VULN: self-    │               │
  │                         │                 │  matching allowed   │──SELECT ──────►│
  │                         │                 │                     │  opposing     │
  │                         │                 │                     │  orders       │
  │                         │                 └──────────┬──────────┘               │
  │                         │                            │                          │
  │                         │               [IF MATCHED]  │                          │
  │                         │                            │                          │
  │                         │                 ┌──────────┴──────────┐               │
  │                         │                 │  TradeService       │               │
  │                         │                 │  executeTrade()     │               │
  │                         │                 │                     │──INSERT ──────►│
  │                         │                 │  Update positions   │  trade        │
  │                         │                 │  Update balances    │──UPDATE ──────►│
  │                         │                 │  ◄── VULN: float    │  positions    │
  │                         │                 │  precision errors   │  balances     │
  │                         │                 └──────────┬──────────┘               │
  │                         │                            │                          │
  │                         │  STOMP MESSAGE             │                          │
  │                         │  /user/queue/orders        │                          │
  │                         │  {"orderId":123,           │                          │
  │                         │   "status":"FILLED",...}   │                          │
  │                         │◄───────────────────────────│                          │
  │                         │                            │                          │
  │                         │  STOMP MESSAGE             │                          │
  │                         │  /topic/trades             │                          │
  │                         │  {"tradeId":456,           │  ◄── VULN: broadcasts   │
  │                         │   "buyUserId":1, ◄── VULN │  user IDs to everyone    │
  │                         │   "symbol":"AAPL",...}     │                          │
  │                         │◄───────────────────────────│──────────────────────────►│
  │                         │                            │  broadcast               │
  │  Display confirmation   │                            │  to ALL subscribers      │
  │◄────────────────────────│                            │                          │
  │                         │                            │                          │
```


Attack Data Flow: Race Condition Double-Withdraw
```
ATTACKER                        BACKEND                         DATABASE
  │                                │                               │
  │ Balance: $10,000               │                               │
  │                                │                               │
  │ ══════ CONCURRENT REQUESTS ══════                              │
  │                                │                               │
  │ WS1: withdraw $10,000 ────────►│                               │
  │ WS2: withdraw $10,000 ────────►│  (within microseconds)       │
  │                                │                               │
  │                    Thread 1:   │  SELECT balance               │
  │                    ───────────►│─────────────────────────────► │
  │                                │  ◄── balance = $10,000 ────── │
  │                                │  CHECK: $10,000 >= $10,000 ✓  │
  │                                │                               │
  │                    Thread 2:   │  SELECT balance               │
  │                    ───────────►│─────────────────────────────► │
  │                                │  ◄── balance = $10,000 ────── │  ◄── VULN! 
  │                                │  CHECK: $10,000 >= $10,000 ✓  │  Not yet 
  │                                │                               │  deducted!
  │                    Thread 1:   │  UPDATE balance -= $10,000    │
  │                    ───────────►│─────────────────────────────► │
  │                                │  balance now = $0             │
  │                                │                               │
  │                    Thread 2:   │  UPDATE balance -= $10,000    │
  │                    ───────────►│─────────────────────────────► │
  │                                │  balance now = -$10,000       │  ◄── VULN!
  │                                │                               │  Negative 
  │ ◄── Withdraw 1: SUCCESS ──────│                               │  balance!
  │ ◄── Withdraw 2: SUCCESS ──────│                               │
  │                                │                               │
  │ Attacker got $20,000 from      │                               │
  │ $10,000 account                │                               │
  ```
