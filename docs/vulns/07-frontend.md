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
| File | `context/AuthContext.js:65` |

**Description:** The JWT token is stored in `localStorage` under the key `token`. Any XSS vulnerability (even on a third-party script) can read it: `localStorage.getItem('token')`. httpOnly cookies would be immune to this.

---

### FE-02: Full User Object in localStorage
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A02: Cryptographic Failures |
| CWE | CWE-922 |
| File | `context/AuthContext.js:66` |

**Description:** The entire user object (including PII from JWT claims) is stored in `localStorage` under the key `user`. This persists across browser sessions and is accessible to any script.

---

### FE-03: Client-Side Role Check (Admin Route)
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-602 |
| Difficulty | Beginner |
| File | `App.js` (admin route) |

**Description:** The admin page route is only protected by `isAuthenticated ? <AdminPage /> : <Navigate to="/login" />`. The nav link is hidden with `isAdmin()` but any user can navigate directly to `/admin`.

---

### FE-04: XSS via dangerouslySetInnerHTML
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A03: Injection |
| CWE | CWE-79 |
| Difficulty | Intermediate |
| File | `DashboardPage.js:352,356` |

**Description:** Symbol names in the market data table use `dangerouslySetInnerHTML` to render. If an attacker can inject a malicious symbol name (via admin SQL executor or direct DB access), it executes JavaScript in every user's browser.

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

### FE-06: Client-Side Order Validation Only
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A04: Insecure Design |
| CWE | CWE-602 |
| File | `DashboardPage.js` |

**Description:** Order quantity and price validation happens only in React. Negative quantities, zero prices, and invalid symbols are accepted by the backend when bypassing the UI.

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

### FE-09: Hidden User ID Input in DOM
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A04: Insecure Design |
| CWE | CWE-472 |
| File | `DashboardPage.js` (debug mode only) |

**Description:** In debug mode, a hidden `<input id="order-user-id">` contains the current user's ID. The order placement reads this via `document.getElementById('order-user-id').value` and sends it in the WebSocket message — allowing IDOR if the DOM value is changed.

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
