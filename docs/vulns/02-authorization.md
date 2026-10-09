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
| File | `UserController.java:56-99` |

**Description:** Any authenticated user can view any other user's full profile by changing the `userId` parameter (`GET /{userId}` at `UserController.java:56`). An ownership check exists but only logs a security event and still returns the record (`UserController.java:97`). The response includes PII: SSN, date of birth, phone, address, API key, notes (which contain CTF flags).

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
| File | `PortfolioService.java:36` |

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
| File | `AccountController.java:262-278` |

**Description:** The `userId` query parameter overrides the authenticated user's ID, returning any user's full transaction history.

---

### AUTHZ-04: IDOR — Cancel Any User's Order
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-639 |
| Difficulty | Intermediate |
| File | `OrderService.java:154` |

**Description:** The cancel order function (`OrderService.cancelOrder`, `OrderService.java:154`) doesn't verify that the authenticated user owns the order. Any user can cancel any order by ID. (Re-run note: a given order can only be cancelled once; a fresh cross-user cancel still returns 200.)

---

### AUTHZ-05: IDOR — Leaderboard User Detail
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A01: Broken Access Control |
| CWE | CWE-639 |
| Difficulty | Beginner |
| Endpoint | `GET /api/leaderboard?userId={id}` or `GET /api/leaderboard/{id}/detail` |
| File | `LeaderboardController.java:53` (`?userId=`), `:135` (`/{id}/detail`) |

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

### AUTHZ-07: Admin Page — Client-Side Only Route Guard (Frontend)
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A01: Broken Access Control |
| CWE | CWE-862 |
| Difficulty | Beginner |
| Endpoint | `/admin` (frontend route) |
| File | `App.js:254,294-295` |

**Description:** The `/admin` route guard is **client-side only**. The nav link is hidden for non-admins by a React `isAdmin()` render (`App.js:254`), but the route itself only checks `isAuthenticated` (`App.js:294-295`), so any logged-in user can navigate directly to `/admin` and the `AdminPage` component renders. This is a real **frontend** vulnerability (demonstrated with a browser/Playwright check).

**Important nuance:** reaching the admin page in the browser does **not** grant admin API access. The backend `/api/admin/**` endpoints are role-gated server-side (`SecurityConfig.java:64`, `hasRole("ADMIN")`): a plain non-admin token gets **403**. The admin API is only reachable by **forging the ADMIN role** in the JWT — see [AUTHZ-12](#authz-12-admin-user-list-endpoint-accessible). In the exploit matrix this item is a frontend-only **SKIP** (not HTTP-exploitable on its own).

---

### AUTHZ-08: WebSocket Admin Channels — No Subscription Check
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-862 |
| Difficulty | Intermediate |
| File | `StompChannelInterceptor.java:125-130` |

**Description:** Any authenticated user can subscribe to `/topic/admin/*` (e.g. `/topic/admin/alerts`). The interceptor logs the subscription but never blocks it (`StompChannelInterceptor.java:125-130`). These channels broadcast sensitive admin actions including balance adjustments and the FLAG_7 payload.

---

### AUTHZ-09: WebSocket Admin Commands — Log But Don't Block
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A01: Broken Access Control |
| CWE | CWE-862 |
| Difficulty | Intermediate |
| File | `StompChannelInterceptor.java:144-153` |

**Description:** When a non-admin user sends messages to `/app/admin.*` destinations (like `admin.setPrice`, `admin.adjustBalance`, `admin.haltTrading`), the interceptor logs a warning but **does not block** the message (`StompChannelInterceptor.java:144-153`). The command is processed normally — a non-admin `admin.haltTrading` returns a `TRADING_HALTED` reply.

**How to exploit:**
```javascript
// In browser console while on any page:
// The WebSocket connection is already established
sendMessage('/app/admin.setPrice', { symbol: 'VULN', price: 99999 });
```

---

### AUTHZ-10: HTTP Method Override Bypass — Not Exploitable (Debunked)
| Field | Value |
|-------|-------|
| Severity | N/A (not a vulnerability) |
| OWASP | — |
| CWE | — |
| Difficulty | — |
| File | `SecurityConfig.java:90` |

**Status:** This was previously claimed as a method-override authorization bypass. **The claim is false — it does not work.**

**Why it does not work:** `HiddenHttpMethodFilter` (`SecurityConfig.java:90`) only honours a `_method` **form parameter** on `POST` requests and never changes authorization decisions. The `X-HTTP-Method-Override` **header** does nothing here. `/api/admin/**` is gated by `hasRole("ADMIN")` (`SecurityConfig.java:64`) independent of HTTP method, so a non-admin `POST /api/admin/users` with `X-HTTP-Method-Override: GET` still returns **403**.

> Historical note: an inline code comment in `AdminController` still references this technique, but it is stale — the backend role check applies regardless of the override header. Admin API access requires forging the ADMIN role instead (see [AUTHZ-12](#authz-12-admin-user-list-endpoint-accessible)). In the exploit matrix this item is a **SKIP** (verified non-exploitable).

---

### AUTHZ-11: Account Level Check Trusts JWT Only
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-807 |
| Difficulty | Intermediate |
| Endpoint | `POST /api/accounts/deposit`, `POST /api/accounts/withdraw` |
| File | `AccountController.java:195` (deposit), `:100` (withdraw) |

**Description:** Deposit and withdrawal endpoints check `accountLevel < 2` from the JWT claim only (`AccountController.java:195`, `:100`) — never querying the database. A fresh Level-1 user is blocked (403); re-signing that same token with `accountLevel:2` (weak secret) unlocks the operation (200), bypassing all KYC/verification requirements. See [AUTH-07](01-authentication.md) for the claim source.

---

### AUTHZ-12: Admin User List Endpoint Accessible
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-862 |
| Difficulty | Intermediate |
| Endpoint | `GET /api/admin/users` |
| File | `AdminController.java:43`, `SecurityConfig.java:64`, `JwtAuthFilter.java:37` |

**Description:** Returns all users including API keys, balance, notes, and sensitive fields (`AdminController.java:43`). The endpoint is genuinely role-gated server-side — `/api/admin/**` requires `hasRole("ADMIN")` (`SecurityConfig.java:64`) and a plain non-admin token gets **403**. The weakness is that the role is read from the (forgeable) JWT body (`JwtAuthFilter.java:37`) and the parser accepts `alg:none`/weak-secret tokens, so forging `role=ADMIN` reaches the endpoint and dumps every user's sensitive data. This is the real server-side path behind the [AUTHZ-07](#authz-07-admin-page--client-side-only-route-guard-frontend) admin page.
