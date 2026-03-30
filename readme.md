# VulnTrade 
> Vulnerable Trading Application

When the app looks like a real trading platform, pentesters take it more seriously and the vulnerabilities feel more realistic.

## Quick Usage
```
docker compose up
```

## Port Mapping
| Service | Container Port | Host Port | URL |
|---------|---------------|-----------|-----|
| Backend | 8080 | **8085** | http://localhost:8085 |
| Frontend | 80 | **3001** | http://localhost:3001 |
| Adminer | 8080 | **8081** | http://localhost:8081 |
| PostgreSQL | 5432 | **5432** | postgres://localhost:5432/vulntrade |
| Redis | 6379 | **6379** | redis://localhost:6379 |
| Debug Port | 5005 | **5005** | (Java remote debug) |
| JMX Port | 9090 | **9090** | (JMX monitoring) |


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
