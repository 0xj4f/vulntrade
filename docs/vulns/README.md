# VulnTrade Security Lab — Vulnerability Guide

## What is VulnTrade?

VulnTrade is a deliberately vulnerable trading platform designed for security training. It simulates a modern fintech application with real-time WebSocket feeds, order matching, portfolio tracking, and a leaderboard — all riddled with exploitable vulnerabilities.

## Quick Start

```bash
docker compose down -v && docker compose up --build
```

Open `http://localhost:3001` and login with any default account:

| Username | Password | Role |
|----------|----------|------|
| trader1 | password | TRADER |
| dev | dev123 | DEVELOPER (debug mode) |
| admin | admin123 | ADMIN |

**First flag to try:** Visit `/actuator/env` on the backend (port 8085) to find FLAG_1.

---

## OWASP Top 10 (2021) Coverage

| OWASP Category | Vulns | Key Examples |
|----------------|-------|-------------|
| **A01: Broken Access Control** | 15+ | IDOR on profiles/portfolios/orders, admin WS channel abuse, client-side route guards |
| **A02: Cryptographic Failures** | 10+ | SSN in plaintext, weak JWT secret, PII in JWT claims, predictable reset tokens |
| **A03: Injection** | 8+ | SQLi (REST + WebSocket), RCE via debug endpoint, log injection, CSV injection |
| **A04: Insecure Design** | 12+ | Market manipulation, sign-flip withdrawals, wash trading, decorative 2FA |
| **A05: Security Misconfiguration** | 15+ | Actuator exposed, H2 console, CSRF disabled, debug ports, CORS wildcard |
| **A06: Vulnerable Components** | 3+ | Log4j 2.14.1, Commons Collections 3.2.1, old Jackson |
| **A07: Auth Failures** | 12+ | User enumeration, no rate limiting, JWT not invalidated, weak passwords |
| **A08: Data Integrity Failures** | 5+ | Unsigned transactions, no order signatures, file upload bypass |
| **A09: Logging Failures** | 5+ | No audit trail on price changes, log injection, swallowed errors |
| **A10: SSRF** | 2 | Implicit trust in user-provided account references |

**Total: 100+ documented vulnerabilities across all categories.**

---

## Difficulty Levels

### Beginner (Start Here)
- Read exposed actuator endpoints
- Find default credentials in `.env`
- IDOR on user profiles (`/api/users/1`, `/api/users/2`, `/api/users/3`)
- API keys in login response
- Admin page accessible via direct navigation

### Intermediate
- JWT role forgery (change TRADER to ADMIN)
- Account level bypass (forge `accountLevel:2` claim)
- SQL injection via `/api/auth/login-legacy`
- WebSocket SQL injection via History page
- Sign-flip withdrawal exploit
- IDOR chain across leaderboard, portfolio, transactions

### Advanced
- Market manipulation to reach #1 on leaderboard (flag)
- RCE via debug endpoint (find the hardcoded key)
- Race condition on concurrent withdrawals
- Wash trading via self-matching orders
- Full database dump via UNION-based SQLi over WebSocket
- alg:none JWT bypass

### Expert (Attack Chains)
- Chain 3+ vulnerabilities for maximum impact
- See [09-attack-chains.md](09-attack-chains.md) for multi-step scenarios

---

## What VulnTrade Covers That Others Don't

| Feature | DVWA | Juice Shop | VulnTrade |
|---------|------|------------|-----------|
| WebSocket attack surface | No | No | SQLi over STOMP, channel hijacking, admin bypass |
| Trading/financial logic | No | No | Market manipulation, wash trading, order matching bugs |
| Real-time price feeds | No | No | Live WebSocket price simulation with exploitable patterns |
| Business logic chains | Basic | Individual challenges | Multi-step chains requiring 3-4 vulns together |
| JWT advanced attacks | No | Basic | alg:none, PII in claims, role tampering, account level forgery |
| Realistic seeded data | Minimal | Moderate | 12 famous traders, 7 days of history, live order books |
| Enterprise stack | PHP/MySQL | Node/Angular | Spring Boot/React/PostgreSQL/Redis/WebSocket |
| Leaderboard CTF | No | Scoreboard | Gamified — reach #1 to earn a flag |

---

## Documentation Index

| File | Category | Vulns |
|------|----------|-------|
| [01-authentication.md](01-authentication.md) | JWT, Login, Sessions, Password Reset | 14 |
| [02-authorization.md](02-authorization.md) | IDOR, Broken Access Control, Privilege Escalation | 12 |
| [03-injection.md](03-injection.md) | SQLi, RCE, Log Injection, CSV Injection | 10 |
| [04-business-logic.md](04-business-logic.md) | Market Manipulation, Sign Flip, Wash Trading | 16 |
| [05-websocket.md](05-websocket.md) | STOMP Auth Bypass, WS SQLi, Channel Hijacking | 10 |
| [06-data-exposure.md](06-data-exposure.md) | PII Leakage, Actuator, API Keys, Flag Locations | 12 |
| [07-frontend.md](07-frontend.md) | XSS, Client-Side Auth, localStorage, DOM Tampering | 15 |
| [08-infrastructure.md](08-infrastructure.md) | Redis, PostgreSQL, Docker, Vulnerable Dependencies | 12 |
| [09-attack-chains.md](09-attack-chains.md) | Multi-Step Scenarios | 7 chains |
| [10-ctf-flags.md](10-ctf-flags.md) | All Flags with Hints | 11 flags |

---

## Tools Recommended

- **Burp Suite** — HTTP/WebSocket interception and replay
- **Browser DevTools** — Network tab for API inspection, Console for JWT decoding
- **wscat / websocat** — CLI WebSocket clients for STOMP message crafting
- **jwt.io** — JWT decoding and forging
- **sqlmap** — Automated SQL injection (REST endpoints)
- **curl** — Manual API testing
- **redis-cli** — Direct Redis access (no auth required)
- **psql** — Direct PostgreSQL access (default credentials)
