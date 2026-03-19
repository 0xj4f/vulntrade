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
**Status:** ⬜ Not Started

---

## PHASE 3: WebSocket/STOMP Implementation
**Goal:** Full WebSocket trading with STOMP vulnerabilities  
**Status:** ⬜ Not Started

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
