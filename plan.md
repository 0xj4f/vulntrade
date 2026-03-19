# VulnTrade - Build Plan & Progress Tracker

## Status Legend
- ⬜ Not Started
- 🔄 In Progress  
- ✅ Complete
- ❌ Failed
- 🔁 Needs Retry

---

## PHASE 1: Foundation Infrastructure
**Goal:** Skeleton project that compiles, runs, and connects via `docker-compose up`  
**Status:** ✅ COMPLETE

### 1.1 Project Scaffolding
| Task | Status | Notes |
|------|--------|-------|
| Create root docker-compose.yml | ✅ | 5 services: backend, frontend, postgres, redis, adminer |
| Create .env with secrets | ✅ | All flags, creds, JWT secret exposed |
| Backend Dockerfile | ✅ | Maven multi-stage build, eclipse-temurin-11, runs as root |
| Frontend Dockerfile | ✅ | node:18-alpine → nginx:alpine, source maps enabled |
| PostgreSQL init scripts | ✅ | Schema + symbols + flags table |
| Redis (no auth) | ✅ | No password, Flag 3 planted |
| Adminer (exposed) | ✅ | Accessible at :8081 |
| Verify `docker-compose up` | ✅ | All 5 services healthy |
| Health check endpoints | ✅ | /api/health returns DB status, user/symbol counts |

### 1.2 Database Schema  
| Task | Status | Notes |
|------|--------|-------|
| users table | ✅ | No unique username constraint |
| orders table | ✅ | No CHECK constraints on qty/price |
| trades table | ✅ | |
| positions table | ✅ | |
| transactions table | ✅ | |
| price_alerts table | ✅ | |
| audit_log table | ✅ | Intentionally incomplete |
| symbols table | ✅ | 8 symbols seeded |
| flags (hidden) table | ✅ | 3 flags, only via SQLi |
| Seed admin/admin123 | ✅ | BCrypt via DataInitializer |
| Seed traders | ✅ | trader1/password, trader2/password |
| Seed symbols + prices | ✅ | AAPL, GOOGL, MSFT, TSLA, AMZN, BTC-USD, ETH-USD, VULN |
| Seed flags | ✅ | Redis flag3, DB flags table, env flags |

### 1.3 Backend Skeleton
| Task | Status | Notes |
|------|--------|-------|
| pom.xml with vulnerable deps | ✅ | log4j 2.14.1, jackson 2.13.0, commons-collections 3.2.1 |
| VulnTradeApplication.java | ✅ | Main class with @EnableScheduling |
| SecurityConfig.java | ✅ | CSRF disabled, CORS *, H2 console open, actuator open |
| WebSocketConfig.java | ✅ | STOMP/SockJS, no origin check, no message size limit |
| JwtTokenProvider.java | ✅ | Weak secret, alg:none support, expired tokens accepted |
| application.yml | ✅ | Secrets plaintext, all actuator exposed, debug enabled |
| Health endpoint | ✅ | /api/health with DB status |
| Actuator exposed | ✅ | /actuator/env shows all flags and secrets |

### 1.4 Frontend Skeleton
| Task | Status | Notes |
|------|--------|-------|
| package.json | ✅ | React 18 + stomp + axios + react-router |
| Basic page routing | ✅ | Login, Dashboard, Admin pages |
| nginx.conf | ✅ | Directory listing, no CSP, proxy to backend |
| Dockerfile | ✅ | Multi-stage, .env copied to build output |

---

## PHASE 2: Authentication & User Management
**Goal:** Working auth with intentional vulnerabilities  
**Status:** ✅ COMPLETE

### 2.1 Backend Auth Enhancements
| Task | Status | Notes |
|------|--------|-------|
| SQL injection in login (native query path) | ✅ | POST /api/auth/login-legacy - raw SQL concat |
| API Key authentication filter | ✅ | X-API-Key header + ?api_key= query param both work |
| Password reset with predictable token | ✅ | Timestamp-based, stored in DB, leaked in response |
| Password reset apply endpoint | ✅ | POST /api/auth/reset-confirm - no expiry, reusable |
| Token NOT invalidated on password change | ✅ | Old JWT still works after pwd change |
| Password change endpoint (no old pwd required) | ✅ | PUT /api/auth/change-password |
| User profile endpoint with IDOR | ✅ | GET /api/users/{id} - any user's profile |
| User portfolio with IDOR | ✅ | GET /api/users/{id}/portfolio - exposes notes/flags |
| Admin user list | ✅ | GET /api/admin/users - role-restricted |
| Admin SQL executor | ✅ | POST /api/admin/execute-query |
| Admin balance adjustment | ✅ | POST /api/admin/adjust-balance |
| Email change without verification | ✅ | PUT /api/users/{id} - no verification |

### 2.2 Frontend Auth Enhancements
| Task | Status | Notes |
|------|--------|-------|
| AuthContext with role in client state | ✅ | AuthContext.js stores everything in localStorage |
| Registration page with client-only validation | ✅ | Min 6 char password - JS only, server accepts anything |
| Login page with AuthContext | ✅ | User enumeration errors displayed |
| Password reset page | ✅ | Request + confirm flow, debug token shown |
| Account/Profile page | ✅ | Password change, email change, IDOR user lookup |
| Admin panel with SQL executor | ✅ | User list, SQL query, balance adjustment |
| Admin route hidden but not protected | ✅ | Conditional render only, any auth user can access /admin |

### 2.3 Session Management
| Task | Status | Notes |
|------|--------|-------|
| WebSocket auth interceptor (weak) | ✅ | JWT checked on connect, never revalidated |
| Predictable session ID (sequential) | ✅ | AtomicLong counter starting at 1000 |
| No concurrent session limit | ✅ | Unlimited logins per user |
| Anonymous WS connections allowed | ✅ | Returns true even without valid token |

---

## PHASE 3: WebSocket/STOMP Implementation
**Goal:** Full WebSocket trading with STOMP vulnerabilities  
**Status:** ✅ COMPLETE

### 3.1 WebSocket Configuration
| Task | Status | Notes |
|------|--------|-------|
| STOMP over WebSocket (/ws, /ws-sockjs) | ✅ | WebSocketConfig.java updated with full STOMP config |
| No Origin header validation | ✅ | setAllowedOriginPatterns("*") |
| CORS allows * | ✅ | CorsConfig.java + WebSocket endpoints |
| SockJS fallback enabled | ✅ | /ws-sockjs with SockJS |
| No message size limit | ✅ | Set to 10MB (way too high) |
| No connection rate limiting | ✅ | No rate limiting anywhere |
| STOMP channel interceptor | ✅ | StompChannelInterceptor.java - weak auth |
| /topic/admin/* subscribable by any user | ✅ | No authorization check on subscribe |
| Missing authorization on /app/ destinations | ✅ | Logs warning but doesn't block |

### 3.2 Market Data Feed (/topic/prices)
| Task | Status | Notes |
|------|--------|-------|
| Price simulation engine | ✅ | PriceSimulatorService.java - random walk every 1s |
| Publishes to /topic/prices | ✅ | Broadcasts PriceUpdate DTO |
| Price data format (bid/ask/last/volume) | ✅ | Full PriceUpdate DTO |
| Internal fields not stripped | ✅ | costBasis, marketMakerId, spreadBps exposed |
| No entitlement check | ✅ | All users get all symbols |
| Fixed seed (predictable) | ✅ | new Random(42) |
| VULN symbol predictable pattern | ✅ | Sinusoidal: 100 + 20*sin(tick*0.1) |
| BTC-USD no decimal precision limit | ✅ | scale=8 for crypto |

### 3.3 Order Management STOMP Endpoints
| Task | Status | Notes |
|------|--------|-------|
| /app/trade.placeOrder | ✅ | TradeStompController.java |
| No server-side quantity validation | ✅ | Accepts negative quantities |
| No price band validation | ✅ | Can buy at $0.01 |
| clientOrderId not unique-enforced | ✅ | Replay attacks possible |
| Symbol not validated | ✅ | Non-existent symbols accepted |
| Balance check race condition | ✅ | READ UNCOMMITTED, TOCTOU in RiskService |
| /app/trade.cancelOrder | ✅ | IDOR - can cancel any user's order |
| /app/trade.executeMarket | ✅ | No slippage protection, no halt check |
| Market order during halt | ✅ | Halt check only for LIMIT orders |

### 3.4 Portfolio & Account STOMP Endpoints
| Task | Status | Notes |
|------|--------|-------|
| /app/trade.getPortfolio (IDOR) | ✅ | Accepts optional userId param |
| /app/trade.getBalance | ✅ | Response includes apiKey, notes, role |
| /app/trade.withdraw | ✅ | No 2FA, no rate limit, sign flip, race condition |
| /app/trade.deposit | ✅ | No source verification - free money |
| /app/trade.getHistory (SQLi) | ✅ | Raw SQL via CustomQueryRepository |
| /app/trade.setAlert (XSS) | ✅ | Stored XSS via symbol field |
| No alert limit | ✅ | Resource exhaustion possible |

### 3.5 Admin STOMP Endpoints
| Task | Status | Notes |
|------|--------|-------|
| /app/admin.adjustBalance | ✅ | JWT role from token body (modifiable) |
| Log injection via reason field | ✅ | Unsanitized in AuditService |
| /app/admin.haltTrading | ✅ | Same JWT role vuln, Flag 7 leaked |
| /app/admin.resumeTrading | ✅ | AdminStompController.java |
| /app/admin.setPrice | ✅ | Arbitrary prices, no audit trail |

### 3.6 Broadcast Channels
| Task | Status | Notes |
|------|--------|-------|
| /topic/orderbook | ✅ | Includes userId, username (info disclosure) |
| /topic/trades | ✅ | Includes internal trade IDs, user IDs |
| /topic/admin/alerts | ✅ | Subscribable by any user, leaks system metrics |
| Flag 7 in admin alerts | ✅ | Leaked via haltTrading broadcast |

### 3.7 Supporting Infrastructure
| Task | Status | Notes |
|------|--------|-------|
| StompEventListener | ✅ | Tracks sessions, broadcasts to admin channel |
| StompChannelInterceptor | ✅ | StompPrincipal, weak auth enforcement |
| MatchingEngineService | ✅ | Self-matching, no circuit breaker, float errors |
| RiskService | ✅ | TOCTOU, skipped for MARKET, no sell-side check |
| OrderService | ✅ | No validation, IDOR on cancel |
| AccountService | ✅ | Race condition withdraw, sign flip, no 2FA |
| PortfolioService | ✅ | IDOR - any user's portfolio |
| AlertService | ✅ | Stored XSS, no alert limit |
| AdminService | ✅ | Broken auth, log injection, no audit |
| AuditService | ✅ | Log injection, many actions not audited |
| PriceSimulatorService | ✅ | Fixed seed, predictable VULN pattern |

### 3.8 Frontend WebSocket Integration
| Task | Status | Notes |
|------|--------|-------|
| websocketService.js | ✅ | STOMP/SockJS client, token in headers |
| Live price feed on Dashboard | ✅ | /topic/prices subscription |
| Order form via WebSocket | ✅ | /app/trade.placeOrder |
| Trade broadcast display | ✅ | /topic/trades with user IDs shown |
| Admin alerts subscription | ✅ | /topic/admin/alerts (any user) |
| Client-side only order validation | ✅ | Max 10000 qty check in JS only |

### DTOs Created
| DTO | Notes |
|-----|-------|
| WithdrawRequest | No validation, sign flip |
| DepositRequest | No source verification |
| AdminBalanceRequest | Log injection via reason |
| AlertRequest | Stored XSS via symbol |
| TradeHistoryRequest | SQL injection in dates |
| PriceUpdate | Internal fields exposed |
| TradeNotification | User IDs, trade IDs exposed |
| OrderBookEntry | User IDs, order IDs exposed |
| HaltTradingRequest | No auth enforcement |
| SetPriceRequest | Market manipulation |

### Repositories Created
| Repository | Notes |
|------------|-------|
| TradeRepository | Trade queries |
| TransactionRepository | Transaction history |
| PriceAlertRepository | Alert management |
| AuditLogRepository | Audit log queries |

---

## PHASE 4: Trading Engine & Business Logic
**Goal:** Functional matching engine with business logic vulns  
**Status:** ⬜ Not Started

---

## PHASE 5: REST API Layer
**Goal:** REST endpoints alongside WebSocket  
**Status:** ⬜ Not Started

---

## PHASE 6: Frontend Vulnerabilities
**Goal:** React frontend with client-side security issues  
**Status:** ⬜ Not Started

---

## PHASE 7: Docker & Deployment Hardening(not)
**Goal:** One-command deployment with flags planted  
**Status:** ⬜ Not Started

---

## PHASE 8: Documentation & Walkthrough
**Goal:** Complete docs for trainers and trainees  
**Status:** ⬜ Not Started

---

## Test Log
| Date | Phase | Action | Result | Notes |
|------|-------|--------|--------|-------|
| 2026-03-19 | P1 | docker compose build | ✅ | Backend 27 Java files compiled, frontend built |
| 2026-03-19 | P1 | docker compose up -d | ✅ | All 5 services healthy (ports: backend:8085, frontend:3001, adminer:8081, postgres:5432, redis:6379) |
| 2026-03-19 | P1 | GET /api/health | ✅ | `{"status":"UP","database":"connected","users":4,"symbols":8}` |
| 2026-03-19 | P1 | GET /api/market/prices | ✅ | 8 symbols returned with prices |
| 2026-03-19 | P1 | POST /api/auth/login (admin) | ✅ | JWT token returned, balance, role exposed |
| 2026-03-19 | P1 | VULN: User enumeration | ✅ | "User not found" vs "Invalid password" |
| 2026-03-19 | P1 | VULN: Actuator /env | ✅ | All flags and secrets exposed |
| 2026-03-19 | P1 | VULN: Debug /user-info | ✅ | All users with password hashes, API keys, flags |
| 2026-03-19 | P1 | VULN: Mass assignment | ✅ | Registered as ADMIN via role field |
| 2026-03-19 | P1 | Redis no-auth | ✅ | PING/PONG, Flag 3 planted |
| 2026-03-19 | P1 | Frontend proxy | ✅ | nginx proxies /api/* to backend |
| 2026-03-19 | P1 | WebSocket SockJS | ✅ | /ws-sockjs/info returns 200 |
| 2026-03-19 | P1 | Actuator health | ✅ | Shows PostgreSQL, Redis, disk status |
| 2026-03-19 | P2 | docker compose build --no-cache | ✅ | Backend 31 Java files compiled, frontend rebuilt |
| 2026-03-19 | P2 | docker compose up -d | ✅ | All 5 services healthy |
| 2026-03-19 | P2 | API Key auth (X-API-Key header) | ✅ | Authenticated as admin, got IDOR profile |
| 2026-03-19 | P2 | API Key auth (?api_key= URL param) | ✅ | Authenticated as trader2, exposed Flag 6 |
| 2026-03-19 | P2 | IDOR: GET /api/users/1 | ✅ | trader1 views admin profile → Flag 2 exposed |
| 2026-03-19 | P2 | IDOR: GET /api/users/3/portfolio | ✅ | trader1 views trader2 portfolio → Flag 6 exposed |
| 2026-03-19 | P2 | Password reset (predictable token) | ✅ | Timestamp token leaked in response body |
| 2026-03-19 | P2 | Password reset apply | ✅ | Token works, password changed, token reusable |
| 2026-03-19 | P2 | Password change (no old pwd) | ✅ | PUT /api/auth/change-password - no old pwd check |
| 2026-03-19 | P2 | Old JWT after pwd change | ✅ | Old token still works after password change |
| 2026-03-19 | P2 | Email change without verification | ✅ | PUT /api/users/{id} - no email verification |
| 2026-03-19 | P2 | SQLi in login-legacy | ✅ | Raw SQL concat, injection confirmed (blind) |
| 2026-03-19 | P2 | Frontend: Login/Register/Reset pages | ✅ | All pages render, AuthContext works |
| 2026-03-19 | P2 | Frontend: Account page with IDOR | ✅ | User lookup, password change, email change |
| 2026-03-19 | P2 | Frontend: Admin panel | ✅ | User list, SQL executor, balance adjustment |
| 2026-03-19 | P3 | Phase 3 code written | ✅ | 60 Java files, 3 frontend files, all STOMP endpoints |
| 2026-03-19 | P3 | New files: 10 DTOs | ✅ | Withdraw, Deposit, AdminBalance, Alert, TradeHistory, PriceUpdate, TradeNotification, OrderBookEntry, HaltTrading, SetPrice |
| 2026-03-19 | P3 | New files: 4 repositories | ✅ | Trade, Transaction, PriceAlert, AuditLog |
| 2026-03-19 | P3 | New files: 9 services | ✅ | Audit, PriceSim, Risk, Matching, Order, Account, Portfolio, Alert, Admin |
| 2026-03-19 | P3 | New files: 3 STOMP controllers | ✅ | TradeStompController, AdminStompController, MarketDataController |
| 2026-03-19 | P3 | New files: 2 WS support | ✅ | StompChannelInterceptor, StompEventListener |
| 2026-03-19 | P3 | Updated: WebSocketConfig | ✅ | Channel interceptor, message size limits |
| 2026-03-19 | P3 | Frontend: websocketService.js | ✅ | STOMP/SockJS client service |
| 2026-03-19 | P3 | Frontend: DashboardPage updated | ✅ | Live prices, order form, trade feed, admin alerts |

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

## Credentials (Intentionally Weak)
| User | Password | Role | Notes |
|------|----------|------|-------|
| admin | admin123 | ADMIN | Flag 2 in notes field |
| trader1 | password | TRADER | Has AAPL, MSFT positions |
| trader2 | password | TRADER | Flag 6 in notes, has TSLA, BTC, VULN positions |
| apiuser | apipass | API | Shared API key with admin |
| DB | postgres/postgres | - | PostgreSQL default creds |

## Verified Vulnerabilities (Phase 1)
| # | Vulnerability | Endpoint | CWE | Status |
|---|--------------|----------|-----|--------|
| 1 | Exposed Actuator with secrets | /actuator/env | CWE-200 | ✅ Working |
| 2 | User enumeration | POST /api/auth/login | CWE-204 | ✅ Working |
| 3 | Mass assignment (register as ADMIN) | POST /api/auth/register | CWE-915 | ✅ Working |
| 4 | Debug endpoint info disclosure | /api/debug/user-info | CWE-200 | ✅ Working |
| 5 | JWT in response with role | POST /api/auth/login | CWE-522 | ✅ Working |
| 6 | Redis no authentication | redis://localhost:6379 | CWE-306 | ✅ Working |
| 7 | PostgreSQL default creds | postgres://localhost:5432 | CWE-798 | ✅ Working |
| 8 | Secrets in .env file | .env | CWE-312 | ✅ Working |
| 9 | CORS wildcard (*) | All endpoints | CWE-942 | ✅ Working |
| 10 | CSRF disabled | All POST endpoints | CWE-352 | ✅ Working |
| 11 | WebSocket no origin check | /ws, /ws-sockjs | CWE-346 | ✅ Working |
| 12 | H2 console enabled | /h2-console | CWE-749 | ✅ Configured |
| 13 | Vulnerable dependencies | pom.xml | CWE-1104 | ✅ log4j 2.14.1, commons-collections 3.2.1 |

## Verified Vulnerabilities (Phase 2)
| # | Vulnerability | Endpoint | CWE | Status |
|---|--------------|----------|-----|--------|
| 14 | SQL injection (login-legacy) | POST /api/auth/login-legacy | CWE-89 | ✅ Working |
| 15 | API key in URL parameter | ?api_key= on any endpoint | CWE-598 | ✅ Working |
| 16 | API key in plaintext (DB + response) | POST /api/auth/login, /register | CWE-312 | ✅ Working |
| 17 | IDOR - user profile | GET /api/users/{id} | CWE-639 | ✅ Working (Flag 2) |
| 18 | IDOR - user portfolio | GET /api/users/{id}/portfolio | CWE-639 | ✅ Working (Flag 6) |
| 19 | Predictable password reset token | POST /api/auth/reset | CWE-330 | ✅ Working |
| 20 | Reset token leaked in response | POST /api/auth/reset | CWE-200 | ✅ Working |
| 21 | Reset token never expires | POST /api/auth/reset-confirm | CWE-613 | ✅ Working |
| 22 | Reset token reusable | POST /api/auth/reset-confirm | CWE-613 | ✅ Working |
| 23 | Password change without old password | PUT /api/auth/change-password | CWE-620 | ✅ Working |
| 24 | JWT not invalidated after pwd change | All JWT-auth endpoints | CWE-613 | ✅ Working |
| 25 | Email change without verification | PUT /api/users/{id} | CWE-304 | ✅ Working |
| 26 | Client-side only password validation | Frontend register | CWE-602 | ✅ Working |
| 27 | Client-side only admin route guard | Frontend /admin | CWE-602 | ✅ Working |
| 28 | JWT/user data in localStorage | Frontend | CWE-922 | ✅ Working |
| 29 | WebSocket no JWT revalidation | /ws, /ws-sockjs | CWE-613 | ✅ Working |
| 30 | Predictable WebSocket session ID | /ws handshake | CWE-330 | ✅ Working |
| 31 | Anonymous WebSocket connections | /ws, /ws-sockjs | CWE-306 | ✅ Working |

## Planned Vulnerabilities (Phase 3) — Needs Testing After Build
| # | Vulnerability | Endpoint | CWE | Status |
|---|--------------|----------|-----|--------|
| 32 | No message size limit (10MB) | /ws, /ws-sockjs | CWE-400 | 🔄 Coded |
| 33 | No connection rate limiting | /ws, /ws-sockjs | CWE-799 | 🔄 Coded |
| 34 | /topic/admin/* subscribable by any user | /topic/admin/alerts | CWE-862 | 🔄 Coded (Flag 7) |
| 35 | Missing authorization on /app/admin.* | /app/admin.adjustBalance etc | CWE-862 | 🔄 Coded |
| 36 | Price feed includes internal fields | /topic/prices | CWE-200 | 🔄 Coded |
| 37 | Fixed random seed (predictable prices) | PriceSimulatorService | CWE-330 | 🔄 Coded |
| 38 | VULN symbol predictable pattern | PriceSimulatorService | CWE-330 | 🔄 Coded |
| 39 | Negative quantity accepted | /app/trade.placeOrder | CWE-20 | 🔄 Coded |
| 40 | No price band validation | /app/trade.placeOrder | CWE-20 | 🔄 Coded |
| 41 | clientOrderId replay | /app/trade.placeOrder | CWE-294 | 🔄 Coded |
| 42 | Non-existent symbol accepted | /app/trade.placeOrder | CWE-20 | 🔄 Coded |
| 43 | Balance check race condition (TOCTOU) | RiskService | CWE-367 | 🔄 Coded |
| 44 | IDOR - cancel any order | /app/trade.cancelOrder | CWE-639 | 🔄 Coded |
| 45 | No slippage protection | /app/trade.executeMarket | CWE-20 | 🔄 Coded |
| 46 | Market order during halt | /app/trade.executeMarket | CWE-862 | 🔄 Coded |
| 47 | IDOR - view any portfolio | /app/trade.getPortfolio | CWE-639 | 🔄 Coded |
| 48 | Internal account flags in balance | /app/trade.getBalance | CWE-200 | 🔄 Coded |
| 49 | No 2FA on withdraw (backend) | /app/trade.withdraw | CWE-306 | 🔄 Coded |
| 50 | Sign flip vulnerability (negative withdraw) | /app/trade.withdraw | CWE-20 | 🔄 Coded |
| 51 | Race condition double-withdraw | /app/trade.withdraw | CWE-367 | 🔄 Coded |
| 52 | No deposit source verification | /app/trade.deposit | CWE-345 | 🔄 Coded |
| 53 | SQL injection in trade history | /app/trade.getHistory | CWE-89 | 🔄 Coded |
| 54 | Stored XSS via alert symbol | /app/trade.setAlert | CWE-79 | 🔄 Coded |
| 55 | No alert limit (resource exhaustion) | /app/trade.setAlert | CWE-400 | 🔄 Coded |
| 56 | JWT role from token body (admin) | /app/admin.adjustBalance | CWE-862 | 🔄 Coded |
| 57 | Log injection via reason field | /app/admin.adjustBalance | CWE-117 | 🔄 Coded |
| 58 | Arbitrary price manipulation | /app/admin.setPrice | CWE-20 | 🔄 Coded |
| 59 | No audit trail for price changes | /app/admin.setPrice | CWE-778 | 🔄 Coded |
| 60 | Order book info disclosure (userId) | /topic/orderbook | CWE-200 | 🔄 Coded |
| 61 | Trade broadcast info disclosure | /topic/trades | CWE-200 | 🔄 Coded |
| 62 | Self-matching (wash trading) | MatchingEngineService | CWE-840 | 🔄 Coded |
| 63 | Position can go negative (naked short) | MatchingEngineService | CWE-20 | 🔄 Coded |
| 64 | Floating point P&L errors | MatchingEngineService | CWE-681 | 🔄 Coded |
| 65 | Risk check skipped for MARKET | RiskService | CWE-862 | 🔄 Coded |
| 66 | System metrics in admin alerts | AdminService | CWE-200 | 🔄 Coded |
