# VulnTrade Security Events

The events worth logging to `security.log` (the SIEM-bound sink) and the ones worth **not** logging. The rule: if a normal user doing normal things generates the event, it's the wrong event.

Target volume: **≤ 0.01% of total request rate**. At 45M req/s that's still ~4.5k events/s — manageable. If a proposed event would fire more often than that, it probably doesn't belong here.

---

## Log these (signal — Wazuh cares)

### Authentication

| Event | Outcome values | Why |
|---|---|---|
| `AUTH_LOGIN_FAIL` | FAILURE | Brute force, credential stuffing, user enum |
| `AUTH_LOGIN_SUCCESS` | SUCCESS | Needed as the baseline for "login after failure burst" rule |
| `AUTH_TOKEN_VALIDATION_FAIL` | FAILURE | JWT tampering, `alg:none`, expired replay |
| `AUTH_PASSWORD_CHANGE` | SUCCESS / FAILURE | Account takeover signal |
| `AUTH_RESET_CONFIRM` | SUCCESS / FAILURE | Token guessing |

### Authorization (log on **denial only** — ALLOWs are too noisy)

| Event | Outcome | Why |
|---|---|---|
| `AUTHZ_DENIED` | DENIED | Any 403 on protected resource |
| `AUTHZ_IDOR_PROBE` | DENIED | Subject tried to access another user's resource |
| `AUTHZ_ADMIN_ACCESS` | SUCCESS / DENIED | Admin endpoints — both directions, always low volume |

### Admin actions (always log — high-value, low-volume)

| Event | Why |
|---|---|
| `ADMIN_BALANCE_ADJUST` | Money move by privileged role |
| `ADMIN_SET_PRICE` | Market manipulation vector |
| `ADMIN_HALT_TRADING` | Market-wide impact |
| `ADMIN_QUERY_EXECUTE` | Raw SQL by admin — forensics gold |

### Money movement (always log)

| Event | Why |
|---|---|
| `ACCOUNT_DEPOSIT` | Source-of-funds risk |
| `ACCOUNT_WITHDRAW` | Exfiltration / step-up bypass |
| `ORDER_PLACE_ANOMALY` | Negative qty, negative price, zero price — not every order, just abnormal ones |

### Attack-content markers (log when detected)

Emitted automatically when known-bad patterns appear in user-controlled fields that flow into a log sink. Not one per request — one per detection.

| Event | Trigger |
|---|---|
| `CONTENT_JNDI_PATTERN` | `${jndi:` or obfuscated variants in any logged input |
| `CONTENT_SQLI_PATTERN` | SQL tautology / UNION / comment in inputs bound to a query |
| `CONTENT_XSS_PATTERN` | `<script`, `onerror=`, `javascript:` in stored fields |
| `CONTENT_PATH_TRAVERSAL` | `../`, `%2e%2e`, `\..\` in path-like fields |

### WebSocket (selective — not every frame)

| Event | Why |
|---|---|
| `WS_CONNECT_ANONYMOUS` | Unauthenticated CONNECT — should be rare |
| `WS_SUBSCRIBE_PRIVILEGED` | SUBSCRIBE to `/topic/admin/*` or `/user/{otherId}/*` |
| `WS_SEND_ADMIN_BY_NONADMIN` | SEND to `/app/admin.*` by non-admin role |
| `WS_RATE_EXCEEDED` | Per-session burst threshold crossed |

### Additions from the vuln inventory

After walking through `docs/vulns/01-08.md`, these specific events fill gaps the categories above don't cover. Everything else in the vuln list is already caught by events above, or isn't detectable at the application-log layer (client-side, infra, data-at-rest).

| Event | Triggered by | Why it's its own event |
|---|---|---|
| `AUTH_MASS_ASSIGNMENT_ROLE` | `POST /api/auth/register` with `role=ADMIN` in body accepted | Registration with elevated role is a one-shot, high-signal event |
| `CONTENT_LOG_INJECTION` | CR/LF detected in a field that will be logged (e.g. `reason`, `details`) | Distinct from SQLi/XSS — the attack is against the log pipeline itself |
| `DEBUG_RCE_EXECUTED` | `POST /api/debug/execute` returning success | RCE paths deserve their own event, not just a generic ADMIN_* |
| `DEBUG_ENDPOINT_ACCESSED` | any `/api/debug/*` request | Catches the "discover before execute" probe |
| `WASH_TRADE_DETECTED` | matching engine pairs buy+sell from the same `userId` | Market-integrity signal, doesn't fit ORDER_PLACE_ANOMALY |
| `ACCOUNT_LEVEL_UPGRADE` | user's `accountLevel` increments | Auto-upgrade on profile edit is a known vuln path |
| `WS_MESSAGE_SIZE_EXCEEDED` | STOMP SEND with payload > N bytes | Separate from rate; size-based DoS has a different shape |

### Explicitly NOT logged (even though they're real vulns)

These are real weaknesses but live below or beside the application log layer. Leaving them off keeps the log signal tight.

- Client-side only: XSS via `dangerouslySetInnerHTML`, JWT in localStorage, client-side-only 2FA, client-side P&L, client role checks, CSP absence.
- Infrastructure / data-at-rest: Redis unauth, Postgres default creds, Actuator endpoints, H2 console, JDWP/JMX ports, Adminer, `.env` exposure, plaintext SSN/API keys in DB. These need container/DB/host audit, not app logs.
- Response-shape leaks: API key in login response, PII in JWT claims, MM internal fields in price feed. The event is the request itself — not a distinct signal.
- Transport concerns: no CSRF token, CORS wildcard, Origin validation on WS handshake, token-in-URL. These are config audits, not per-request events.

---

## Do NOT log (noise — Wazuh doesn't care)

- Every order placement, fill, cancel (use metrics, not logs)
- Every price tick / market-data broadcast
- STOMP heartbeats and keepalives
- Successful authorization decisions (ALLOWs on user's own resources)
- GET requests that succeeded for the requesting user's own data
- Health checks, actuator probes, readiness pings
- Normal `SELECT` queries (Hibernate SQL logs → dev only, not security.log)

If one of these ever needs to be correlated with an attack, find it via the request trace (correlationId links the noisy app.log entries to the security.log marker), not by flooding security.log.

---

## Canonical JSON shape

Every line in `security.log` is one JSON object:

```json
{
  "@timestamp": "2026-04-21T14:32:17.412Z",
  "eventType": "AUTH_LOGIN_FAIL",
  "outcome": "FAILURE",
  "userId": null,
  "username": "alice",
  "clientIp": "203.0.113.42",
  "transport": "HTTP",
  "path": "/api/auth/login",
  "details": { "reason": "bad_password" }
}
```

Required: `@timestamp`, `eventType`, `outcome`, `clientIp`, `transport`. Everything else is nullable.

`details` carries event-specific fields — kept as a nested object so the top-level stays flat and easy to parse in Wazuh.

---

## What this means for Step 2

Step 2 adds ONE helper that emits exactly this JSON shape to `security.log`, and inserts ~10 calls to it at the sites that match events above. No existing log call is removed or refactored. The raw `app.log` stays exactly as it is.
