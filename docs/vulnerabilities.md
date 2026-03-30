
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

## Planned Vulnerabilities (Phase 6) — Frontend
| # | Vulnerability | Location | CWE | Status |
|---|--------------|----------|-----|--------|
| 67 | dangerouslySetInnerHTML for symbol (XSS) | DashboardPage.js | CWE-79 | ✅ Coded |
| 68 | dangerouslySetInnerHTML for name (XSS) | DashboardPage.js | CWE-79 | ✅ Coded |
| 69 | Internal price fields displayed | DashboardPage.js | CWE-200 | ✅ Coded |
| 70 | Client-side only order validation | DashboardPage.js | CWE-602 | ✅ Coded |
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
| 81 | Admin route no server protection | AdminPage.js / App.js | CWE-862 | ✅ Coded |
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
