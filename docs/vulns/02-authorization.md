# 02 — Authorization & Access Control

## Overview
Broken access control is the #1 vulnerability in the OWASP Top 10. In a trading platform, IDOR vulnerabilities let attackers view other users' portfolios, PII (SSN, address), trade history, and account balances. VulnTrade has no server-side ownership checks on most endpoints.

---

## Vulnerabilities

### AUTHZ-01: IDOR — View Any User's Profile
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A01: Broken Access Control |
| CWE | CWE-639 |
| Difficulty | Beginner |
| Endpoint | `GET /api/users/{userId}` |
| File | `UserController.java:49-90` |

**Description:** Any authenticated user can view any other user's full profile by changing the `userId` parameter. The response includes PII: SSN, date of birth, phone, address, API key, notes (which contain CTF flags).

**How to exploit:**
```bash
# Get admin's profile (userId=1)
curl http://localhost:8085/api/users/1 \
  -H "Authorization: Bearer <your-token>"
# Response includes: notes="Admin account. FLAG{1d0r_4dm1n_pr0f1l3_n0t3s}"

# Get trader2's profile (userId=3) — contains SSN in plaintext
curl http://localhost:8085/api/users/3 \
  -H "Authorization: Bearer <your-token>"
```

**What you learn:** Always verify that the authenticated user owns the requested resource. Use `@PreAuthorize` or check `userId == authenticatedUser.getId()`.

---

### AUTHZ-02: IDOR — View Any User's Portfolio
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-639 |
| Difficulty | Beginner |
| Endpoint | `GET /api/users/{userId}/portfolio` |
| File | `PortfolioService.java:34` |

**Description:** Returns any user's positions, holdings, and notes (which may contain flags). trader2's portfolio notes contain `FLAG{h0r1z0nt4l_pr1v3sc_p0rtf0l10}`.

---

### AUTHZ-03: IDOR — View Any User's Transactions
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-639 |
| Difficulty | Beginner |
| Endpoint | `GET /api/accounts/transactions?userId={id}` |
| File | `AccountController.java:214-227` |

**Description:** The `userId` query parameter overrides the authenticated user's ID, returning any user's full transaction history.

---

### AUTHZ-04: IDOR — Cancel Any User's Order
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-639 |
| Difficulty | Intermediate |
| File | `OrderService.java:110` |

**Description:** The cancel order function doesn't verify that the authenticated user owns the order. Any user can cancel any order by ID.

---

### AUTHZ-05: IDOR — Leaderboard User Detail
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A01: Broken Access Control |
| CWE | CWE-639 |
| Difficulty | Beginner |
| Endpoint | `GET /api/leaderboard?userId={id}` or `GET /api/leaderboard/{id}/detail` |
| File | `LeaderboardController.java:47-56` |

**Description:** Any authenticated user can look up detailed trading stats for any other user. The response includes the `notes` field which contains flags.

---

### AUTHZ-06: IDOR — CSV Export of Any User's Trades
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-639 |
| Difficulty | Beginner |
| Endpoint | `GET /api/export/trades?userId={id}` |

**Description:** The export endpoint accepts a `userId` parameter to export any user's trade history.

---

### AUTHZ-07: Admin Page — Client-Side Only Protection
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-862 |
| Difficulty | Beginner |
| Endpoint | `/admin` (frontend route) |
| File | `App.js:293` |

**Description:** The admin page is hidden by a React conditional render (`isAdmin()`), but the route is accessible to any authenticated user by navigating directly to `/admin`. All admin API calls work if you know the endpoints.

---

### AUTHZ-08: WebSocket Admin Channels — No Subscription Check
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-862 |
| Difficulty | Intermediate |
| File | `StompChannelInterceptor.java:84-91` |

**Description:** Any authenticated user can subscribe to `/topic/admin/alerts` and `/topic/admin/notifications`. These channels broadcast sensitive admin actions including balance adjustments and FLAG_7.

---

### AUTHZ-09: WebSocket Admin Commands — Log But Don't Block
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A01: Broken Access Control |
| CWE | CWE-862 |
| Difficulty | Intermediate |
| File | `StompChannelInterceptor.java:98-111` |

**Description:** When a non-admin user sends messages to `/app/admin.*` destinations (like `admin.setPrice`, `admin.adjustBalance`), the interceptor logs a warning but **does not block** the message. The message is processed normally.

**How to exploit:**
```javascript
// In browser console while on any page:
// The WebSocket connection is already established
sendMessage('/app/admin.setPrice', { symbol: 'VULN', price: 99999 });
```

---

### AUTHZ-10: HTTP Method Override Bypass
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A01: Broken Access Control |
| CWE | CWE-20 |
| Difficulty | Advanced |
| File | `SecurityConfig.java:90` |

**Description:** `HiddenHttpMethodFilter` is enabled, allowing the `X-HTTP-Method-Override` header to change the HTTP method. A POST request to an admin endpoint can be disguised as a GET to bypass method-based security rules.

---

### AUTHZ-11: Account Level Check Trusts JWT Only
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-807 |
| Difficulty | Intermediate |
| Endpoint | `POST /api/accounts/deposit`, `POST /api/accounts/withdraw` |
| File | `AccountController.java` |

**Description:** Deposit and withdrawal endpoints check `accountLevel >= 2` from the JWT claim only — never querying the database. Forging a JWT with `accountLevel:2` bypasses all KYC/verification requirements.

---

### AUTHZ-12: Admin User List Endpoint Accessible
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-862 |
| Difficulty | Intermediate |
| Endpoint | `GET /api/admin/users` |
| File | `AdminController.java:39-59` |

**Description:** Returns all users including API keys, balance, notes, and sensitive fields. While the endpoint is under `/api/admin/**` which requires ADMIN role, the role is read from the JWT body (which is forgeable).
