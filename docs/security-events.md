# VulnTrade Security Events

> **Source of truth for what VulnTrade logs and detects.** This catalog lists every security event
> VulnTrade cares about, why it matters, and where it comes from — the application itself (written by
> `SecurityEventLogger` to `security.log`) or a Wazuh rule that derives it from those logs.
> How events are written (fields, format, transport) is described in [logging-guide.md](logging-guide.md).

**Definition.** A security event is an observable action, state change, or security-control decision that helps answer: who did what, to what, when, from where, whether it succeeded, and what changed.

## Contents

- [Baseline security events](#baseline) — 24 events
- [Trading events](#trading) — 15 events
- [Generic security events](#generic) — 15 events
- [VulnTrade-specific events](#vulntrade-specific) — 19 events
- [Not applicable](#not-applicable) — 43 baseline events that do not apply
- [How the catalog is organised](#how-the-catalog-is-organised)

## At a glance

| Tab | Events | Emitted by the app | Detected by Wazuh | Folded into another event |
|---|---:|---:|---:|---:|
| [Baseline security events](#baseline) | 24 | 22 | 0 | 2 |
| [Trading events](#trading) | 15 | 8 | 0 | 7 |
| [Generic security events](#generic) | 15 | 6 | 9 | 0 |
| [VulnTrade-specific events](#vulntrade-specific) | 19 | 6 | 13 | 0 |
| **Total** | **73** | **42** | **22** | **9** |

A further **43** baseline events are [not applicable](#not-applicable) (not counted in the total).

## How the catalog is organised

This workbook is the VulnTrade-specific combination of the team baseline. The first three tabs keep only the baseline rows that apply to VulnTrade (text unchanged), VulnTrade Specific adds what VulnTrade needs beyond them, and Not Applicable lists the remaining baseline rows with a reason. Events are emitted by the backend's SecurityEventLogger (App) or produced by Wazuh rules (Wazuh); a Folded row applies, but another event carries the fact.

**Reading the "Where in VulnTrade" column**

| Prefix | Meaning |
|---|---|
| `App — Class.method` | The backend emits this event itself, from the named code path. |
| `Wazuh <rule ids> (from <event>)` | Wazuh raises it by correlating app events (the source event is named). |
| `Folded into …` | The fact is relevant, but another event already carries it. |

**Mental model**

| Layer | Question | Examples |
|---|---|---|
| Baseline Security Events | What happened? | Login, session, password reset, file upload, data export |
| Trading Baseline | What changed financially? | Deposit, withdrawal, order, trade |
| Generic Security Events | Did a common attack/control condition occur? | Brute force, injection, validation failure, WebSocket abuse |
| Project-Specific / Threat Modeling | What could an attacker make happen in this business workflow? | Defined later per project |
| VulnTrade Specific | Which VulnTrade features and known vulnerabilities need their own events or detections? | API key use, debug RCE, token forgery, sign flip, wash trade |

<a id="baseline"></a>
## Baseline security events

Foundational baseline events that apply to VulnTrade. Category, event, and reason are copied from the team baseline; Where in VulnTrade shows the code, Wazuh rule, or event that covers each one.

| Category | Security event | Why we log it / possible abuse | Where in VulnTrade |
|---|---|---|---|
| Authentication | `login_success` | Establishes when and where an account was successfully accessed; supports account takeover investigation. | App — `AuthController.login`, `AuthController.loginLegacy` |
| Authentication | `login_failure` | Detects password guessing, credential stuffing, account enumeration, and failed takeover attempts. | App — `AuthController.login`, `AuthController.loginLegacy` |
| Authentication | `logout` | Establishes when a user intentionally terminated an authenticated session. | App — `AuthController.logout` |
| Session | `session_created` | Tracks authenticated session creation and helps investigate suspicious or parallel sessions. | App — StompChannelInterceptor (STOMP CONNECT) |
| Token | `access_token_issued` | Shows when application credentials were issued; useful for investigating unexpected authentication flows. | Folded into login_success, account_created, refresh_token_used, sensitive_data_updated |
| Token | `refresh_token_used` | Detects abnormal refresh behavior or suspicious token reuse that may indicate token theft. | App — `AuthController.refreshToken` |
| Credentials | `password_changed` | Helps determine whether credentials were legitimately changed or modified after compromise. | App — `AuthController.changePassword` |
| Credentials | `password_reset_requested` | Detects password-reset abuse, enumeration, and repeated recovery attempts. | App — `AuthController.resetPassword` |
| Credentials | `password_reset_completed` | Critical for investigating account takeover and credential recovery activity. | App — `AuthController.resetConfirm` |
| Account | `account_created` | Establishes account origin and supports investigation of fraudulent or automated account creation. | App — `AuthController.register` |
| Account | `account_disabled` | Records when access to an account was intentionally blocked. | App — `AdminController.toggleUser` |
| Account | `account_enabled` | Detects unexpected restoration of a previously disabled account. | App — `AdminController.toggleUser` |
| User | `profile_updated` | Establishes that user-controlled profile information changed. | App — `UserController.updateProfile` (no email key) |
| User | `security_attribute_updated` | Tracks sensitive changes such as email, phone, recovery method, or authentication identifiers. | App — `UserController.updateProfile` (email present) |
| Authorization | `authorization_denied` | Shows attempts to access resources or actions the user is not permitted to use. | App — RequestLoggingFilter (HTTP 401/403 fallback), `TradeStompController.denyUnauthenticated` |
| Authorization | `permission_changed` | Records granting or removal of capabilities and supports privilege-change auditing. | App — `UserController.updateVerificationProfile` (account level 2) |
| Data | `sensitive_data_read` | Helps answer who accessed sensitive information; useful for insider-threat and compromised-account investigations. | App — cross-user reads in UserController, AccountController, OrderController, LeaderboardController, `TradeStompController.getPortfolio`; always `AdminController.listUsers`, `DebugController.getUserInfo`, `TradeStompController.getTradeHistory` |
| Data | `sensitive_data_updated` | Detects unauthorized modification of protected or security-relevant information. | App — `UserController.updateVerificationProfile` |
| Data | `sensitive_data_deleted` | Supports investigation of destructive activity and data tampering. | App — `OrderController.deleteOrder` |
| Data | `data_exported` | High-value event because attackers may export large amounts of data after gaining access. | App — `ExportController.exportTrades`, exportAllTrades, exportPortfolio |
| File | `file_created_or_uploaded` | Detects malicious uploads, unexpected file creation, or unauthorized content placement. | App — `UserController.uploadPhoto` |
| API | `api_key_created` | API credentials can provide long-lived access and should always be auditable. | Folded into account_created |
| Administration | `admin_action` | Privileged operations should always leave an audit trail for accountability and incident reconstruction. | App — `AdminController.executeQuery`, adjustBalance; `AdminService.adjustBalance`, haltTrading, resumeTrading, setPrice |
| Audit | `audit_configuration_changed` | Critical because attackers may attempt to disable, suppress, or weaken logging and auditing. | App — FrameworkAccessLogFilter (POST /actuator/loggers/*) |

<a id="trading"></a>
## Trading events

Trading baseline events that apply to VulnTrade. A Folded row applies, but another event already carries the fact, so it is not logged separately.

| Category | Security event | Why we log it / possible abuse | Where in VulnTrade |
|---|---|---|---|
| Funding | `deposit_completed` | Confirms that value entered the platform and provides a financial audit trail. | App — `AccountController.deposit`, `AccountService.deposit` |
| Funding | `deposit_failed` | Useful for detecting payment abuse, invalid funding attempts, or repeated manipulation. | App — `AccountController.deposit` |
| Withdrawal | `withdrawal_completed` | Provides final evidence that money or assets actually left the platform. | App — `AccountController.withdraw`, `AccountService.withdraw` |
| Withdrawal | `withdrawal_rejected` | Can reveal fraud controls, authorization failures, or repeated withdrawal abuse. | App — `AccountController.withdraw`, `AccountService.withdraw` |
| Order | `order_created` | Records the user's trading intent, including instrument, side, quantity, and price constraints. | App — `OrderService.placeOrder` |
| Order | `order_cancelled` | Important for user disputes, abuse analysis, and possible market-manipulation investigations. | App — `OrderController.cancelOrder`, `OrderService.cancelOrder` |
| Order | `order_rejected` | Shows risk-engine, permission, balance, validation, or market-rule failures. | App — `OrderService.placeOrder`, executeMarketOrder |
| Trade | `trade_executed` | Core trading event that records actual execution of a transaction. | App — `MatchingEngineService.executeTrade` |
| Trade | `trade_partially_filled` | Necessary because an order can execute in multiple fills and order state may differ from execution state. | Folded into trade_executed |
| Trade | `trade_fully_filled` | Confirms that the requested order quantity was fully executed. | Folded into trade_executed |
| Position | `position_opened` | Establishes new financial exposure created by a trade. | Folded into trade_executed |
| Position | `position_closed` | Establishes removal of financial exposure and supports P&L reconstruction. | Folded into trade_executed |
| Position | `position_changed` | Detects unexpected changes in quantity, direction, leverage, or exposure. | Folded into trade_executed |
| Balance | `balance_changed` | Critical audit point because account balance represents financial value. | Folded into deposit_completed, withdrawal_completed, trade_executed, admin_action |
| Risk | `risk_limit_triggered` | Shows when trading behavior violates configured risk or exposure controls. | Folded into order_rejected |

<a id="generic"></a>
## Generic security events

Generic attack/control events that apply to VulnTrade. App rows are logged by the backend; Wazuh rows are detections that Wazuh rules build from those logs.

| Category | Security event | Why we log it / possible abuse | Where in VulnTrade |
|---|---|---|---|
| Authentication | `brute_force_detected` | Repeated authentication attempts against an account may indicate password guessing. | Wazuh 110002, 110016, 110005 (from login_failure, login_success); 110024 (password_reset_completed); 110028 (api_key_used) |
| Authentication | `credential_stuffing_detected` | Large-scale use of leaked username/password combinations may indicate automated account takeover. | Wazuh 110003, 110015 (from login_failure) |
| Authorization | `unauthorized_access_attempt` | A user attempted to access a resource or action outside their permissions. | Wazuh 110033 (from authorization_denied) |
| Input Validation | `input_validation_failed` | Malformed or unexpected input may indicate probing, fuzzing, or malicious payload delivery. | App — RequestLoggingFilter (HTTP 400 fallback) |
| Injection | `sql_injection_detected` | Attempts to manipulate database queries or query structure. | Wazuh 110112 (from attemptedUsername), 110110 (symbol), 110111 (startDate), 110114 (endDate), 110113 (app.log SQL errors) |
| Injection | `command_injection_detected` | Attempts to execute operating-system commands through application input. | Wazuh 110140 (from debug_command_executed) |
| Injection | `script_injection_detected` | Attempts to introduce browser-executed script such as XSS payloads. | Wazuh 110120 (from any log line) |
| Deserialization | `unsafe_deserialization_detected` | Potential object injection, gadget-chain abuse, or remote-code-execution attempt. | Wazuh 110102, 110103 (from any log line) |
| File Access | `path_traversal_detected` | Attempts to access files outside the intended path, such as traversal sequences. | Wazuh 110150 (from any log line) |
| File Upload | `malicious_file_upload_detected` | Detects prohibited, executable, malformed, oversized, or suspicious uploaded content. | Wazuh 110056 (from file_created_or_uploaded) |
| WebSocket | `websocket_authentication_failed` | Detects attempts to establish a WebSocket connection without valid authentication. | App — StompChannelInterceptor (STOMP CONNECT) |
| WebSocket | `websocket_authorization_failed` | Detects attempts to subscribe to or access channels and resources outside the user's permissions. | App — StompChannelInterceptor (SUBSCRIBE /topic/admin/*, SEND /app/admin.*) |
| WebSocket | `websocket_invalid_message` | Useful for detecting malformed payloads, fuzzing, protocol abuse, or unexpected message structure. | App — StompEventListener (close code 1002) |
| WebSocket | `websocket_message_size_exceeded` | May reveal resource-exhaustion attempts or abuse of oversized payloads. | App — StompEventListener (close code 1009) |
| Application | `unexpected_exception` | Can be the first indicator of malformed input, exploit attempts, unexpected code paths, or instability. | App — RequestLoggingFilter (escaped exception or 5xx fallback) |

<a id="vulntrade-specific"></a>
## VulnTrade-specific events

Events and detections VulnTrade needs beyond the team baseline, from threat modeling of its endpoints and known vulnerabilities.

| Category | Security event | Why we log it / possible abuse | Where in VulnTrade |
|---|---|---|---|
| Authentication | `api_key_used` | API keys skip the login flow, so every use must be traceable; repeated failures may indicate key guessing or a leaked key. | App — ApiKeyAuthFilter |
| Token | `token_validation_failed` | Shows forged, tampered, expired, or unsigned tokens being presented in place of a real login. | App — `JwtTokenProvider.validateTokenAndLogFailure` (JwtAuthFilter, STOMP CONNECT) |
| Token | `token_forgery_detected` | Unsigned (alg:none) or repeatedly rejected tokens indicate an attempt to impersonate another user or role. | Wazuh 110010, 110011, 110012 (from token_validation_failed) |
| Token | `token_laundering_detected` | Refreshing a forged token returns a properly signed one, turning a one-off forgery into a valid session. | Wazuh 110031 (from refresh_token_used + token_validation_failed) |
| Account | `mass_assignment_detected` | A sign-up that sets its own privileged role is an immediate privilege escalation. | Wazuh 110025 (from account_created) |
| Account | `account_takeover_detected` | A password change made with a forged token means an attacker can lock the real owner out of the account. | Wazuh 110017 (from password_changed + token_validation_failed) |
| Data | `idor_enumeration_detected` | One user reading many other users' records in a short time indicates scraping through a missing ownership check. | Wazuh 110061 (from sensitive_data_read), 110055 (isOwner=false on identity/data events), 110374 (from order_cancelled) |
| Withdrawal | `sign_flip_detected` | A negative withdrawal or deposit amount reverses the money flow and credits the attacker instead of debiting them. | Wazuh 110301, 110302 (from withdrawal_completed, deposit_completed) |
| Withdrawal | `double_spend_detected` | A balance that ends below zero shows concurrent requests spent the same funds more than once. | Wazuh 110303 (from withdrawal_completed) |
| Trade | `wash_trade_detected` | A user trading against their own orders can fake volume or move prices without a real counterparty. | Wazuh 110376 (from trade_executed) |
| Alert | `price_alert_created` | Alert symbols are stored as raw input and shown later, so this records stored XSS payloads and alert flooding. | App — `AlertService.createAlert` |
| WebSocket | `admin_channel_bypass_detected` | A non-admin sending admin STOMP commands that then take effect shows the WebSocket admin check can be bypassed. | Wazuh 110440, 110441 (from websocket_authorization_failed + admin_action) |
| Debug | `debug_command_executed` | Records every operating-system command run through the debug endpoint; any use in production is remote code execution. | App — `DebugController.execute` (before exec) |
| Debug | `debug_query_executed` | Raw SQL sent to the debug endpoint can read or change any data without normal access checks. | App — `DebugController.executeQuery` |
| Framework | `framework_endpoint_accessed` | Detects reconnaissance and abuse of exposed framework surfaces such as Actuator, the H2 console, and Swagger. | App — FrameworkAccessLogFilter |
| Framework | `h2_console_rce_detected` | A JDBC URL containing INIT, RUNSCRIPT, or CREATE ALIAS makes the H2 console run attacker code on the server. | Wazuh 110164 (from framework_endpoint_accessed) |
| Injection | `log4shell_detected` | JNDI lookup strings in any logged field can make the vulnerable Log4j version load and run remote code. | Wazuh 110100, 110101 (from any log line) |
| Injection | `log_injection_detected` | Line breaks in logged fields can forge fake log entries or hide real activity from investigators. | Wazuh 110131 (from details.reason on any event) |
| Audit | `log_tampering_detected` | Changing log levels at runtime can silence security logging right before an attack. | Wazuh 110165 (from audit_configuration_changed) |

<a id="not-applicable"></a>
## Not applicable

Team baseline events that do not apply to VulnTrade because the feature or control does not exist. Revisit a row if that feature is added.

| Category | Security event | Reason |
|---|---|---|
| Session | `session_expired` | Sessions are stateless JWTs; an expired token is logged as token_validation_failed (reason expired). |
| Session | `session_revoked` | There is no server-side session store, so a session cannot be revoked. |
| Token | `refresh_token_rotated` | There is no separate refresh token; /refresh-token re-signs a JWT from the current one. |
| Token | `token_revoked` | There is no token denylist; logout does not invalidate the JWT. |
| MFA | `mfa_challenge_success` | VulnTrade has no multi-factor authentication. |
| MFA | `mfa_challenge_failure` | VulnTrade has no multi-factor authentication. |
| MFA | `mfa_enabled` | VulnTrade has no multi-factor authentication. |
| MFA | `mfa_disabled` | VulnTrade has no multi-factor authentication. |
| Account | `account_deleted` | There is no account deletion feature. |
| Account | `account_locked` | There is no lockout after failed logins; Wazuh brute_force_detected covers repeated failures. |
| Account | `account_unlocked` | There is no lockout, so accounts are never unlocked. |
| Authorization | `role_changed` | No endpoint changes a role after sign-up; a self-assigned role at sign-up is account_created. |
| Authorization | `group_membership_changed` | There are no groups; each user has a single role. |
| File | `file_downloaded` | Profile photos are public images loaded by <img> tags on every page view, so downloads are noise. |
| File | `file_deleted` | There is no file deletion feature. |
| File | `file_access_denied` | Files have no per-user access control, so access is never denied. |
| API | `api_key_rotated` | API keys are issued once at sign-up and cannot be rotated. |
| API | `api_key_revoked` | API keys cannot be revoked. |
| Configuration | `security_configuration_changed` | No feature changes security settings; Actuator use is framework_endpoint_accessed and log-level changes are audit_configuration_changed. |
| Funding | `deposit_requested` | Deposits complete in a single call, so there is no separate request step. |
| Withdrawal | `withdrawal_requested` | Withdrawals complete in a single call, so there is no separate request step. |
| Withdrawal | `withdrawal_approved` | There is no withdrawal approval workflow. |
| Withdrawal | `withdrawal_cancelled` | Withdrawals complete immediately and cannot be cancelled. |
| Payment Destination | `bank_account_added` | There are no saved bank accounts; the destination is free text on each withdrawal. |
| Payment Destination | `bank_account_changed` | There are no saved bank accounts to change. |
| Payment Destination | `withdrawal_address_added` | There are no saved withdrawal addresses. |
| Transfer | `fund_transfer_requested` | There are no transfers between user accounts. |
| Transfer | `fund_transfer_completed` | There are no transfers between user accounts. |
| Order | `order_modified` | Orders cannot be modified; users cancel and place a new order. |
| Risk | `margin_call_triggered` | There is no margin or leverage. |
| Risk | `liquidation_triggered` | There is no margin, so positions are never liquidated. |
| Trading Access | `trading_enabled` | There is no per-user trading switch; symbol halt and resume are logged as admin_action. |
| Trading Access | `trading_disabled` | There is no per-user trading switch; symbol halt and resume are logged as admin_action. |
| Trading Access | `trading_permission_changed` | There are no per-user instrument or market permissions; account-level changes are permission_changed. |
| API Trading | `trading_api_key_created` | There are no separate trading API keys; the one user API key is covered by account_created and api_key_used. |
| API Trading | `trading_api_key_revoked` | There are no separate trading API keys to revoke. |
| Rate Limiting | `rate_limit_triggered` | There is no rate limiter, so nothing is logged per request; Wazuh burst rules catch high rates instead. |
| Injection | `template_injection_detected` | No server-side or client-side template engine evaluates user input. |
| Server Access | `ssrf_attempt_detected` | No feature fetches a user-supplied URL; the H2 JDBC URL is covered by h2_console_rce_detected. |
| CSRF | `csrf_validation_failed` | CSRF protection is disabled and the API uses bearer tokens, so there is no CSRF check to fail. |
| WebSocket | `websocket_origin_validation_failed` | There is no WebSocket origin check; the origin is still logged on STOMP CONNECT events. |
| WebSocket | `websocket_rate_limit_triggered` | There is no WebSocket message rate limiter. |
| Security Control | `security_control_blocked_request` | No WAF or blocking control sits in front of the app; access denials are authorization_denied. |

## Related

- [logging-guide.md](logging-guide.md) — event format and field reference (§2), the event catalog by category (§4),
  old → new event names (§5), and the Wazuh rules (§6).
- [`SecurityEvent.java`](../backend/src/main/java/com/vulntrade/security/logging/SecurityEvent.java) — the
  app-emitted events as an enum (one constant per `App —` row above).
- [`../wazuh/`](../wazuh/) — decoders and rules behind the `Wazuh` rows.
