# VulnTrade Logging Guide

This is the spec for VulnTrade's security events: what is logged, where, in which shape, and which Wazuh rule reads it.

- **Source of truth:** the sheet [`data/VulnTrade Security Events.xlsx`](../data/VulnTrade%20Security%20Events.xlsx). It reuses the team baseline (`data/Security Events Baseline.xlsm`) layout and adds a "VulnTrade Specific" tab. If this guide and the sheet disagree, the sheet wins.
- **Shipping:** logs are shipped to S3 and read by Wazuh. See [log-shipping.md](log-shipping.md).
- **Rules:** [`wazuh/rules/`](../wazuh/rules/), tested by [`wazuh/test-payloads/`](../wazuh/test-payloads/).

The idea in one line: **the app writes one dumb fact per action; Wazuh does the thinking** (bursts, non-browser clients, follow-on actions).

---

## 1. Log destinations

| File | Written by | Format | Read by |
|---|---|---|---|
| `/var/log/vulntrade/app.log` | All `com.vulntrade` loggers and the root logger | Log4j2 `JsonLayout`, one JSON object per line. **Raw on purpose:** user input appears verbatim in `message`. | Wazuh content rules (Log4Shell, XSS, SQL errors). Log-injection teaching artifact (§10). |
| `/var/log/vulntrade/security.log` | `SecurityEventLogger` only, through the `SECURITY_EVENTS` logger | One JSON object per line. Jackson builds the JSON; Log4j2 writes it with `PatternLayout "%m%n"`. | All Wazuh event rules. |
| `/var/log/vulntrade/security-framework.log` | `com.vulntrade.security.*` and `org.springframework.security.*` loggers | Log4j2 `JsonLayout`, with `log_type=security-framework` | Developers, for debugging. No Wazuh event rule targets it. |
| stdout (`docker compose logs`) | Every logger above, including `SECURITY_EVENTS` | Human-readable `PatternLayout` | Developers, not the SIEM. |

- The files rotate daily or at 50 MB into `*-YYYY-MM-DD-N.log.gz`.
- `app.log` lines use Log4j2's own `JsonLayout` keys (`loggerName`, `message`, `contextMap.requestId`, ...). The rest of this guide describes `security.log`.

---

## 2. Canonical JSON event shape

Every line in `security.log` is one JSON object. The examples are pretty-printed for reading; on disk each event is a single line.

**HTTP example:** a failed login.

```json
{
  "@timestamp": "2026-10-08T14:32:17.412Z",
  "level": "WARN",
  "logger": "com.vulntrade.controller.AuthController",
  "thread": "http-nio-8080-exec-3",
  "application": "vulntrade",
  "environment": "production",
  "category": "authentication",
  "eventType": "login_failure",
  "outcome": "failure",
  "message": "login failure",
  "requestId": "8e1c6fa7-1b9e-4a0f-9a2c-5b6d8e0c1f2a",
  "clientIp": "203.0.113.42",
  "userAgent": "Mozilla/5.0 (X11; Linux x86_64) ...",
  "transport": "HTTP",
  "httpMethod": "POST",
  "path": "/api/auth/login",
  "details": { "reason": "bad_password", "attemptedUsername": "alice" }
}
```

Nobody is logged in yet, so `userId` and `username` are absent. The name the attacker typed is in `details.attemptedUsername`.

**STOMP example:** a non-admin sends an admin command over the WebSocket.

```json
{
  "@timestamp": "2026-10-08T14:35:02.118Z",
  "level": "WARN",
  "logger": "com.vulntrade.security.StompChannelInterceptor",
  "thread": "http-nio-8080-exec-7",
  "application": "vulntrade",
  "environment": "production",
  "category": "websocket",
  "eventType": "websocket_authorization_failed",
  "outcome": "failure",
  "message": "websocket authorization failed",
  "sessionId": "c1d9a2f4-7e3b-4b8a-9f61-2d5e8a0b7c13",
  "userId": 7,
  "username": "bob",
  "clientIp": "203.0.113.42",
  "userAgent": "Python/3.13 websockets/13.1",
  "transport": "STOMP",
  "path": "/app/admin.haltTrading",
  "details": { "role": "TRADER" }
}
```

STOMP events have no `requestId`. They correlate on `sessionId`.

### Field reference

Fields whose value is null are **omitted**, not written as `null`.

| Field | Type | Required? | Notes |
|---|---|---|---|
| `@timestamp` | ISO-8601 UTC | yes | Millisecond precision, always UTC (`...Z`). Written by `SecurityEventLogger`. |
| `level` | string | yes | `INFO` for `success`, `WARN` for `failure`/`denied`, `ERROR` for `error`. Wazuh rule levels are set by the rules, not by this field. |
| `logger` | string | yes | Fully qualified Java class that called `SecurityEventLogger`. |
| `thread` | string | yes | Java thread name, e.g. `http-nio-8080-exec-3` or `clientInboundChannel-4`. |
| `application` | string | yes | Always `"vulntrade"`. |
| `environment` | string | yes | From env var `APP_ENVIRONMENT`. Default `"production"`; `"dev"` locally. |
| `category` | string | yes (security events) | The sheet's Category in lower snake case: `authentication`, `input_validation`, `withdrawal`, ... Comes from the `SecurityEvent` enum. |
| `eventType` | string | yes (security events) | Canonical name, lower snake case. It is the `SecurityEvent` enum constant, lowercased. See §4. |
| `outcome` | string | yes (security events) | `success`, `failure`, `denied`, `error`. See §3 rule 2. |
| `message` | string | yes | The `eventType` with spaces (`login failure`). **Never contains user input** — user input goes into `details`. |
| `requestId` | UUID v4 | HTTP only | Set by `RequestLoggingFilter`. The same id is in `app.log` (MDC `requestId`), so controller → service → repository lines correlate. Absent on STOMP events, which correlate on `sessionId`. |
| `sessionId` | string | STOMP only | STOMP session id, from Spring's `SimpAttributesContextHolder`. Absent on HTTP events. |
| `userId` | long | when known | Logged-in user id. Filled automatically. Pre-auth events set it with `logAs(...)`. Absent when nobody is logged in. |
| `username` | string | when known | Logged-in username. Filled automatically. The placeholders `anonymous`/`anonymousUser` are written as absent. **On a failure, never put the attempted name here** — it goes in `details.attemptedUsername` (see `login_failure`). |
| `clientIp` | string | yes | First hop of `X-Forwarded-For`, else the socket address. Spoofable (see §9). For STOMP, taken from the WebSocket handshake request. |
| `userAgent` | string | yes | `User-Agent` header, `""` when the header is missing. For STOMP, the handshake request's header. |
| `transport` | string | yes | `HTTP` or `STOMP`. SockJS frames count as `STOMP`. |
| `httpMethod` | string | HTTP only | See the `HiddenHttpMethodFilter` note in §9. |
| `path` | string | HTTP: yes; STOMP: when known | HTTP: the raw request URI, without the query string (`/api/...`). STOMP: the destination (`/app/...`, `/topic/...`), only on events written where the code holds the STOMP message (interceptor checks, the trade auth gate). |
| `httpStatus` | int | fallback events only | Set only on events written by `RequestLoggingFilter` at the end of a request (§4.5). Every other event carries its result in `outcome`. |
| `details` | object | optional | Event-specific keys, listed per event in §4. Scalars only (string, number, boolean); null values are omitted. Nested so the top level stays flat for Wazuh. |

---

## 3. Design rules

1. **One event per action, at the point the outcome is known.**
   - Log success as the last statement before `return`.
   - Log failure inside the branch or `catch` that returns the error.
   - Never log at method entry. One exception: `debug_command_executed` is logged right before `exec`, so a command that never returns still shows up.
   - Use the most specific sheet event. If none fits, add a VulnTrade-specific *(VT)* event.
   - A privileged operation with no specific event logs `admin_action` with `details.action`.
   - A failed action logs the **same** event with a failure outcome (e.g. `order_cancelled` + `failure`).

2. **`outcome` follows the name.**

   | Event name | `outcome` |
   |---|---|
   | ends in `_failure` or `_failed` | `failure` |
   | ends in `_rejected`, `_denied`, `_exceeded`, or contains `_invalid_` | `denied` |
   | ends in `_created`, `_completed` or `_success` | `success` |
   | `unexpected_exception` | `error` |
   | any other (neutral) name, e.g. `password_changed`, `order_cancelled` | `success` or `failure` |

   `failure` means a check failed, even if VulnTrade carries on anyway. Carrying on is the vuln.

3. **Dumb facts only.**
   - No "detected", no thresholds, no verdicts in Java. Wazuh decides.
   - The only computed values allowed are equality booleans that a Wazuh rule can't compute (a rule can't compare two fields of one event): `isOwner` and `selfTrade`.
   - The subject of an action is always `details.targetUserId`.

4. **Vulns are preserved.**
   - Logging sits next to the vuln. Nothing is fixed. No response body or status changes.
   - A check that should block but doesn't logs the failed check. The follow-on action logs its own event. Wazuh correlates the two.

5. **Actor and request fields are automatic.** Never copy `userId`, `clientIp` or `path` into `details`.
   - Every pre-auth `AuthController` event uses `logAs(...)`: `login_*`, `account_created`, `password_reset_*`.
   - Failures pass `null` as the user, because a stale Bearer token may be attached to `/api/auth/**`.
   - The placeholder names `anonymous`/`anonymousUser` are written as absent.

6. **`details`: scalars only, nulls omitted.**
   - **Never log secrets:** passwords, JWTs, reset tokens, API keys, `e.getMessage()`. For errors, log the exception class name (`errorType`, `exception`).
   - **Do log raw user input** (symbol, query, filters, `attemptedUsername`) so the Wazuh content rules can scan it.

7. **Own-data reads are not logged.** The Dashboard polls every 30 s.
   - Cross-user reads are always logged.
   - `GET /api/leaderboard/{id}/detail` is deliberately not logged: the UI calls it on every row click (see §7).

---

## 4. Event catalog by category

Grouped like the sheet's tabs. *(VT)* marks a VulnTrade-specific event. Actor and request fields are automatic, so only `details` keys are listed. Classes are under `backend/src/main/java/com/vulntrade/`.

### 4.1 Baseline Security Events tab

| Category | Security Event | Outcome | Logged at | details |
|---|---|---|---|---|
| authentication | `login_success` | success | `AuthController.login` (POST and GET `/api/auth/login`), `AuthController.loginLegacy` | `role`; legacy also `attemptedUsername` |
| authentication | `login_failure` | failure | `login`: user_not_found, bad_password, account_disabled. `loginLegacy`: the same, plus `reason=error` in its `catch`. | `reason`, `attemptedUsername` |
| authentication | `logout` | success | `AuthController.logout` | — |
| session | `session_created` | success | `StompChannelInterceptor`, on a STOMP CONNECT that resolved an identity | `role`, `origin` |
| token | `refresh_token_used` | success / failure | `AuthController.refreshToken` | `reason=user_not_found` on failure |
| credentials | `password_changed` | success / failure | `AuthController` PUT `/api/auth/change-password` | `reason=user_not_found` (forged token) |
| credentials | `password_reset_requested` | success if the email is found, else failure | `AuthController` POST `/api/auth/reset` | `email` |
| credentials | `password_reset_completed` | success / failure | `AuthController` POST `/api/auth/reset-confirm`; failure on invalid_token, user_not_found | `targetUserId`, `resetTokenId` (row id; a repeat means token reuse), `reason` |
| account | `account_created` | success | `AuthController.register` | `role` (as sent by the client) |
| account | `account_disabled` / `account_enabled` | success | `AdminController.toggleUser` (one call; the name follows the new state) | `targetUserId` |
| user | `profile_updated` | success | PUT `/api/users/{id}` with no `email` key | `targetUserId`, `changedFields` (comma-separated key names), `isOwner` |
| user | `security_attribute_updated` | success | The same call when `email` is present | `targetUserId`, `changedFields`, `isOwner` |
| authorization | `authorization_denied` | denied | `RequestLoggingFilter` fallback for HTTP 401/403 (Spring Security defaults, manual 401s, debug-key 403s). `TradeStompController.denyUnauthenticated` (9 STOMP handlers). | — (`httpStatus` and `username` tell the story) |
| authorization | `permission_changed` | success | PUT `/api/users/{id}/profile` auto-verify, only on the change to level 2 | `targetUserId`, `accountLevel`, `isOwner` |
| data | `sensitive_data_read` | success / failure | **Cross-user only:** GET `/api/users/{id}`, `/api/users/{id}/portfolio`, `/api/users/{id}/verification-status`, `/api/accounts/transactions?userId=`, `/api/orders/{id}`, `/api/orders?userId=`, `/api/leaderboard?userId=`; STOMP `/app/trade.getPortfolio`. **Always:** GET `/api/admin/users`, `/api/debug/user-info`; STOMP `/app/trade.getHistory` (failure in its `catch`). | `resource`, `targetUserId` (absent for list-all); history also `startDate`, `endDate`, `symbol`, `errorType` |
| data | `sensitive_data_updated` | success | PUT `/api/users/{id}/profile` (KYC PII; also covers the token it mints) | `resource=kyc_profile`, `targetUserId`, `changedFields`, `isOwner` |
| data | `sensitive_data_deleted` | success | DELETE `/api/orders/{id}` | `resource=order`, `orderId` |
| data | `data_exported` | success / failure | `ExportController`: `/api/export/trades`, `/api/export/all-trades`, `/api/export/portfolio` (failure in the `catch` of the last two) | `resource`, `targetUserId`, `isOwner`, `rowCount`, `symbol` (raw), `errorType` |
| file | `file_created_or_uploaded` | success | POST `/api/users/{id}/photo` | `targetUserId`, `isOwner`, `contentType`, `originalFilename`, `size` |
| administration | `admin_action` | success / failure | `AdminController`: execute-query (failure in its `catch`), adjust-balance. `AdminService`: adjustBalance, haltTrading, resumeTrading, setPrice. | `action` (`adjust_balance`, `set_price`, `halt_trading`, `resume_trading`, `execute_query`), plus whichever apply: `targetUserId`, `amount`, `reason`, `symbol`, `newPrice`, `query`, `errorType` |
| audit | `audit_configuration_changed` | success (= request received) | `FrameworkAccessLogFilter`, on POST `/actuator/loggers/*`. The only event for that request. It is written before the request can switch `SECURITY_EVENTS` off. | `loggerName` |

### 4.2 Trading Baseline tab

| Category | Security Event | Outcome | Logged at | details |
|---|---|---|---|---|
| funding | `deposit_completed` | success | `AccountController.deposit` (HTTP), `AccountService.deposit` (STOMP) | `amount`, `source`, `balanceAfter`, `transactionId` |
| funding | `deposit_failed` | failure | `AccountController.deposit`: account-level gate, invalid amount, user_not_found | `reason`, `accountLevel` |
| withdrawal | `withdrawal_completed` | success | `AccountController.withdraw` (HTTP), `AccountService.withdraw` (STOMP) | `amount` (signed, as sent), `destination`, `balanceAfter`, `transactionId` |
| withdrawal | `withdrawal_rejected` | denied | `AccountController.withdraw`: account level, invalid amount, insufficient funds, user_not_found. `AccountService.withdraw`: insufficient funds. | `reason`, `amount` |
| order | `order_created` | success | `OrderService.placeOrder`, the single shared point for REST and STOMP placeOrder/executeMarket | `orderId`, `symbol`, `side`, `orderType`, `quantity`, `price`, `clientOrderId` |
| order | `order_rejected` | denied | `OrderService.placeOrder` / `executeMarketOrder` | `reason` (`trading_halted`, `risk_check_failed`, `unknown_symbol`, `no_market_price`), `symbol`, `side`, `quantity`, `price` |
| order | `order_cancelled` | success / failure | `OrderController.cancelOrder` (REST) and `OrderService.cancelOrder` (STOMP), with the same keys | `orderId`, `symbol`, `targetUserId` (the order's owner), `isOwner`; failure: `reason=already_closed` |
| trade | `trade_executed` | success | `MatchingEngineService.executeTrade`, once per fill | `tradeId`, `symbol`, `quantity`, `price`, `buyerId`, `sellerId`, `buyOrderId`, `sellOrderId`, `selfTrade` |

Orders and trades are user-initiated only. No in-app bot places orders. House/LP fills show up only as the `buyerId`/`sellerId` = 1 side of `trade_executed`.

### 4.3 Generic Security Events tab (written by the app)

| Category | Security Event | Outcome | Logged at | details |
|---|---|---|---|---|
| websocket | `websocket_authentication_failed` | failure | `StompChannelInterceptor`, CONNECT with no valid identity (anonymous is still let in) | `reason` (`missing_token`, `invalid_token`), `origin` |
| websocket | `websocket_authorization_failed` | failure | `StompChannelInterceptor`, SUBSCRIBE `/topic/admin/*` or SEND `/app/admin.*` by a non-admin (never blocked) | `role` |
| websocket | `websocket_message_size_exceeded` | denied | `StompEventListener`, disconnect with close code 1009 | `closeCode` |
| websocket | `websocket_invalid_message` | denied | `StompEventListener`, disconnect with close code 1002 | `closeCode` |
| input_validation | `input_validation_failed` | failure | `RequestLoggingFilter` fallback for HTTP 400 | — |
| application | `unexpected_exception` | error | `RequestLoggingFilter`: an exception escaped the chain (always, `httpStatus=500`), or a 5xx fallback | `exception` (root-cause class name) |

The rest of the Generic tab (`brute_force_detected`, `sql_injection_detected`, ...) is detected by Wazuh, not written by the app. See §6.

### 4.4 VulnTrade Specific tab

| Category | Security Event | Outcome | Logged at | details |
|---|---|---|---|---|
| authentication | `api_key_used` *(VT)* | success / failure | `ApiKeyAuthFilter`; failure in a new `else` branch. The key is never logged. | `source` (`header`, `query`) |
| token | `token_validation_failed` *(VT)* | failure | `JwtTokenProvider.validateTokenAndLogFailure`, called **only** from `JwtAuthFilter` and the first CONNECT token check. Blank tokens are skipped. | `reason` (`expired`, `alg_none`, `bad_signature`, `malformed`) |
| alert | `price_alert_created` *(VT)* | success | `AlertService.createAlert` | `alertId`, `symbol` (raw), `targetPrice`, `direction` |
| debug | `debug_command_executed` *(VT)* | success | `DebugController.execute`, right before `exec`. A bad debug key falls through to the `authorization_denied` fallback. | `command` |
| debug | `debug_query_executed` *(VT)* | success / failure | `DebugController.executeQuery` | `query`, `errorType` |
| framework | `framework_endpoint_accessed` *(VT)* | success | `FrameworkAccessLogFilter`, classified on the decoded path | `surface` (`actuator`, `h2_console`, `swagger`), `endpoint`; `jdbcUrl` from param `url` on any `/h2-console/*.do` (never the password) |

### 4.5 How the fallback works

`RequestLoggingFilter` wraps every HTTP request. It never writes to or changes the response.

- It sets `requestId` (request attribute + MDC).
- If an exception escapes, it logs `unexpected_exception` with `httpStatus=500` and rethrows.
- At the end of the request, if **no other event** was logged for it, it logs one fallback with the final status:

  | Final status | Fallback event |
  |---|---|
  | 400 | `input_validation_failed` |
  | 401, 403 | `authorization_denied` |
  | 5xx | `unexpected_exception` |

- Four "context" events do **not** count as "another event": `token_validation_failed`, `api_key_used`, `framework_endpoint_accessed`, `audit_configuration_changed`. Example: a bad JWT on a request that ends in 401 gives `token_validation_failed` **and** `authorization_denied`, with the same `requestId`.

### 4.6 Folded events

These sheet events apply, but another event already carries the fact:

| Sheet event | Carried by |
|---|---|
| `access_token_issued` | the event that mints the token: `login_success`, `account_created`, `refresh_token_used`, `sensitive_data_updated` |
| `trade_partially_filled`, `trade_fully_filled` | `trade_executed` (one per fill) |
| `position_opened`, `position_closed`, `position_changed` | `trade_executed` |
| `balance_changed` | `deposit_completed`, `withdrawal_completed`, `trade_executed`, `admin_action` |
| `risk_limit_triggered` | `order_rejected` (`reason=risk_check_failed`) |
| `api_key_created` | `account_created` |

Sheet events that don't apply to VulnTrade (MFA, account lock, payment destinations, margin, rate limiting, ...) are listed with a one-line reason in the sheet's **Not Applicable** tab.

---

## 5. Old → new names

Every old `UPPER_SNAKE` name from the old guide, the old `security-events.md` and the code.

| Old name | New |
|---|---|
| `AUTH_LOGIN_FAIL` | `login_failure` |
| `AUTH_LOGIN_SUCCESS` | `login_success` |
| `AUTH_LOGIN_LEGACY` | dropped (it was logged at method entry with outcome `ATTEMPT`). The result is now `login_success` / `login_failure` with `path=/api/auth/login-legacy`. |
| `AUTH_LOGIN_LEGACY_FAIL` | `login_failure` (`path=/api/auth/login-legacy`) |
| `AUTH_LOGIN_LEGACY_SUCCESS` | `login_success` (`path=/api/auth/login-legacy`) |
| `AUTH_MASS_ASSIGNMENT_ROLE` | dropped (a verdict). `account_created` logs `details.role`; Wazuh 110025 decides (`mass_assignment_detected`). |
| `AUTH_REGISTER` | `account_created` |
| `AUTH_RESET_REQUEST` | `password_reset_requested` |
| `AUTH_RESET_CONFIRM` | `password_reset_completed` |
| `AUTH_PASSWORD_RESET` | `password_reset_completed` |
| `AUTH_PASSWORD_CHANGE` | `password_changed` (the always-false `requiredOldPassword` is dropped) |
| `AUTH_LOGOUT` | `logout` |
| `AUTH_TOKEN_ISSUED` | folded (sheet `access_token_issued`, see §4.6) |
| `AUTH_TOKEN_VALIDATION_FAIL` | `token_validation_failed` |
| `AUTHZ_DECISION` | dropped (allows are noise). Denials are `authorization_denied`; cross-user access is `isOwner=false` on the action's own event. |
| `AUTHZ_DENIED` | `authorization_denied` |
| `AUTHZ_IDOR_PROBE` | dropped (a verdict). Cross-user reads are `sensitive_data_read`; Wazuh 110061 decides (`idor_enumeration_detected`). |
| `AUTHZ_ADMIN_ACCESS` | dropped. Admin denials are `authorization_denied`; admin work is `admin_action` / `sensitive_data_read`. |
| `USER_PROFILE_UPDATE` | `profile_updated`, or `security_attribute_updated` when `email` changes |
| `USER_VERIFICATION_UPDATE` | `sensitive_data_updated` + `permission_changed` (level change) |
| `USER_PHOTO_UPLOAD` | `file_created_or_uploaded` |
| `ACCOUNT_LEVEL_UPGRADE` | `permission_changed` |
| `ADMIN_USER_TOGGLE` | `account_disabled` / `account_enabled` |
| `ADMIN_BALANCE_ADJUST` | `admin_action` (`adjust_balance`) |
| `ADMIN_HALT_TRADING` | `admin_action` (`halt_trading`) |
| `ADMIN_SET_PRICE` | `admin_action` (`set_price`) |
| `ADMIN_QUERY_EXECUTE` | `admin_action` (`execute_query`) |
| `ACCOUNT_DEPOSIT` | `deposit_completed` |
| `ACCOUNT_WITHDRAW` | `withdrawal_completed` |
| `ORDER_PLACE` | `order_created` |
| `ORDER_PLACE_ANOMALY` | dropped (a verdict). Every order is `order_created`; judging the values is Wazuh's job. |
| `ORDER_CANCEL` | `order_cancelled` |
| `ORDER_MATCH` | `trade_executed` |
| `WASH_TRADE_DETECTED` | dropped (a verdict). `trade_executed` logs `selfTrade`; Wazuh 110376 decides (`wash_trade_detected`). |
| `ALERT_CREATE` | `price_alert_created` (the old name was never emitted) |
| `DEBUG_ENDPOINT_ACCESSED` | dropped (entry log). Split into `debug_command_executed`, `debug_query_executed`, and `sensitive_data_read` for `/api/debug/user-info`. |
| `DEBUG_RCE_EXECUTED` | `debug_command_executed` |
| `FRAMEWORK_ACTUATOR_ACCESS` | `framework_endpoint_accessed` (`surface=actuator`); POST `/actuator/loggers/*` is `audit_configuration_changed` |
| `FRAMEWORK_H2_CONSOLE_ACCESS` | `framework_endpoint_accessed` (`surface=h2_console`) |
| `FRAMEWORK_SWAGGER_ACCESS` | `framework_endpoint_accessed` (`surface=swagger`) |
| `WS_CONNECT` | `session_created` or `websocket_authentication_failed` |
| `WS_CONNECT_ANONYMOUS` | `websocket_authentication_failed` |
| `WS_DISCONNECT` | dropped (per-frame noise). Only close codes 1009/1002 are logged (`websocket_message_size_exceeded`, `websocket_invalid_message`). |
| `WS_SUBSCRIBE` | dropped (per-frame noise). A non-admin SUBSCRIBE to `/topic/admin/*` is `websocket_authorization_failed`. |
| `WS_SUBSCRIBE_PRIVILEGED` | `websocket_authorization_failed` |
| `WS_UNSUBSCRIBE` | dropped (per-frame noise) |
| `WS_SEND` | dropped (per-frame noise). A non-admin SEND to `/app/admin.*` is `websocket_authorization_failed`. |
| `WS_SEND_ADMIN_BY_NONADMIN` | `websocket_authorization_failed` (outcome `failure`, no longer `SUCCESS`); Wazuh 110440/110441 |
| `WS_RATE_EXCEEDED` | dropped (no rate limiter exists; sheet `websocket_rate_limit_triggered` is N/A) |
| `WS_MESSAGE_SIZE_EXCEEDED` | `websocket_message_size_exceeded` |
| `CONTENT_JNDI_PATTERN` | Wazuh 110100, 110101 (`log4shell_detected`) |
| `CONTENT_SQLI_PATTERN` | Wazuh 110110, 110111, 110112, 110113, 110114 (`sql_injection_detected`) |
| `CONTENT_XSS_PATTERN` | Wazuh 110120 (`script_injection_detected`) |
| `CONTENT_PATH_TRAVERSAL` | Wazuh 110150 (`path_traversal_detected`) |
| `CONTENT_LOG_INJECTION` | Wazuh 110131 (`log_injection_detected`) |

---

## 6. Wazuh

### 6.1 How events reach the rules

- `security.log` and `app.log` go to S3 (see [log-shipping.md](log-shipping.md)). Wazuh's `aws-s3` wodle reads them.
- The wodle wraps each line as `{"integration":"aws","aws":{...}}`. So rules see **`aws.<field>`** (`aws.eventType`, `aws.clientIp`) and **`aws.details.<key>`** (`aws.details.reason`).
- **All scalars arrive as strings:** `"7"`, `"true"`, `"1E+7"`.
- Every VulnTrade line lands on `110090`. Every `security.log` event lands on `110091`.
- **Timeframes are measured at ingest time**, not at `@timestamp`. Wazuh polls S3 every 5 minutes, so events from one attack can arrive in one batch or be split across two polls. Keep correlation windows generous (e.g. 360 s).

### 6.2 Rule conventions

1. Every `<field>`/`<regex>` uses `type="pcre2"`, with `(?i)` where case shouldn't matter.
2. One base rule per `eventType` under `110091`. Refinements (reason, path, isOwner, amount, action) are children of that base rule.
3. Bursts count the base rule. Extra conditions go on a **child of the burst**. Wazuh remembers an event only under the rule it finally lands on.
   - If a burst must also count events that land on the base rule's children, give the base rule and those children one `vt_*` group and count the group: `<if_sid>base</if_sid>` + `<if_matched_group>vt_group</if_matched_group>`. The login bursts do this (`vt_login_failure` = 110001, 110006, 110014).
   - Never also point an `if_matched_sid` at a rule in such a group. Wazuh then keeps that rule's events only for the `if_matched_sid`, and the group count misses them.
4. Never use level 0 below `110090`. Level 2 = remembered, no alert.
5. Neutral-name events (§3 rule 2) carry their result only in `aws.outcome`. A rule that means one result filters on `aws.outcome`; a rule that covers both shows `$(aws.outcome)` in its description.
6. Correlation keys:
   - `aws.requestId` for two facts from one HTTP request;
   - `aws.sessionId` for STOMP;
   - `aws.clientIp` / `aws.username` / `aws.details.attemptedUsername` for bursts.
7. A rule may reference only ids in its own file or an earlier file (files load alphabetically).
8. Booleans match `(?i)^(true|false)$`. Amounts may use scientific notation, so match them with `(?i)…e\+?…`.

Descriptions start with `VulnTrade: `. A detection from the sheet puts its sheet name next, e.g. `VulnTrade: brute_force_detected - 8 failed logins in 60s from ...`.

### 6.3 Wazuh-only detections

These sheet events are never written by the app. A rule builds them from the dumb events.

**Generic Security Events tab**

| Detection | Rule id(s) | Fed by |
|---|---|---|
| `brute_force_detected` | 110002 (8 failed logins in 60 s from one IP), 110016 (8 in 60 s on one `attemptedUsername`), 110005 (success right after a burst), 110024 (5 failed resets in 60 s from one IP), 110028 (5 invalid API keys in 60 s from one IP) | `login_failure`, `login_success`, `password_reset_completed` (failure), `api_key_used` (failure) |
| `credential_stuffing_detected` | 110015 (burst from a non-browser `userAgent`), 110003 (many different unknown usernames from one IP) | `login_failure` |
| `unauthorized_access_attempt` | 110033 (10 denied requests in 60 s from one IP) | `authorization_denied` |
| `sql_injection_detected` | 110112 (`attemptedUsername`), 110110 / 110111 / 110114 (`symbol` / `startDate` / `endDate`), 110113 (SQL error in `app.log`) | any event carrying those `details` keys; `app.log` |
| `command_injection_detected` | 110140 | `debug_command_executed` |
| `script_injection_detected` | 110120 | XSS pattern in any field, either file |
| `unsafe_deserialization_detected` | 110102 (serialized Java object), 110103 (Spring4Shell) | any field, either file |
| `path_traversal_detected` | 110150 | traversal pattern in any field, either file |
| `malicious_file_upload_detected` | 110056 | `file_created_or_uploaded` (`originalFilename`, `contentType`) |

**VulnTrade Specific tab**

| Detection | Rule id(s) | Fed by |
|---|---|---|
| `log4shell_detected` | 110100, 110101 (obfuscated) | `${jndi:` or nested lookups in any field, either file |
| `mass_assignment_detected` | 110025 | `account_created` with `role` other than `TRADER`/`USER` |
| `token_forgery_detected` | 110011 (`alg_none`), 110010 (other non-expired reasons), 110012 (burst of bad_signature/malformed; alg_none alerts on its own) | `token_validation_failed` |
| `token_laundering_detected` | 110031 | `refresh_token_used` success with the same `requestId` as an `alg_none` failure |
| `account_takeover_detected` | 110017 | `password_changed` success with the same `requestId` as an `alg_none` failure |
| `idor_enumeration_detected` | 110061 (one user, many `targetUserId`s), 110055 (any `isOwner=false`), 110374 (cancel someone else's order) | `sensitive_data_read`; identity/data events with `isOwner=false`; `order_cancelled` |
| `sign_flip_detected` | 110301 (withdrawal), 110302 (deposit) | `withdrawal_completed`, `deposit_completed` with a negative `amount` |
| `double_spend_detected` | 110303 | `withdrawal_completed` with a negative `balanceAfter` |
| `wash_trade_detected` | 110376 | `trade_executed` with `selfTrade=true` |
| `admin_channel_bypass_detected` | 110440 (non-admin SEND to `/app/admin.*`), 110441 (`admin_action` on the same `sessionId` within 360 s) | `websocket_authorization_failed`, `admin_action` |
| `log_injection_detected` | 110131 | CR/LF in `details.reason` of any event |
| `log_tampering_detected` | 110165 | `audit_configuration_changed` |
| `h2_console_rce_detected` | 110164 | `framework_endpoint_accessed` with a `jdbcUrl` containing `INIT=`, `RUNSCRIPT` or `CREATE ALIAS` |

### 6.4 Rule files and id ranges

Same 7 files as before. Old ids are kept where the meaning carried over.

| File | Ids | What's in it |
|---|---|---|
| `vulntrade-00-base.xml` | 110090–110099 | `110090` any VulnTrade line (level 0). `110091` any `security.log` event (`aws.eventType` matches `^\w+$`; the naming rule lives in the Java enum). |
| `vulntrade-10-auth.xml` | 110001–110049 | Logins, legacy login (110013/110014), logout, tokens (110009 expired, level 3), passwords and resets (110020–110024), `account_created`, API keys (110027/110028), refresh (110030/110031), `authorization_denied` (110032/110033). |
| `vulntrade-15-identity.xml` | 110050–110089 | Profile and security attributes, `permission_changed` (110051, level 5), uploads, account toggle (110053), sensitive data read/update/delete, exports, shared `isOwner=false` rule (110055). |
| `vulntrade-20-injection.xml` | 110100–110159 | Content rules (Log4Shell, deserialization, SQLi, XSS, log injection, traversal), `input_validation_failed` (110104/110105), `unexpected_exception` (110106/110107), debug (110140, 110143). |
| `vulntrade-25-framework.xml` | 110160–110179 | `framework_endpoint_accessed` by `surface` (110160–110163; 110161 = sensitive actuator endpoints), H2 RCE (110164), log tampering (110165). |
| `vulntrade-30-trading.xml` | 110300–110399 | Funding and withdrawal (negative, large, `balanceAfter`), `admin_action` (110320 and children 110330–110340), orders (110370–110374), trades (110375/110376). |
| `vulntrade-40-websocket.xml` | 110400–110499 | `websocket_authentication_failed` (110401, burst 110430), admin topics (110410, sweep 110412), admin commands (110440/110441), close codes (110450–110452). |

Retired ids: `110004`, `110141`, `110142`. There is deliberately no rule for `session_created` (`110091` is enough, and it avoids simulator noise).

---

## 7. Not logged (noise)

Rule of thumb: log every action that changes something or touches another user's data. Skip reads of your own data and background traffic.

**Not logged:**
- Reads of your own data (`/api/users/me`, own balance, own portfolio, own orders). The Dashboard polls every 30 s.
- `GET /api/leaderboard/{id}/detail`. The UI calls it on every row click.
- Market data: `/api/market/*`, price ticks, order-book broadcasts.
- STOMP heartbeats and normal SUBSCRIBE / UNSUBSCRIBE / SEND / DISCONNECT frames.
- Health checks (`/api/health`).
- Successful authorization decisions (allows).
- The public photo `GET /api/users/{id}/photo` (sheet `file_downloaded` is N/A).
- Normal SQL. Hibernate SQL is set to WARN.

**Changed from before:** orders and trades **are** logged now (`order_*`, `trade_executed`). They are user-initiated, and the lab's volume is small.

**Real vulns with no app event** (they live below or beside the application log):
- Client-side only: XSS via `dangerouslySetInnerHTML`, JWT in localStorage, client-side 2FA, client-side P&L, client role checks, no CSP.
- Infrastructure / data at rest: Redis without auth, Postgres default credentials, JDWP/JMX ports, Adminer, `.env` exposure, plaintext SSN/API keys in the DB.
- Response-shape leaks: API key in the login response, PII in JWT claims, market-maker fields in the price feed.
- Transport config: no CSRF token, CORS wildcard, no WebSocket origin check, token in URL.

Actuator and the H2 console used to be on this list. They are logged now (`framework_endpoint_accessed`).

To investigate something noisy, follow `requestId` from `security.log` into `app.log`.

---

## 8. Junior checklist: adding an event

1. **Sheet.** Add the row to [`data/VulnTrade Security Events.xlsx`](../data/VulnTrade%20Security%20Events.xlsx), in the right tab: Category, Security Event, Why, Where in VulnTrade. Not in the baseline? Use the "VulnTrade Specific" tab.
2. **Enum.** Add the constant to `security/logging/SecurityEvent.java`, under its category comment:
   `PRICE_ALERT_CREATED("alert"),`
3. **Log call.** Call `SecurityEventLogger.log(SecurityEvent.X, Outcome.Y, details(...))` at the point the outcome is known (§3 rule 1). Pick the outcome from the name (§3 rule 2).
4. **Wazuh rule.** Add or adjust a rule in the right file under `wazuh/rules/` (§6.2). In `wazuh/test-payloads/cases.jsonl`, add a positive case, and for a burst also an N-1 "must not fire" case.
5. **Test.** Run the harness against a local manager:
   ```bash
   docker run -d --name vt-wazuh wazuh/wazuh-manager:4.14.5   # the image has an arm64 build; no --platform needed
   docker cp wazuh/rules/. vt-wazuh:/var/ossec/etc/rules/
   ./wazuh/test-payloads/run-logtest.py --docker vt-wazuh
   ```
   All cases must pass with no WARNING lines. To test on the AWS manager instead, pass its instance id (`run-logtest.py <instance-id>`, runs over SSM).

### The `SecurityEventLogger` API

| Method | Use it for |
|---|---|
| `log(event, outcome, details)` | Almost everything. |
| `logAs(userId, username, event, outcome, details)` | Pre-auth events (`login_*`, `account_created`, `password_reset_*`). Pass `null, null` on failure. |
| `details(Object... kv)` | Building `details`. Skips nulls, never throws. Use it instead of `Map.of` (which throws on nulls). |
| `logStomp(accessor, event, outcome, details)` | Code that holds the STOMP message. Adds `path` = destination and the user from the principal. |
| `isOwner(Long targetUserId)` | `true` if the logged-in user is the target. `false` when nobody is logged in. |
| `currentUserId()` | The logged-in user's id, or `null`. |
| `rememberUser(userId, username)` | Only in `JwtAuthFilter` / `ApiKeyAuthFilter`, right after `setAuthentication`. |
| `shorten(text)` | First 1000 characters of a long value. |

You only need the first three for most work.

### Examples

```java
import com.vulntrade.security.logging.Outcome;
import com.vulntrade.security.logging.SecurityEvent;
import static com.vulntrade.security.logging.SecurityEventLogger.*;
```

**1. Plain `log`:** success, as the last statement before `return`.

```java
Alert saved = alertRepository.save(alert);
log(SecurityEvent.PRICE_ALERT_CREATED, Outcome.SUCCESS,
        details("alertId", saved.getId(),
                "symbol", symbol,              // raw user input, on purpose
                "targetPrice", targetPrice,
                "direction", direction));
return saved;
```

**2. `logAs`:** pre-auth, nobody is logged in yet.

```java
if (!passwordMatches) {
    // Failure: pass null for the user. The typed name goes in details.
    logAs(null, null, SecurityEvent.LOGIN_FAILURE, Outcome.FAILURE,
            details("reason", "bad_password", "attemptedUsername", username));
    return ResponseEntity.status(401).body(error);
}

logAs(user.getId(), user.getUsername(), SecurityEvent.LOGIN_SUCCESS, Outcome.SUCCESS,
        details("role", user.getRole()));
return ResponseEntity.ok(body);
```

**3. `isOwner`:** an action that can touch another user's data.

```java
log(SecurityEvent.ORDER_CANCELLED, Outcome.SUCCESS,
        details("orderId", order.getId(),
                "symbol", order.getSymbol(),
                "targetUserId", order.getUserId(),       // the subject is always targetUserId
                "isOwner", isOwner(order.getUserId())));  // false = cross-user (IDOR)
return ResponseEntity.ok(order);
```

---

## 9. Known limits

- **Some login failures are not counted by the login bursts.** A failure whose `attemptedUsername` is SQL (110112) or a Log4Shell / serialized-object payload (110100–110103) lands on that higher-level rule, not on the `vt_login_failure` group. Each of those alerts on its own (level 10–12).
- **`clientIp` is spoofable.** It is the first `X-Forwarded-For` hop, which the client controls. An attacker can rotate it to dodge per-IP bursts. That is why login bursts are also counted per `attemptedUsername` (110016). Using `X-Real-IP` instead is a possible follow-up; it is not done now because it changes the lab's IP-rotation lesson.
- **nginx must forward `X-Forwarded-For`** on `/ws`, `/ws-sockjs` and `/actuator/`. Without it, `clientIp` on STOMP and actuator events is the nginx container's IP.
- **`httpMethod` can differ from the override.** `HiddenHttpMethodFilter` turns a `POST` with `_method=PUT` into a `PUT` deeper in the chain. Events from the same request can show either method. Match on `path`, not only `httpMethod`.
- **Windows are measured at ingest time** (§6.1). Two events seconds apart can arrive minutes apart, or together.
- **A raw `STOMP` command frame is not logged.** It skips the CONNECT handling, so that session has no `session_created` / `websocket_authentication_failed`, and its later events may carry no user. Left as is.
- **`token_validation_failed` is logged once per request.** Only `JwtAuthFilter` and the first CONNECT token check log it. The 11 controller re-checks call the silent `validateToken`. Blank tokens are skipped.
- **`security.log` can be switched off at runtime** through POST `/actuator/loggers/SECURITY_EVENTS` (a vuln). `audit_configuration_changed` is written before that takes effect, so the switch itself is always visible.

---

## 10. Log injection: the teaching artifact

The same user input goes to three sinks, and each one treats it differently. This is the lesson. **Never simplify this to a single sink.**

| Sink | Layout | A typed CR/LF | A `${...}` Log4j lookup |
|---|---|---|---|
| stdout | `PatternLayout` `%m%n` | Starts a real new line, so forged lines show up in `docker compose logs`. | Runs (Log4j 2.14.1 `%m`). |
| `app.log` | `JsonLayout` | Escaped as `\n` inside the JSON string. | Not run. Stored exactly as typed. |
| `security.log` | Jackson JSON, then `PatternLayout` `%m%n` | Escaped by Jackson, so it cannot start a new line. | Runs (intentional). |

- **`app.log` stays raw on purpose.** It keeps the attack payload exactly as typed, for forensics.
- **`security.log` is escaped by Jackson**, so a typed CR/LF can't forge a new event.
- **But Log4j 2.14.1 lookups still run on `security.log`** (`%m`, the intentional Log4Shell sink). So an obfuscated payload such as `${${lower:j}ndi:...}` may be rewritten before Wazuh sees it. Lookups run after Jackson, so a lookup value (e.g. `${sys:line.separator}`) is written unescaped and can split a line.
- **Headers are lookup inputs too.** `userAgent` (the `User-Agent` header) and `clientIp` (the first `X-Forwarded-For` hop) are written to `security.log`, so a `${...}` in those headers is looked up as well. Verified: `User-Agent: probe-${java:version}` is logged as `probe-Java version 11.0.11`.
- **There is no sanitizer** and no `raw_b64` field. Nothing strips CR/LF or escapes `${`.
- Wazuh catches the attempts with the content rules: 110100/110101 (Log4Shell), 110131 (CR/LF in `details.reason`).

Exercise for students: inject a CR/LF and a nested lookup into an `admin_action` `reason`. Compare stdout, `app.log` and `security.log`, then find which rules fired.
