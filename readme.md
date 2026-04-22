# VulnTrade

### A deliberately vulnerable fintech trading platform for security training

<p align="center">
  <strong>Learn to attack. Learn to defend. Understand both sides.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#vulnerability-categories">Vulnerabilities</a> &bull;
  <a href="#ctf-flags">CTF Flags</a> &bull;
  <a href="#siem-integration">SIEM Integration</a> &bull;
  <a href="#documentation">Docs</a> &bull;
  <a href="#contributing">Contributing</a>
</p>

---

VulnTrade is a purpose-built vulnerable application designed around the domain of **financial trading platforms**. Unlike generic vulnerable apps, every vulnerability here is grounded in the real attack surface of trading systems — WebSocket protocol abuse, market data manipulation, order flow exploitation, and financial transaction flaws.

The application looks and behaves like a real trading platform: live price feeds, order matching, candlestick charts, portfolio tracking, a leaderboard, and account verification flows. The vulnerabilities are embedded in realistic functionality.

> **Warning**: VulnTrade is intentionally vulnerable. Do **not** deploy it to any public-facing server or production environment. Run it only in isolated lab environments for educational purposes.

## Why a Trading Application?

Most vulnerable-by-design apps (DVWA, WebGoat, Juice Shop) are generic web applications. Trading platforms have a unique, underserved attack surface:

- **WebSocket as primary protocol** — real-time trading over STOMP/WebSocket, invisible to traditional WAFs
- **Order flow integrity** — race conditions, sign flips, and negative amount exploits in deposits and withdrawals
- **Market data trust** — client-side price reliance, WebSocket injection, and manipulable P&L calculations
- **Financial IDOR** — accessing other users' portfolios, trade history, and account balances
- **Log4Shell over WebSocket** — JNDI injection through STOMP message bodies, an attack path most scanners miss entirely
- **SQL injection over WebSocket** — UNION-based extraction through STOMP frames, bypassing HTTP-layer defenses
- **JWT-based account level abuse** — forging KYC verification claims to unlock restricted trading features

## Who is This For?

- **Penetration testers** learning fintech-specific attack methodology
- **Security engineers** building detection rules for trading platform threats
- **SOC analysts** studying attack patterns through structured SIEM logs
- **CTF participants** who want realistic, domain-specific challenges
- **Developers** building trading systems who need to understand what insecure looks like

## Quick Start

```bash
git clone https://github.com/0xj4f/vulntrade.git
cd vulntrade
docker compose up
```

That's it. The full stack starts in under a minute.

### Using prebuilt images (no local build)

If you just want to run the lab without compiling anything, use the prebuilt images published to Docker Hub:

```bash
git clone https://github.com/0xj4f/vulntrade.git
cd vulntrade
docker compose -f docker-compose.prod.yml up -d
```

The `prod` compose file pulls `0xj4f/vulntrade-backend:latest` and `0xj4f/vulntrade-frontend:latest` instead of building from source. Everything else — ports, DB seed, flags, vulnerabilities — is identical. To pin to a specific release, replace `:latest` with a version tag (e.g. `:0.5.3`).

| Service    | Host Port | URL                                 |
|------------|-----------|-------------------------------------|
| Frontend   | **3001**  | http://localhost:3001               |
| Backend    | **8085**  | http://localhost:8085               |
| Adminer    | **8081**  | http://localhost:8081               |
| PostgreSQL | **5432**  | `postgres://vulntrade:vulntrade@localhost:5432/vulntrade` |
| Redis      | **6379**  | `redis://localhost:6379`            |
| Debug Port | **5005**  | Java remote debug (JDWP)           |
| JMX        | **9090**  | JMX monitoring (unauthenticated)    |

### Default Credentials

| Role      | Username   | Password    |
|-----------|------------|-------------|
| Trader    | `trader1`  | `password`  |
| Trader    | `trader2`  | `trader123` |
| Developer | `dev`      | `dev123`    |
| API       | `apiuser`  | `api123`    |

The database is also seeded with 12 famous traders (Buffett, Saylor, DFV, Satoshi, and more) with trade histories and portfolio positions.

## Vulnerability Categories

VulnTrade covers **60+ vulnerabilities** across 10 categories, all specific to trading platform architecture:

| Category | Examples | Count |
|----------|---------|-------|
| **Authentication & Session** | JWT forging, password change without confirmation, weak token invalidation | 7 |
| **Authorization & IDOR** | Cross-user portfolio access, admin endpoints with client-side checks only | 8 |
| **Injection** | SQL injection over WebSocket, CSV injection, path traversal, **Log4Shell (CVE-2021-44228)** | 11 |
| **Business Logic** | Sign-flip withdrawals, negative amounts, client-side limit enforcement, race conditions | 8 |
| **WebSocket / STOMP** | Unauthenticated subscriptions, admin broadcast leaks, STOMP message injection, SQLi/RCE via STOMP | 11 |
| **Data Exposure** | SSN in API responses, API keys in profile endpoints, actuator secrets, heap dump analysis | 8 |
| **Frontend** | Client-side price trust, DevTools P&L manipulation, disabled button bypass | 5 |
| **Infrastructure** | Exposed debug ports, unauthenticated JMX, Redis without auth, default DB credentials | 6 |
| **File Upload** | No MIME validation, path traversal via filename, unrestricted file types | 3 |
| **Attack Chains** | Multi-step: JWT forgery → admin WebSocket → Log4Shell RCE | 4 |

Full documentation for every vulnerability is in [`docs/vulns/`](docs/vulns/).

## CTF Flags

VulnTrade includes **12 CTF flags** worth a total of **3,550 points**, ranging from beginner to expert:

| Difficulty | Flags | Points | Techniques Required |
|------------|-------|--------|---------------------|
| Beginner   | 3     | 100-200 | Actuator enumeration, basic IDOR |
| Intermediate | 4   | 200-300 | UNION SQLi, Redis pivoting, JWT analysis |
| Advanced   | 3     | 300-350 | JWT forging, heap dump analysis, RCE via debug port |
| Expert     | 2     | 500 each | Market manipulation chains, Log4Shell over WebSocket |

Flags are hidden across the database, application memory, configuration files, and require real exploitation to discover — not just source code reading.

## SIEM Integration

**Attack informs defense.** VulnTrade is built with structured application logging designed to be consumed by [Wazuh](https://wazuh.com/) or any SIEM that accepts JSON log ingestion.

```
/var/log/vulntrade/app.log        → All application events (JSON, one per line)
/var/log/vulntrade/security.log   → Auth and access control events (JSON)
```

Every attack you perform generates structured log data:

- **SQL injection attempts** → logged with full query context
- **Authentication failures** → logged with username, IP, failure reason
- **Admin privilege abuse** → logged with actor role, target, and action
- **WebSocket STOMP operations** → logged with user, destination, and payload metadata
- **Log4Shell JNDI lookups** → visible in both console and JSON appenders

The idea is simple: attack the application, then switch hats and build the detection. Write Wazuh rules that catch what you just did. Every offensive technique has a defensive counterpart waiting to be built.

Logs are bind-mounted to `./logs/vulntrade/` on the host for easy SIEM agent pickup (filebeat, fluentd, `aws s3 cp`, etc.).

## Architecture

```
┌─────────────┐     ┌──────────────────────┐     ┌────────────┐
│   React     │────▶│   Spring Boot        │────▶│ PostgreSQL │
│   Frontend  │ WS  │   Backend            │     │   13       │
│   :3001     │◀────│   :8085              │────▶│   :5432    │
└─────────────┘     │                      │     └────────────┘
                    │  REST API            │     ┌────────────┐
                    │  WebSocket/STOMP     │────▶│   Redis    │
                    │  Log4j2 2.14.1      │     │   :6379    │
                    │  JDK 11 (JDWP+JMX) │     └────────────┘
                    └──────────────────────┘
                           │
                    ┌──────┴──────┐
                    │ Structured  │
                    │ JSON Logs   │──▶  Wazuh / SIEM
                    │ /var/log/   │
                    └─────────────┘
```

| Component | Technology | Why |
|-----------|-----------|-----|
| Frontend | React 18 + nginx | Modern SPA with WebSocket client |
| Backend | Spring Boot 2.7 + Java 11 | Industry-standard fintech stack |
| Database | PostgreSQL 13 | Production-grade RDBMS |
| Cache | Redis 7 | Session and rate-limit store |
| Logging | Log4j2 2.14.1 | Structured SIEM output + Log4Shell |
| Protocol | STOMP over WebSocket | Real-time trading communication |

## Documentation

| Document | Description |
|----------|-------------|
| [`docs/vulns/`](docs/vulns/) | Detailed guides for all vulnerability categories |
| [`docs/vulns/10-ctf-flags.md`](docs/vulns/10-ctf-flags.md) | CTF flag guide with hints and point values |
| [`docs/vulns/09-attack-chains.md`](docs/vulns/09-attack-chains.md) | Multi-step exploitation walkthroughs |
| [`docs/order-flow.md`](docs/order-flow.md) | Trading order flow and matching engine |
| [`docs/dfd.md`](docs/dfd.md) | Data flow diagrams |

## Tools That Work Well With VulnTrade

| Tool | Use Case |
|------|----------|
| **Burp Suite** | WebSocket history, STOMP frame replay, SQLi via Repeater |
| **websocat** | CLI WebSocket + STOMP frame crafting |
| **sqlmap** | HTTP endpoint SQLi (WebSocket requires manual approach) |
| **wscat** | Quick WebSocket connectivity testing |
| **Wazuh** | SIEM log ingestion, detection rule development |
| **marshalsec** | LDAP redirect server for Log4Shell exploitation |

---

## A Personal Note

VulnTrade started as a tool I needed for myself.

Most training environments are generic web apps — blogs, stores, simple APIs. But the systems I work with are different. Trading platforms have their own behavior, their own failure modes, and their own risks. I wanted something closer to reality — something I could break, observe, and understand from both sides.

So I built one.

This project is how I study: build the system, break it, then look at the logs and ask, “how would I detect this if I were defending it?” Every vulnerability here exists for that reason. Not just to exploit — but to understand what it looks like when it happens.

A lot of what’s here is inspired by real issues — things I’ve seen, things I’ve read, and things I’ve tried to recreate in a controlled way. The goal is simple: make learning feel real.

I’m sharing this because the best things I learned came from people who shared their work openly. This is my way of contributing back — focused on fintech, because that’s where I can be most useful.

I’m still learning. Still building. Still failing and trying again.

If this helps you think deeper, practice better, or see systems more clearly — then it’s doing its job.

**Attack informs defense. Build both.**

— [0xj4f](https://github.com/0xj4f)

---

## Contributing

Contributions are welcome. Whether it's a new vulnerability, a bug fix, a documentation improvement, or a Wazuh detection rule — all of it makes VulnTrade better for everyone.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/new-vulnerability`)
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

Please ensure any new vulnerabilities include:
- Documentation in `docs/vulns/` explaining the vulnerability
- A CTF flag if applicable
- Structured log entries for SIEM detection

## License

VulnTrade is open source software licensed under the [MIT License](LICENSE).

Copyright (c) 2026 [0xj4f](https://github.com/0xj4f) and the VulnTrade contributors.

## Disclaimer

VulnTrade is a deliberately vulnerable application created for **educational and authorized security testing purposes only**. The authors assume no liability and are not responsible for any misuse or damage caused by this software. Do not install or deploy VulnTrade on any system connected to a production network or exposed to the public internet. Use responsibly.

## Acknowledgments

VulnTrade exists because of the platforms and communities that made learning security accessible:

- TryHackMe — where I started. It lowers the barrier and makes security approachable. It teaches you step by step, and that matters when you're beginning.
- Hack The Box — when you need to go deeper. Less guidance, more thinking. It forces you to become more independent.
- OffSec — for structured, disciplined training:
    - OSDA / SOC200 — shaped how I think about detection, logging, and threat hunting. This directly influenced the SIEM logging design in VulnTrade.
    - OSCP — taught me how to think under pressure and work methodically. I didn’t pass on my first attempt, but the process itself changed how I approach problems. I’m preparing for the next one.
- Wazuh — for making SIEM accessible and practical. VulnTrade’s logging is designed so you can plug it into tools like this and actually build detections.

And to the open-source security community — projects like Juice Shop, DVWA, and WebGoat — for setting the foundation that made this kind of project possible.