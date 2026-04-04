# 08 — Infrastructure & Configuration

## Overview
VulnTrade's infrastructure is intentionally misconfigured. Exposed debug ports, unauthenticated databases, vulnerable dependencies, and excessive endpoint exposure create a wide attack surface before even touching the application code. These mirror real-world deployment mistakes that lead to data breaches.

---

## Vulnerabilities

### INFRA-01: Redis — No Authentication
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A05: Security Misconfiguration |
| CWE | CWE-306 |
| Difficulty | Beginner |
| File | `docker-compose.yml:35` |

**Description:** Redis runs without `--requirepass`. Port 6379 is exposed to the Docker host. Anyone can connect and read cached data.

**How to exploit:**
```bash
redis-cli -h localhost -p 6379
> KEYS *
> GET flag3
"FLAG{r3d1s_n0_4uth_p1v0t}"
```

---

### INFRA-02: PostgreSQL — Default Credentials & Exposed Port
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A05: Security Misconfiguration |
| CWE | CWE-798 |
| Difficulty | Beginner |
| File | `.env`, `docker-compose.yml` |

**Description:** PostgreSQL uses `postgres/postgres` credentials (from `.env`). Port 5432 is exposed to the host.

**How to exploit:**
```bash
psql -h localhost -p 5432 -U postgres -d vulntrade
> SELECT * FROM flags;
> SELECT username, password_hash, ssn, notes FROM users;
```

---

### INFRA-03: Spring Boot Actuator — Full Exposure
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A05: Security Misconfiguration |
| CWE | CWE-215 |
| Difficulty | Beginner |
| Endpoint | `GET /actuator/*` |
| File | `application.yml:69-78` |

**Description:** All actuator endpoints are exposed and unauthenticated: `/actuator/env` (secrets), `/actuator/heapdump` (memory), `/actuator/beans` (internals), `/actuator/health` (status), `/actuator/mappings` (all endpoints).

---

### INFRA-04: H2 Console Enabled
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A05: Security Misconfiguration |
| CWE | CWE-749 |
| Difficulty | Beginner |
| Endpoint | `/h2-console` |
| File | `application.yml:33-36` |

**Description:** The H2 database web console is enabled and accessible. While VulnTrade uses PostgreSQL as the primary database, the H2 console may still expose configuration details.

---

### INFRA-05: Debug Port Exposed (5005)
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A05: Security Misconfiguration |
| CWE | CWE-200 |
| File | `docker-compose.yml:70` |

**Description:** Java debug port 5005 is exposed to the host. An attacker can attach a debugger (IntelliJ, jdb) and inspect/modify runtime state, read memory, and set breakpoints.

---

### INFRA-06: JMX Port Exposed (9090)
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A05: Security Misconfiguration |
| CWE | CWE-200 |
| File | `docker-compose.yml:71` |

**Description:** JMX monitoring port 9090 is exposed. Tools like JConsole or VisualVM can connect to monitor threads, memory, MBeans, and trigger garbage collection.

---

### INFRA-07: Adminer Database Admin — Publicly Accessible
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A05: Security Misconfiguration |
| CWE | CWE-200 |
| Difficulty | Beginner |
| File | `docker-compose.yml:51` |

**Description:** Adminer (database admin panel) is accessible on port 8081 with no additional authentication. Login with the PostgreSQL credentials to get full database access via a web UI.

---

### INFRA-08: CSRF Protection Disabled
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A05: Security Misconfiguration |
| CWE | CWE-352 |
| File | `SecurityConfig.java:35` |

**Description:** `csrf().disable()` removes all CSRF protection. State-changing POST requests can be triggered from malicious websites.

---

### INFRA-09: Clickjacking — Frame Options Disabled
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A05: Security Misconfiguration |
| CWE | CWE-928 |
| File | `SecurityConfig.java:39` |

**Description:** `headers().frameOptions().disable()` allows VulnTrade to be embedded in iframes on any site, enabling clickjacking attacks.

---

### INFRA-10: CORS Wildcard Origin
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A05: Security Misconfiguration |
| CWE | CWE-942 |
| File | `CorsConfig.java:18-26` |

**Description:** `setAllowedOriginPatterns("*")` permits requests from any origin with credentials enabled.

---

### INFRA-11: Vulnerable Dependencies (Supply Chain)
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A06: Vulnerable and Outdated Components |
| CWE | CWE-1035 |
| File | `pom.xml` |

**Description:** Intentionally vulnerable libraries:
- **log4j-core 2.14.1** — Log4Shell (CVE-2021-44228)
- **commons-collections 3.2.1** — Java deserialization gadget chains
- **jackson-databind 2.13.0** — Polymorphic type handling exploits

---

### INFRA-12: No Resource Limits on Containers
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A05: Security Misconfiguration |
| File | `docker-compose.yml` |

**Description:** Docker containers have no CPU or memory limits. A single DoS attack (e.g., heap dump request, large SQL query, WebSocket flood) can exhaust host resources.
