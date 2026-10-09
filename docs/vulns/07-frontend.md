# 07 — Frontend (React) Vulnerabilities

## Overview
VulnTrade's React frontend has client-side security issues common in SPAs: relying on JavaScript for authorization, storing sensitive data in localStorage, rendering unsanitized content, and implementing validation only in the browser. These mirror real-world SPA vulnerabilities that pentesters encounter in modern web applications.

---

## Vulnerabilities

### FE-01: JWT Stored in localStorage
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A07: Identification and Authentication Failures |
| CWE | CWE-922 |
| Difficulty | Beginner |
| File | `context/AuthContext.js:66` |

**Description:** The JWT token is stored in `localStorage` under the key `token` (`localStorage.setItem('token', data.token)`). Any XSS vulnerability (even on a third-party script) can read it: `localStorage.getItem('token')`. httpOnly cookies would be immune to this.

---

### FE-02: Full User Object in localStorage
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A02: Cryptographic Failures |
| CWE | CWE-922 |
| File | `context/AuthContext.js:67` |

**Description:** The entire user object (including PII from JWT claims) is stored in `localStorage` under the key `user` (`localStorage.setItem('user', JSON.stringify(data))`). This persists across browser sessions and is accessible to any script.

---

### FE-03: Client-Side Role Check (Admin Route)
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A01: Broken Access Control |
| CWE | CWE-602 |
| Difficulty | Beginner |
| File | `App.js:294` (admin route) |

**Description:** The `/admin` page route is only protected by `isAuthenticated ? <AdminPage /> : <Navigate to="/login" />` (App.js:294). The nav link is hidden with `isAdmin()`/`isDeveloper()` (App.js:254) but any authenticated user can navigate directly to `/admin` and render the admin UI shell.

**Scope note (corrected):** This is a *frontend-only* control. The admin **page** loads for any logged-in user, but the admin **API** it talks to is role-gated server-side: `GET /api/admin/**` returns **403** for a plain non-admin token. So rendering the page leaks the admin layout but not admin data. To actually read/modify admin data you must forge the `ADMIN` role in the JWT (alg:none or the weak secret) — that server-side bypass is **AUTHZ-12** (see [02-authorization.md](02-authorization.md)). Because the pure route-guard is only demonstrable in the browser, the exploit matrix marks it **SKIP (frontend-only)**.

---

### FE-04: XSS via dangerouslySetInnerHTML
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A03: Injection |
| CWE | CWE-79 |
| Difficulty | Intermediate |
| File | `DashboardPage.js:375,379,624` |

**Description:** Symbol and name values are rendered with `dangerouslySetInnerHTML` — in the market-data table (`DashboardPage.js:375,379`) and in the Price Alerts panel (`DashboardPage.js:624`). If an attacker can plant a malicious symbol string, it executes JavaScript in every user's browser. A stored-XSS source already exists: a price-alert symbol is persisted and reflected **unsanitised** over STOMP (`/app/trade.setAlert`, proven as **INJ-09** in [03-injection.md](03-injection.md)), so an alert symbol such as `<img src=x onerror=alert(1)>` reaches this sink. (The sink itself is browser-only, so the exploit matrix tracks it as **INJ-10 / SKIP (frontend-only)**.)

---

### FE-05: Client-Side Password Validation Only
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A04: Insecure Design |
| CWE | CWE-602 |
| File | `RegisterPage.js:28-40` |

**Description:** Minimum password length (6 characters) is only enforced in JavaScript. The server accepts any password length, including empty passwords, when sent directly via curl.

---

### FE-06: Client-Side Max-Order-Size Cap Only
| Field | Value |
|-------|-------|
| Severity | Low |
| OWASP | A04: Insecure Design |
| CWE | CWE-602 |
| File | `DashboardPage.js:494,512` |

**Description:** The order form caps quantity at 10000 purely in React — `<Input ... max="10000" min="1">` (DashboardPage.js:494) and a `qty <= 0 || qty > 10000` toast (DashboardPage.js:512). This 10000 ceiling is **not** enforced by the backend, so bypassing the UI lets you place far larger orders.

**Scope note (corrected):** Core order validation is **no longer** client-side-only. The server now runs `RiskService.checkPreTrade` (`OrderService.placeOrder`) on every order — including MARKET orders (`executeMarketOrder` routes through the same path) — and rejects:
- negative / zero quantity → `Invalid quantity: must be greater than 0` (see **BIZ-07**)
- selling more than you hold → `Insufficient position...` (see **BIZ-09**)
- unknown symbols → `Unknown symbol: ...` (see **BIZ-12**)

Only the 10000 max-order-size cap remains browser-only. *(Historical: earlier builds accepted negative quantities, zero prices, and invalid symbols directly against the backend; those are now server-side controls — see [04-business-logic.md](04-business-logic.md).)*

---

### FE-07: Client-Side Withdrawal Limit (localStorage)
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A04: Insecure Design |
| CWE | CWE-602 |
| File | `AccountPage.js:65-71` |

**Description:** The $100,000 daily withdrawal limit is tracked exclusively in `localStorage.getItem('dailyWithdrawn')`. Clearing localStorage or using curl bypasses it completely.

---

### FE-08: P&L Manipulation via React DevTools
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A04: Insecure Design |
| CWE | CWE-602 |
| File | `PortfolioPage.js:72-86` |

**Description:** P&L is calculated entirely in the browser by multiplying positions by current prices. Using React DevTools, you can modify the state values to show any P&L figure.

---

### FE-09: Hidden User ID Input in DOM (IDOR — backend honours it)
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-639 |
| Difficulty | Intermediate |
| File | `DashboardPage.js:418-420,535,543` |

**Description:** The order form always renders a hidden `<input id="order-user-id">` seeded with the current user's ID (DashboardPage.js:418-420). On submit the page reads it with `document.getElementById('order-user-id')?.value` and sends it as `userId` in the STOMP order message (DashboardPage.js:535,543). The backend **honours that body field**: `/app/trade.placeOrder` sets `userId = request.getUserId()` when it is present (`TradeStompController.placeOrder`), so editing the hidden value in DevTools places orders **as another user** — a confirmed IDOR, not a theoretical one. (The REST `POST /api/orders` path still binds the order to the token's user; the IDOR is specific to the WebSocket order path.)

---

### FE-10: JWT Decoded Without Verification
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A08: Software and Data Integrity Failures |
| CWE | CWE-347 |
| File | `context/AuthContext.js:16-25` |

**Description:** The `decodeJWT()` function simply base64-decodes the JWT payload without checking the signature. The client trusts whatever is in the payload, even if the token has been tampered with.

---

### FE-11: No Content Security Policy
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A05: Security Misconfiguration |
| CWE | CWE-693 |
| File | `nginx.conf` |

**Description:** No CSP header is set. Inline scripts, eval(), and loading scripts from any origin are all permitted.

---

### FE-12: Error Messages Displayed Directly
| Field | Value |
|-------|-------|
| Severity | Low |
| OWASP | A09: Security Logging and Monitoring Failures |
| CWE | CWE-209 |
| File | `LoginPage.js:35` |

**Description:** Server error messages are displayed directly to the user in toast notifications. This enables user enumeration (AUTH-01) and leaks internal error details.

---

### FE-13: Debug Logging in Production
| Field | Value |
|-------|-------|
| Severity | Low |
| OWASP | A09: Security Logging and Monitoring Failures |
| CWE | CWE-532 |
| File | `websocketService.js:25-26` |

**Description:** STOMP debug messages are logged to the browser console, including frame contents, connection details, and message bodies.

---

### FE-14: Decorative 2FA Modal
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A04: Insecure Design |
| CWE | CWE-306 |
| Difficulty | Beginner |
| File | `AccountPage.js:330-337` |

**Description:** The 2FA modal accepts any value (even a single character). The code is never sent to or verified by the server. The actual withdrawal API has no 2FA parameter at all.

---

### FE-15: Source Maps in Production
| Field | Value |
|-------|-------|
| Severity | Low |
| OWASP | A05: Security Misconfiguration |
| CWE | CWE-540 |

**Description:** Source maps may be generated in the production build, allowing attackers to read the original React source code including comments with vulnerability hints.
