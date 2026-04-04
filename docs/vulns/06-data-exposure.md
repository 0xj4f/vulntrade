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
| File | `JwtTokenProvider.java:65-67` |

**Description:** For Level 2 (verified) users, the JWT contains: firstName, lastName, dateOfBirth, phoneNumber, SSN, and full address. Anyone who intercepts or decodes the JWT (base64, no encryption) gets all PII.

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
| Endpoint | `GET /actuator/env` |
| File | `application.yml:69-78` |

**Description:** Spring Boot Actuator is fully exposed with no authentication. `/actuator/env` reveals all environment variables including `FLAG_1`, JWT secret, database credentials, and API keys.

**How to exploit:**
```bash
curl http://localhost:8085/actuator/env
# Contains: FLAG{4ctu4t0r_3xp0s3d_s3cr3ts}
```

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
| File | `PriceSimulatorService.java:96-99` |

**Description:** The price feed broadcast to `/topic/prices` includes internal fields: `marketMakerId` (MM-INTERNAL-7734), `costBasis`, and `spreadBps`. These are only visible in Developer debug mode but are present in the WebSocket payload for all users.

---

### DATA-08: Leaderboard Notes Field Leaks Flags
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-200 |
| Difficulty | Beginner |
| Endpoint | `GET /api/leaderboard` |
| File | `LeaderboardController.java:206` |

**Description:** The leaderboard API includes the `notes` field for every trader. Hidden in the UI for non-DEVELOPER users but visible in DevTools Network tab. Contains flags for 0xj4f, admin, and trader2.

---

### DATA-09: Debug Endpoint Returns Password Hashes
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A01: Broken Access Control |
| CWE | CWE-200 |
| Difficulty | Intermediate |
| Endpoint | `GET /api/debug/user-info` |
| File | `DebugController.java:36-47` |

**Description:** Returns full User objects including BCrypt password hashes. No authentication required — only a hardcoded debug key that's discoverable in source.

---

### DATA-10: .env File Accessible
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A05: Security Misconfiguration |
| CWE | CWE-200 |
| Difficulty | Beginner |
| File | `.env` |

**Description:** The `.env` file contains database credentials, JWT secret, Redis config, and multiple CTF flags. In the Docker setup, it may be accessible via misconfigured nginx or directly.

---

### DATA-11: Database Path Disclosure in Errors
| Field | Value |
|-------|-------|
| Severity | Low |
| OWASP | A09: Security Logging and Monitoring Failures |
| CWE | CWE-209 |
| File | `application.yml:8` |

**Description:** `server.error.include-stacktrace: always` ensures full stack traces with file paths, class names, and line numbers are returned in error responses.

---

### DATA-12: Redis No Authentication
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A05: Security Misconfiguration |
| CWE | CWE-306 |
| Difficulty | Beginner |
| File | `docker-compose.yml:35` |

**Description:** Redis runs with no password (`--requirepass` not set). Port 6379 is exposed to the host.

```bash
redis-cli -h localhost -p 6379
> GET flag3
"FLAG{r3d1s_n0_4uth_p1v0t}"
```
