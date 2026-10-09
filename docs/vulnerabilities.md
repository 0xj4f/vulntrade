
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
| 8 | Secrets in .env file (served by frontend nginx :3001, not the backend) | .env (frontend) | CWE-312 | ✅ Working |
| 9 | CORS wildcard (*) | All endpoints | CWE-942 | ✅ Working |
| 10 | CSRF disabled | All POST endpoints | CWE-352 | ✅ Working |
| 11 | WebSocket no origin check | /ws, /ws-sockjs | CWE-346 | ✅ Working |
| 12 | H2 console enabled | /h2-console | CWE-749 | ✅ Configured |
| 13 | Vulnerable dependencies | pom.xml | CWE-1104 | ✅ log4j 2.14.1, commons-collections 3.2.1 |

## Verified Vulnerabilities (Phase 2)
| # | Vulnerability | Endpoint | CWE | Status |
|---|--------------|----------|-----|--------|
| 14 | SQL injection (login-legacy) — blind + error-based, **not** an auth bypass | POST /api/auth/login-legacy | CWE-89 | ✅ Working (bcrypt re-check on the returned row defeats `' OR '1'='1`; the oracle + error leak are the real exploit — see "Reclassified & Debunked Claims") |
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

## Verified Vulnerabilities (Phase 3) — WebSocket / Trading

> **✅ Working** = proven exploitable · **🛡️ Control present** = historical vuln, now rejected
> server-side (kept for teaching, no longer exploitable) · **❌ Not exploitable** = claim
> debunked · **🔄 Coded** = present in source but not exercised by the matrix.

| # | Vulnerability | Endpoint | CWE | Status |
|---|--------------|----------|-----|--------|
| 32 | Unbounded WS message size (10MB) | /ws, /ws-sockjs | CWE-400 | ❌ Not exploitable — effective ~16–32KB limit; `setMessageSizeLimit(10MB)` is a no-op (servlet buffer wins), a ~1MB frame drops the connection |
| 33 | No message rate limiting | /ws, /ws-sockjs | CWE-799 | ✅ Working (50/50 messages serviced, 0 errors) |
| 34 | /topic/admin/* subscribable by any user | /topic/admin/alerts | CWE-862 | ✅ Working (Flag 7 leaked in the halt alert) |
| 35 | Missing authorization on /app/admin.* | /app/admin.setPrice, .adjustBalance, .haltTrading | CWE-862 | ✅ Working (non-admin commands accepted) |
| 36 | Price feed includes internal fields | /topic/prices | CWE-200 | ✅ Working (marketMakerId/costBasis/spreadBps) |
| 37 | Fixed random seed (predictable prices) | PriceSimulatorService | CWE-330 | ✅ Working |
| 38 | VULN symbol predictable pattern | PriceSimulatorService | CWE-330 | ✅ Working (deterministic sine band ~60–140) |
| 39 | Negative quantity accepted | /app/trade.placeOrder | CWE-20 | 🛡️ Control present — rejected server-side (`RiskService` qty>0). *Was exploitable pre-hardening* |
| 40 | No price band validation | /app/trade.placeOrder | CWE-20 | ✅ Working (0.01 and 999999 both accepted) |
| 41 | clientOrderId replay | /app/trade.placeOrder | CWE-294 | ✅ Working (duplicate id accepted twice) |
| 42 | Non-existent symbol accepted | /app/trade.placeOrder | CWE-20 | 🛡️ Control present — rejected (`RiskService` symbol check). *Was exploitable pre-hardening* |
| 43 | Balance check race condition (TOCTOU) | RiskService | CWE-367 | ✅ Working (concurrent withdrawals double-spend) |
| 44 | IDOR - cancel any order | POST /api/orders/{id}/cancel, /app/trade.cancelOrder | CWE-639 | ✅ Working (no ownership check in `OrderService`) |
| 45 | No slippage protection | /app/trade.executeMarket | CWE-20 | ✅ Working |
| 46 | Market order during halt | /app/trade.executeMarket | CWE-862 | 🛡️ Control present — halt now applies to ALL order types (`OrderService`). *Was exploitable pre-hardening* |
| 47 | IDOR - view any portfolio | GET /api/users/{id}/portfolio | CWE-639 | ✅ Working |
| 48 | Sensitive fields in balance (apiKey/role/notes) | /app/trade.getBalance, /api/accounts/balance | CWE-200 | ✅ Working |
| 49 | No 2FA on withdraw (backend) | /api/accounts/withdraw, /app/trade.withdraw | CWE-306 | ✅ Working (backend never checks 2FA) |
| 50 | Sign flip (negative withdraw = deposit) | /api/accounts/withdraw | CWE-20 | ✅ Working |
| 51 | Race condition double-withdraw | /api/accounts/withdraw | CWE-367 | ✅ Working |
| 52 | No deposit source verification | /api/accounts/deposit | CWE-345 | ✅ Working |
| 53 | SQL injection in trade history | /app/trade.getHistory | CWE-89 | ✅ Working (startDate/endDate/symbol) |
| 54 | Stored XSS via alert symbol | /app/trade.setAlert | CWE-79 | ✅ Working |
| 55 | No alert limit (resource exhaustion) | /app/trade.setAlert | CWE-400 | 🔄 Coded (not in matrix) |
| 56 | JWT role from token body (admin) | /api/admin/**, /app/admin.* | CWE-862 | ✅ Working (alg:none / weak-secret forge) |
| 57 | Log injection via reason field | POST /api/admin/adjust-balance | CWE-117 | ✅ Working |
| 58 | Arbitrary price manipulation | /app/admin.setPrice | CWE-20 | ✅ Working |
| 59 | No audit trail for price changes | /app/admin.setPrice | CWE-778 | 🔄 Coded (not in matrix) |
| 60 | Order book info disclosure (userId) | /topic/orderbook | CWE-200 | 🔄 Coded (not in matrix) |
| 61 | Trade broadcast info disclosure (userId) | /topic/trades | CWE-200 | 🔄 Coded (not in matrix) |
| 62 | Self-matching (wash trading) | MatchingEngineService | CWE-840 | ✅ Working (no self-trade guard) |
| 63 | Position can go negative (naked short) | MatchingEngineService, RiskService | CWE-20 | 🛡️ Control present — short rejected (`RiskService` position check) and fills clamp at 0 (`MatchingEngineService`). *Was exploitable pre-hardening* |
| 64 | Floating point P&L errors | MatchingEngineService | CWE-681 | 🔄 Coded (BigDecimal in use; not in matrix) |
| 65 | Risk check skipped for MARKET | RiskService | CWE-862 | ❌ Not exploitable — MARKET orders are now risk-checked (balance/position/symbol/qty). *Was exploitable pre-hardening* |
| 66 | System metrics in admin alerts | AdminService | CWE-200 | 🔄 Coded (not in matrix) |

## Planned Vulnerabilities (Phase 6) — Frontend
| # | Vulnerability | Location | CWE | Status |
|---|--------------|----------|-----|--------|
| 67 | dangerouslySetInnerHTML for symbol (XSS) | DashboardPage.js | CWE-79 | ✅ Coded |
| 68 | dangerouslySetInnerHTML for name (XSS) | DashboardPage.js | CWE-79 | ✅ Coded |
| 69 | Internal price fields displayed | DashboardPage.js | CWE-200 | ✅ Coded |
| 70 | Client-side max-order-size cap (10000) only | DashboardPage.js | CWE-602 | ⚠️ Frontend-only — only the `max=10000` size cap is client-side; qty>0, price>0 and symbol existence ARE enforced server-side (`RiskService`) |
| 71 | Hidden userId field (tamperable) | DashboardPage.js | CWE-472 | ✅ Coded |
| 72 | Order IDs in order book (IDOR cancel) | DashboardPage.js | CWE-639 | ✅ Coded |
| 73 | Admin alerts visible to any user | DashboardPage.js | CWE-862 | ✅ Coded |
| 74 | Portfolio IDOR via userId | PortfolioPage.js | CWE-639 | ✅ Coded |
| 75 | P&L calculated client-side | PortfolioPage.js | CWE-602 | ✅ Coded |
| 76 | Transaction history IDOR | PortfolioPage.js | CWE-639 | ✅ Coded |
| 77 | Fake 2FA modal (decorative) | AccountPage.js | CWE-306 | ✅ Coded |
| 78 | Withdraw sign flip (negative amount) | AccountPage.js | CWE-20 | ✅ Coded |
| 79 | Deposit no source verification | AccountPage.js | CWE-345 | ✅ Coded |
| 80 | JS-only amount validation | AccountPage.js | CWE-602 | ✅ Coded |
| 81 | Client-side /admin route guard only | AdminPage.js / App.js | CWE-602 | ⚠️ Frontend-only — the React `/admin` guard is client-side, but backend `/api/admin/**` IS role-gated (`SecurityConfig`); server-side admin access needs a forged ADMIN role (see #56) |
| 82 | Trading halt via WS (any user) | AdminPage.js | CWE-862 | ✅ Coded |
| 83 | Price override (market manipulation) | AdminPage.js | CWE-20 | ✅ Coded |
| 84 | Log injection via reason field | AdminPage.js | CWE-117 | ✅ Coded |
| 85 | Source maps in production | package.json | CWE-540 | ✅ Coded |
| 86 | .env with secrets accessible | .env / Dockerfile | CWE-312 | ✅ Coded |
| 87 | No CSP header | nginx.conf | CWE-693 | ✅ Coded |
| 88 | Service worker caches sensitive data | public/sw.js | CWE-922 | ✅ Coded |
| 89 | Directory listing enabled | nginx.conf | CWE-548 | ✅ Coded |
| 90 | SQLi via history WS endpoint | HistoryPage.js | CWE-89 | ✅ Coded |
| 91 | CSV injection via export | HistoryPage.js | CWE-1236 | ✅ Coded |

## Reclassified & Debunked Claims

From the clean-DB verification run (exploit matrix: **68 PASS / 0 FAIL / 8 SKIP** of 76; the
8 SKIPs are frontend-only or backend-out-of-scope checks, not failures). These correct earlier framing:

- **Legacy-login SQLi is blind + error-based, not an auth bypass.** `/api/auth/login-legacy`
  concatenates the username into `SELECT * FROM users WHERE username = '<here>'`
  (`AuthController.java:143`), but the app bcrypt-re-checks the password on the returned row, so
  `' OR '1'='1` does **not** log you in. The injectable surface is real: a boolean oracle
  (`x' AND '1'='1` → *Invalid password* [row matched] vs `x' AND '1'='2` → *User not found*
  [no row]) and error-based leakage (a stray quote → HTTP 500 with an
  `org.hibernate … SQLGrammarException` in the body). Difficulty: Intermediate.
- **HTTP method-override does NOT bypass authorization (debunked).** Spring's
  `HiddenHttpMethodFilter` only honours the `_method` *form* param on POST and never changes
  authorization; the `X-HTTP-Method-Override` header does nothing. A non-admin
  `POST /api/admin/users` + override still returns 403. Not a vulnerability.
- **WS message size is effectively limited (config no-op).**
  `WebSocketConfig.setMessageSizeLimit(10 * 1024 * 1024)` (`WebSocketConfig.java:56`) is
  overridden by the servlet WebSocket text buffer (~16–32KB), so a ~1MB frame drops the
  connection. "Unbounded message size" is false — it is a backend misconfiguration, not an
  exploitable DoS.
- **Admin page protection is a frontend-only route guard.** The `/admin` React route is hidden
  client-side, but `/api/admin/**` is role-gated server-side (`SecurityConfig.java:64`): a plain
  non-admin token gets 403. Reaching the admin API requires forging the ADMIN role (#56).
- **`.env` exposure is a frontend/nginx static-file issue, not backend.** The SPA's nginx serves
  `/.env` (`frontend/nginx.conf:66`, with `autoindex on`), reachable at the frontend origin
  (:3001), not from the Spring backend.
- **Order-flow hardening (now foundational controls).** `RiskService.checkPreTrade`
  (`RiskService.java:47`) runs for **all** order types and rejects: qty ≤ 0, price ≤ 0 (LIMIT),
  unknown/untradable symbols, insufficient balance (BUY) and insufficient position (SELL). The
  halt check in `OrderService.placeOrder` applies to all order types, and
  `MatchingEngineService` clamps positions at 0 (no naked shorts). Items #39, #42, #46, #63 and
  #65 above moved from "vulnerability" to "control present / not exploitable" as a result.
  The still-real trading-logic vulns are: sign-flip withdrawal (#50), TOCTOU double-spend
  (#43/#51), deposit without source verification (#52), wash trading (#62), no price band (#40),
  clientOrderId replay (#41) and no slippage protection (#45).
