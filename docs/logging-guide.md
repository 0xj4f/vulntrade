# VulnTrade Logging Guide

This document defines the **canonical log event schema** emitted by VulnTrade's backend. Logs are written locally and shipped to S3 ([docs/log-shipping.md](log-shipping.md)), where any downstream SIEM (Wazuh, in our case — in a separate repo) consumes them. Reference detection content is temporarily parked under [wazuh/](../wazuh/) and will move out.

> Status: **target schema**. The current codebase partially implements this. See §Conformance below for what is implemented and what needs refactoring.

---

## 1. Log destinations

| File | Purpose | Consumed by |
|---|---|---|
| `/var/log/vulntrade/app.log` | All application events, **raw** (includes user-controlled fields verbatim — intentional log-injection sink for training). | Wazuh decoder `vulntrade-json`. Teaching artifact. |
| `/var/log/vulntrade/security.log` | Auth, authz, admin, and trading events with **sanitized** user-controlled fields (CR/LF/NUL stripped; `${` escaped). | Wazuh auth/authz/trading rules. Production-grade sink. |
| stdout (docker logs) | Human-readable, for `docker compose logs`. | Developers, not SIEM. |

Both log files use JSON, one event per line, via Log4j2 `JsonLayout` (`compact="true" eventEol="true"`).

---

## 2. Canonical JSON event shape

Every event written to `security.log` (and most events in `app.log`) must match this shape:

```json
{
  "@timestamp": "2026-04-21T14:32:17.412Z",
  "level": "INFO",
  "logger": "com.vulntrade.controller.AuthController",
  "thread": "http-nio-8085-exec-3",
  "application": "vulntrade",
  "environment": "production",

  "eventType": "AUTH_LOGIN_FAIL",
  "outcome": "FAILURE",
  "message": "login failure for reason=bad_password",

  "requestId": "8e1c6fa7-1b9e-4a0f-9a2c-5b6d8e0c1f2a",
  "sessionId": "ws-0fa5b3e1",
  "userId": null,
  "username": "alice",
  "clientIp": "203.0.113.42",
  "userAgent": "Mozilla/5.0 ...",

  "transport": "HTTP",
  "httpMethod": "POST",
  "path": "/api/auth/login",
  "httpStatus": 401,

  "details": { "reason": "bad_password" }
}
```

### Field reference

| Field | Type | Required? | Notes |
|---|---|---|---|
| `@timestamp` | ISO-8601 UTC | yes | Log4j2 default `timeMillis` rendered via `JsonLayout` timestamp key. |
| `level` | string | yes | `INFO`, `WARN`, `ERROR`, `DEBUG`. Wazuh `level` maps from this. |
| `logger` | string | yes | Fully qualified Java class. |
| `thread` | string | yes | Log4j2 default. |
| `application` | string | yes | Always `"vulntrade"` (KeyValuePair in `log4j2.xml`). |
| `environment` | string | yes | `"production"` / `"dev"`. |
| `eventType` | string | yes (security events) | Canonical name — see §3. Upper snake case. |
| `outcome` | string | yes (security events) | `SUCCESS`, `FAILURE`, `DENIED`, `ERROR`. |
| `message` | string | yes | Short human-readable sentence. **Must not contain user-supplied strings verbatim on `security.log`** — those go into `details`. |
| `requestId` | UUID v4 | yes | Set by `CorrelationIdFilter` / `CorrelationIdChannelInterceptor`. Propagated via MDC so controller → service → repository emit the same id. |
| `sessionId` | string | HTTP: optional; WS: yes | STOMP session id from `StompHeaderAccessor`. |
| `userId` | long \| null | yes | Authenticated principal id. `null` on unauth. |
| `username` | string \| null | yes | From JWT sub or form field. **If null on a failure event, do not substitute the attempted name without marking it as attempt** (see `AUTH_LOGIN_FAIL`). |
| `clientIp` | string | yes | X-Forwarded-For first-hop aware. For STOMP, extract from handshake headers. |
| `userAgent` | string | optional | HTTP only. |
| `transport` | string | yes | `HTTP` or `STOMP`. |
| `httpMethod` | string | HTTP only | |
| `path` | string | HTTP: URI; STOMP: destination | `/api/...` or `/app/...` / `/topic/...`. |
| `httpStatus` | int | HTTP only | |
| `details` | object | optional | Event-specific sub-object. See §3 for shape per event type. Nested to keep the top level flat for Wazuh decoders. |

### Raw-sink extras (app.log only)

`app.log` may contain additional unsanitized fields (`details.reason`, `details.symbol`, etc.) that preserve the attacker payload exactly. This is deliberate — it is the log-injection teaching artifact. Wazuh rules that scan for exploit patterns (`${jndi:`, `UNION SELECT`, `\n` injection) target `app.log`.

`security.log` gets the **same event** with those user-controlled fields:
- CR/LF/NUL/tab stripped
- `${` escaped to `$\u007b`
- Truncated to 256 chars
- Base64-encoded copy available at `details.raw_b64` if the sanitized value differs (so defenders can recover the attack payload for analysis without re-introducing the injection).

---

## 3. Event taxonomy

Wazuh rule IDs are allocated by prefix (5 digits, group 100xxx):

| Prefix | Range | Group |
|---|---|---|
| `AUTH_*` | 100000–100099 | vulntrade-auth |
| `AUTHZ_*` | 100200–100299 | vulntrade-authz |
| `INJ_*`, suspicious content markers | 100100–100199 | vulntrade-injection |
| `WS_*`, `STOMP_*` | 100400–100499 | vulntrade-websocket |
| `TRADE_*`, `ORDER_*`, `ACCOUNT_*`, `ADMIN_*` | 100300–100399 | vulntrade-trading |

### 3.1 Authentication (`vulntrade-auth`)

| eventType | outcome | When | Key `details` fields |
|---|---|---|---|
| `AUTH_LOGIN_SUCCESS` | SUCCESS | `/api/auth/login`, legacy login, STOMP CONNECT with valid JWT | `authMethod` (`PASSWORD`, `JWT`, `LEGACY`), `jti` |
| `AUTH_LOGIN_FAIL` | FAILURE | bad creds or user-not-found on login | `reason` (`user_not_found`, `bad_password`, `account_locked`), `attemptedUsername` |
| `AUTH_LOGIN_LEGACY` | SUCCESS/FAILURE | legacy endpoint hit (regardless of outcome) | as above |
| `AUTH_TOKEN_ISSUED` | SUCCESS | JWT minted | `jti`, `accountLevel`, `role`, `expiresAt` |
| `AUTH_TOKEN_VALIDATION_FAIL` | FAILURE | JWT parse/verify failure | `reason` (`expired`, `bad_signature`, `alg_none`, `malformed`) |
| `AUTH_PASSWORD_CHANGE` | SUCCESS/FAILURE | password mutated | `requiredOldPassword` (bool — reveals whether the intentional vuln was taken) |
| `AUTH_RESET_REQUEST` | SUCCESS | reset requested | `email` |
| `AUTH_RESET_CONFIRM` | SUCCESS/FAILURE | reset token redeemed | `tokenPresented` (redacted), `reason` |

### 3.2 Authorization (`vulntrade-authz`)

| eventType | outcome | When | Key `details` fields |
|---|---|---|---|
| `AUTHZ_DECISION` | SUCCESS/DENIED | every explicit role check or resource-ownership check | `subjectId`, `subjectRole`, `resourceType`, `resourceId`, `requiredRole` or `requiredOwner`, `decisionReason` |
| `AUTHZ_IDOR_PROBE` | DENIED | `requiredOwner` != `subjectId` and request would return another user's data | `resourceType`, `resourceId`, `subjectId` |
| `AUTHZ_ADMIN_ACCESS` | SUCCESS/DENIED | any `/api/admin/*` or `/app/admin.*` | `adminAction`, `subjectRole` |

### 3.3 Injection / content markers (`vulntrade-injection`)

Rather than emit a dedicated event type for every attack attempt (which would require knowing intent), rules in this group pattern-match on `details.*` fields of ordinary events. The application's job is just to put the raw input into a predictable sub-field so the rule can scan it:

| Signal | Where we look | Emitted by |
|---|---|---|
| `${jndi:` | `details.reason`, `details.symbol`, `details.message`, `details.query` | any `ADMIN_*`, `ALERT_CREATE`, `TRADE_HISTORY` |
| `UNION SELECT`, `' OR '1'='1`, `--`, `/**/` | `details.symbol`, `details.startDate`, `details.endDate`, `details.query` | `TRADE_HISTORY`, `ADMIN_QUERY`, `AUTH_LOGIN_LEGACY` |
| `<script`, `onerror=`, `javascript:` | `details.symbol`, `details.message`, `details.reason` | `ALERT_CREATE`, any admin event |
| `\n`, `\r` in user-controlled fields | `details.raw_b64` vs `details.reason` length delta | any audit/admin event |

### 3.4 WebSocket / STOMP (`vulntrade-websocket`)

| eventType | When | Key `details` fields |
|---|---|---|
| `WS_CONNECT` | STOMP CONNECT frame processed | `sessionId`, `loginHeaderPresent`, `authResult`, `tokenInUrl` (bool) |
| `WS_DISCONNECT` | STOMP DISCONNECT / connection close | `sessionId`, `durationMs`, `reasonCode` |
| `WS_SUBSCRIBE` | STOMP SUBSCRIBE | `sessionId`, `destination`, `authzDecision` |
| `WS_UNSUBSCRIBE` | STOMP UNSUBSCRIBE | `sessionId`, `destination` |
| `WS_SEND` | STOMP SEND (application destination `/app/*`) | `sessionId`, `destination`, `payloadSize`, `rateBucketCount` |
| `WS_RATE_EXCEEDED` | per-session message burst threshold crossed | `sessionId`, `window`, `count`, `threshold` |

### 3.5 Trading + admin (`vulntrade-trading`)

| eventType | When | Key `details` fields |
|---|---|---|
| `ORDER_PLACE` | new order | `orderId`, `symbol`, `side`, `orderType`, `quantity`, `price`, `tif` |
| `ORDER_CANCEL` | cancel | `orderId`, `requester` |
| `ORDER_MATCH` | matching engine produced a trade | `buyOrderId`, `sellOrderId`, `buyerId`, `sellerId`, `selfTrade` (bool), `symbol`, `qty`, `price` |
| `ACCOUNT_DEPOSIT` | deposit | `amount`, `balanceBefore`, `balanceAfter`, `source` |
| `ACCOUNT_WITHDRAW` | withdraw | `amount`, `balanceBefore`, `balanceAfter`, `stepUpRequired`, `stepUpPresented` |
| `ADMIN_BALANCE_ADJUST` | admin balance op | `targetUserId`, `amount`, `reason`, `newBalance` |
| `ADMIN_HALT_TRADING` | halt | `symbol`, `reason` |
| `ADMIN_SET_PRICE` | price override | `symbol`, `newPrice`, `oldPrice` |
| `ADMIN_QUERY_EXECUTE` | raw-SQL admin endpoint | `queryPreview` (first 200 chars) |
| `ALERT_CREATE` | price alert created | `alertId`, `symbol`, `targetPrice`, `direction` |

---

## 4. Conformance against current code

This is what the repo looks like **today** vs the target above. PR-1 Half B closes the gaps.

| Field / behavior | Current | Gap |
|---|---|---|
| JSON layout on `app.log` + `security.log` | present ([log4j2.xml](../backend/src/main/resources/log4j2.xml)) | — |
| `application`, `environment` KeyValuePairs | present | — |
| `eventType` discrete field | absent — prefixes are embedded in message strings (`"AUTH_LOGIN_SUCCESS: userId=..."`) | refactor all `logger.info`/`logger.warn` sites to use Log4j2 `KeyValuePair` or an `EventLogger` helper |
| `outcome` | absent | add |
| `requestId` MDC | absent | add `CorrelationIdFilter` (servlet) + `CorrelationIdChannelInterceptor` (STOMP) |
| `userId`, `clientIp`, `sessionId` MDC | absent / inconsistent | same filters populate MDC |
| JSON layout `properties="true"` | **already set** in log4j2.xml (good) — once MDC is populated, those keys auto-appear in JSON | — |
| `jti` on JWT | absent ([JwtTokenProvider.java:37-44,80-87](../backend/src/main/java/com/vulntrade/security/JwtTokenProvider.java:37)) | add `UUID.randomUUID()` as `jti` claim; log on issuance + validation failure |
| `AUTHZ_DECISION` emission | absent | add an `AuthorizationLogger` helper, call from every role check and ownership check |
| Sanitized sink | absent — `security.log` currently receives raw strings | add a `SanitizingRewritePolicy` / custom `Layout`, or emit `details.reason`/`details.symbol` through a `LogSanitizer.clean(...)` helper at call sites |
| Per-session STOMP rate counter | absent | add to `StompChannelInterceptor` |

---

## 5. How to add a new log site (developer checklist)

When introducing a new security-relevant log call:

1. Pick a canonical `eventType` from §3, or propose a new one (follow the `GROUP_VERB_NOUN` pattern and reserve a rule-id range).
2. Use the `EventLogger` helper (added in PR-1 Half B):
   ```java
   EventLogger.security("ORDER_PLACE", Outcome.SUCCESS, "order accepted",
       Map.of("orderId", order.getId(),
              "symbol", order.getSymbol(),
              "side",   order.getSide(),
              "qty",    order.getQuantity(),
              "price",  order.getPrice()));
   ```
3. The helper populates MDC-backed fields (`requestId`, `userId`, `clientIp`, `sessionId`, `transport`, `path`) automatically — do not re-include them.
4. For any user-controlled string in `details`, the helper will call `LogSanitizer.clean()` for `security.log` while preserving the raw value on `app.log`.
5. Add a Wazuh rule in the appropriate file under `wazuh/rules/` if the event warrants detection, and a test payload in `wazuh/test-payloads/`.

---

## 6. How to write a Wazuh rule against these events

1. Start with the JSON decoder in `wazuh/decoders/vulntrade-decoder.xml` — it already extracts `eventType`, `outcome`, `userId`, `clientIp`, `requestId`, and the `details.*` tree.
2. Use `<field name="eventType">` to match on the canonical name.
3. Escalate `level` based on `outcome` and frequency (see `wazuh/rules/vulntrade-auth.xml` for examples of `frequency`/`timeframe`).
4. Run `tools/wazuh-rule-test.sh <rule-id>` to replay sample events from `wazuh/test-payloads/` and confirm the rule matches without false positives.

---

## 7. Intentional weakness: the log-injection teaching artifact

`app.log` stays raw on purpose. Students can:
- Inject `\n{"eventType":"AUTH_LOGIN_SUCCESS","userId":1,...}` into the `reason` field of `ADMIN_BALANCE_ADJUST` and watch a forged event appear in `app.log`.
- Compare the same event on `security.log` (sanitized) and see the Base64 recovery in `details.raw_b64`.
- Write a Wazuh rule on `security.log` that detects the length/content mismatch between `details.reason` and decoded `details.raw_b64`.

This is the "why both sinks exist" lesson: one preserves the attack payload for forensics, the other preserves log integrity for detection. **Never simplify this to a single sink.**
