# 06 — Data Exposure & Privacy

## Overview
VulnTrade leaks sensitive data through multiple channels: PII in JWT tokens, SSN in plaintext, API keys in responses, actuator endpoints exposing secrets, and notes fields containing CTF flags. In real fintech, these violations carry massive regulatory fines (GDPR, CCPA, PCI-DSS).

---

## Vulnerabilities

### DATA-01: SSN Stored in Plaintext
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A02: Cryptographic Failures |
| CWE | CWE-312 |
| Difficulty | Beginner |
| File | `User.java:73`, `init.sql:27` |

**Description:** Social Security Numbers are stored as plain VARCHAR in the database. The admin's SSN is actually a flag: `FLAG{ssn_exposed_in_jwt}`.

---

### DATA-02: PII Embedded in JWT Claims
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A02: Cryptographic Failures |
| CWE | CWE-212 |
| Difficulty | Intermediate |
| File | `JwtTokenProvider.java:62-81` |

**Description:** For Level 2 (verified) users, `generateToken(User)` builds a "fat" JWT containing firstName, lastName, dateOfBirth, phoneNumber, SSN (line 70), and a nested full address. Anyone who intercepts or decodes the JWT (base64, no encryption) gets all PII. Proven: `trader2`'s token leaks `ssn`, `dateOfBirth`, `phoneNumber`, `address`.

**How to exploit:**
1. Login as a Level 2 user (e.g., trader2/password)
2. Copy the JWT from localStorage
3. Decode at jwt.io — PII is right there in the payload

---

### DATA-03: Actuator Environment Variables Exposed
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A05: Security Misconfiguration |
| CWE | CWE-215 |
| Difficulty | Beginner |
| Endpoint | `GET /actuator/env`, `GET /actuator/configprops` |
| File | `application.yml:65-82` |

**Description:** Spring Boot Actuator is fully exposed with no authentication (`management.endpoints.web.exposure.include: "*"`, line 69). On top of that, the default secret masking is turned **off**: on Boot 2.7 the mask is controlled by `keys-to-sanitize`, and the config sets that to an **empty list** (lines 80-82), so `/actuator/env` and `/actuator/configprops` print secrets in clear text — the JWT secret, the DB password, the debug key, `FLAG_1`, and API keys. (The Boot 3 `show-values: ALWAYS` property is silently ignored on 2.7, hence the empty-list approach.)

**How to exploit:**
```bash
curl http://localhost:8085/actuator/env
# FLAG_1 and now-unmasked JWT secret / DB password are in the propertySources
```
> The unmasked JWT secret here is what makes the weak-secret JWT forge practical (the token is signed with the secret's UTF-8 bytes) — see [01-authentication.md](01-authentication.md).

---

### DATA-04: Heap Dump Contains Secrets
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A05: Security Misconfiguration |
| CWE | CWE-215 |
| Difficulty | Intermediate |
| Endpoint | `GET /actuator/heapdump` |

**Description:** The heap dump endpoint returns the full JVM memory, which contains `FLAG_8`, JWT secrets, all user data, and database passwords.

---

### DATA-05: API Keys in Plaintext
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A02: Cryptographic Failures |
| CWE | CWE-312 |
| Difficulty | Beginner |

**Description:** API keys are stored in the database as plaintext strings and returned in login responses, user profile endpoints, and admin user lists.

---

### DATA-06: API Key Accepted in URL Parameter
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A07: Identification and Authentication Failures |
| CWE | CWE-598 |
| Difficulty | Beginner |
| File | `JwtAuthFilter.java:64,73`, `ApiKeyAuthFilter.java:79-82` |

**Description:** API keys can be passed as `?api_key=X` URL parameter. This exposes the key in server access logs, browser history, proxy logs, and referrer headers.

---

### DATA-07: Internal Market Maker Data in Price Feed
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A01: Broken Access Control |
| CWE | CWE-200 |
| File | `PriceSimulatorService.java:105-109` |

**Description:** The price feed broadcast to the WebSocket topic `/topic/prices` includes internal fields: `marketMakerId` (MM-INTERNAL-7734), `costBasis`, and `spreadBps` (set at lines 105-109). The UI only surfaces them in Developer debug mode, but they are present in the WebSocket payload for all subscribers. (These fields are on the WS feed, not the HTTP `/api/market/prices` view.)

---

### DATA-08: Leaderboard Notes Field Leaks Flags
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-200 |
| Difficulty | Beginner |
| Endpoint | `GET /api/leaderboard`, `GET /api/leaderboard/{id}/detail` |
| File | `LeaderboardController.java:361` (list entries), `:233` (user detail) |

**Description:** The leaderboard API includes the `notes` field for every trader (added to each entry's stats at line 361, and to the per-user detail at line 233). Hidden in the UI for non-DEVELOPER users but visible in the DevTools Network tab. Contains flags/notes for traders such as 0xj4f, admin, and trader2.

---

### DATA-09: Debug Endpoint Returns Password Hashes
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A01: Broken Access Control |
| CWE | CWE-200 |
| Difficulty | Intermediate |
| Endpoint | `GET /api/debug/user-info` |
| File | `DebugController.java:42-56` |

**Description:** Returns full `User` objects including BCrypt password hashes (and SSN, apiKey, notes). `GET /api/debug/user-info?userId=1` requires **no authentication and no key at all** — it is reachable by anyone. (The hardcoded debug key `vulntrade-debug-key-2024`, discoverable in source, gates the *RCE* debug endpoint, not this one.)

---

### DATA-10: .env File Accessible
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A05: Security Misconfiguration |
| CWE | CWE-200 |
| Difficulty | Beginner |
| Endpoint | `GET /.env` on the **frontend** origin (e.g. `http://localhost:3001/.env`) |
| File | `frontend/nginx.conf:66-67`, `frontend/Dockerfile:24` |

**Description:** The exposed `.env` is served by the **frontend nginx (the SPA container)**, not the backend. The frontend Docker build copies the React app's `.env` into the web root (`COPY --from=build /app/.env /usr/share/nginx/html/.env`), and `nginx.conf` has an explicit `location ~ /\.env { # Not blocked! }` rule. So this is a static-file / nginx misconfiguration, and it must be verified at the **frontend origin**, not the backend (`:8085`), which is why the backend-targeted exploit suite marks it SKIP.

**How to exploit:**
```bash
curl http://localhost:3001/.env
# Returns the React build-time config: REACT_APP_JWT_SECRET, REACT_APP_DB_PASSWORD,
# REACT_APP_DEBUG_KEY, REACT_APP_REDIS_HOST, API/WS URLs, etc.
```
> These are the client build's `REACT_APP_*` values. The authoritative backend secrets are exposed separately via `/actuator/env` (DATA-03).

---

### DATA-11: Database Path Disclosure in Errors
| Field | Value |
|-------|-------|
| Severity | Low |
| OWASP | A09: Security Logging and Monitoring Failures |
| CWE | CWE-209 |
| File | `application.yml:8` |

**Description:** `server.error.include-stacktrace: always` (line 8, with `include-message: always` on line 7) ensures full stack traces / exception messages with class names are returned in error responses. This is what makes **error-based SQLi** practical: the legacy login (`POST /api/auth/login-legacy`) builds SQL by string concatenation, so an unterminated quote throws and the handler returns an `org.hibernate ... SQLGrammarException` to the client. See [03-injection.md](03-injection.md) for the injection itself.

---

### DATA-12: Redis No Authentication
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A05: Security Misconfiguration |
| CWE | CWE-306 |
| Difficulty | Beginner |
| File | `docker-compose.yml:31-36` |

**Description:** Redis runs with no password — the compose command is `redis-server --save 60 1` with no `--requirepass` (line 36) and port 6379 is published to the host (line 35). Any unauthenticated client can connect and issue commands.

```bash
redis-cli -h localhost -p 6379
> PING
PONG            # unauthenticated access confirmed
```

> **Flag note:** the planned Flag 3 (`FLAG{r3d1s_n0_4uth_p1v0t}`) is **not currently seeded** into Redis, so `GET flag3` returns `(nil)`. The open, unauthenticated Redis is real; the flag payload is a planned reward not yet present. See [10-ctf-flags.md](10-ctf-flags.md).
