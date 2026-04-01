# VulnTrade
> A deliberately vulnerable trading application built for security professionals

VulnTrade is a purpose-built vulnerable application designed specifically around the domain of financial trading platforms. Unlike generic vulnerable apps, every vulnerability here is grounded in the real attack surface of trading systems — authentication bypasses, market data manipulation, account-level privilege abuse, order flow exploitation, and financial transaction flaws.

## Who is this for?

VulnTrade is designed for:

- **Penetration testers** conducting red team engagements against trading or fintech platforms
- **Security engineers** learning how financial application-specific vulnerabilities differ from typical web app bugs
- **CTF participants** and researchers who want realistic, domain-specific targets to practice on
- **Developers** building trading systems who want to understand what insecure implementations look like in practice

## Why a trading application?

Most vulnerable-by-design apps (DVWA, WebGoat, Juice Shop) are generic. Trading applications have a unique attack surface:

- **Account levels and verification** — bypassing KYC/AML verification gates
- **Order flow integrity** — race conditions, sign flips, and negative amount exploits in deposit/withdrawal
- **Market data trust** — client-side price reliance, WebSocket injection, and manipulable P&L calculations
- **Financial IDOR** — accessing other users' portfolios, trade history, and account balances
- **JWT/session abuse** — forging account level claims to unlock restricted features
- **Real-time infrastructure** — WebSocket authentication weaknesses and STOMP channel abuse

The goal of this project is to **continuously evolve** to feel like a real production trading platform, so that the vulnerabilities embedded within it feel equally realistic and non-trivial to find.

---

## Quick Start

```bash
docker compose up
```

## Port Mapping

| Service    | Container Port | Host Port | URL                                     |
|------------|---------------|-----------|------------------------------------------|
| Backend    | 8080          | **8085**  | http://localhost:8085                   |
| Frontend   | 80            | **3001**  | http://localhost:3001                   |
| Adminer    | 8080          | **8081**  | http://localhost:8081                   |
| PostgreSQL | 5432          | **5432**  | postgres://localhost:5432/vulntrade     |
| Redis      | 6379          | **6379**  | redis://localhost:6379                  |
| Debug Port | 5005          | **5005**  | Java remote debug                       |
| JMX Port   | 9090          | **9090**  | JMX monitoring                          |

## Default Credentials

| Role   | Username  | Password   |
|--------|-----------|------------|
| Admin  | admin     | admin123   |
| Trader | trader1   | trader123  |
| Trader | trader2   | trader123  |

## Vulnerability Categories

VulnTrade covers vulnerabilities specific to trading platform architecture:

**Authentication & Session**
- JWT forging to escalate account level without real KYC verification
- Password change without current-password confirmation
- Token not invalidated server-side on logout

**Authorization & IDOR**
- Any authenticated user can view any other user's full profile, SSN, and portfolio
- Admin-only endpoints protected only by client-side role checks
- Photo upload/retrieval accessible across user IDs

**Financial Logic**
- Negative withdrawal amounts that flip to deposits (sign flip)
- Daily withdrawal limits enforced only in JavaScript
- Deposit accepted from any source account with no verification
- Client-side P&L calculation that can be manipulated via DevTools

**Injection**
- SQL injection via trade history date parameters
- CSV injection in trade export
- Path traversal in file upload filename

**Data Exposure**
- SSN and full PII returned in API responses
- API keys and internal notes leaked in profile endpoint
- Server filesystem paths exposed in photo upload response
- Debug endpoints expose internal state

**Real-time / WebSocket**
- WebSocket channels accessible without re-authentication
- Admin broadcast alerts leaked to all subscribers
- STOMP message injection

**File Upload**
- No MIME type or extension validation
- Original filename preserved on disk (path traversal possible)

---

## Architecture

```
frontend/          React SPA (Create React App)
backend/           Spring Boot REST API + WebSocket
database/          PostgreSQL schema + seed data
```

The application is intentionally designed to look and behave like a real trading platform — live price feeds, order books, candlestick charts, portfolio tracking, and account verification flows — so that the vulnerabilities feel embedded in realistic functionality rather than artificial exercises.
