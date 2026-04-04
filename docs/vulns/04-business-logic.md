# 04 — Business Logic Vulnerabilities

## Overview
This is where VulnTrade truly differentiates from DVWA and Juice Shop. These vulnerabilities exist in the **trading logic** — they can't be found by automated scanners and require understanding of how financial systems work. In real trading platforms, these bugs cause millions in losses.

---

## Vulnerabilities

### BIZ-01: Market Price Manipulation
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A04: Insecure Design |
| CWE | CWE-20 |
| Difficulty | Advanced |
| Endpoint | WebSocket `/app/admin.setPrice` |
| File | `PriceSimulatorService.java:180-191` |

**Description:** Any authenticated user can set arbitrary prices for any symbol via the admin WebSocket endpoint (see AUTHZ-09). The price persists permanently — the simulator skips overridden symbols. Combined with position holding, this enables pump-and-dump attacks.

**Attack scenario:**
1. Buy 10,000 VULN at $42 (cost: $420,000)
2. Send: `sendMessage('/app/admin.setPrice', {symbol: 'VULN', price: 99999})`
3. Position now worth $999,990,000
4. ROI skyrockets, you're #1 on leaderboard
5. Flag: `FLAG{m4rk3t_m4n1pul4t0r_numb3r_0n3}`

**What you learn:** Price oracles must be protected. In DeFi, oracle manipulation is the #1 attack vector. This simulates that exact class of vulnerability.

---

### BIZ-02: Sign Flip — Negative Withdrawal = Deposit
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A04: Insecure Design |
| CWE | CWE-20 |
| Difficulty | Intermediate |
| Endpoint | `POST /api/accounts/withdraw` |
| File | `AccountService.java:58` |

**Description:** The withdrawal endpoint doesn't validate that the amount is positive. A negative withdrawal amount results in a deposit (balance increases instead of decreasing).

**How to exploit:**
```bash
curl -X POST http://localhost:8085/api/accounts/withdraw \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"amount":-50000,"destinationAccount":"my-bank"}'
# Balance increases by $50,000
```

---

### BIZ-03: Race Condition on Withdrawals (TOCTOU)
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A04: Insecure Design |
| CWE | CWE-367 |
| Difficulty | Advanced |
| Endpoint | `POST /api/accounts/withdraw` |
| File | `AccountService.java:52,62,71` |

**Description:** The balance check and balance deduction are not atomic. Two concurrent withdrawal requests can both pass the balance check before either deduction occurs, resulting in double-spend.

**How to exploit:**
Send 10 concurrent requests with the full balance amount. Due to the race window, multiple requests succeed.

---

### BIZ-04: Decorative 2FA (Frontend Only)
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A04: Insecure Design |
| CWE | CWE-306 |
| Difficulty | Beginner |
| File | `AccountPage.js:330-337` |

**Description:** The 2FA modal on the withdraw page is purely cosmetic. It accepts any value and never sends the code to the server. The actual withdrawal API call has no 2FA parameter.

---

### BIZ-05: Deposit Without Source Verification
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A04: Insecure Design |
| CWE | CWE-345 |
| Difficulty | Beginner |
| Endpoint | `POST /api/accounts/deposit` |
| File | `AccountService.java:106-108` |

**Description:** The deposit endpoint accepts any `sourceAccount` string and any amount. No verification against a real bank or payment provider. Free money.

---

### BIZ-06: Wash Trading (Self-Matching)
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A04: Insecure Design |
| CWE | CWE-840 |
| Difficulty | Advanced |
| File | `MatchingEngineService.java:103` |

**Description:** The order matching engine doesn't check if the buyer and seller are the same user. A user can place both a BUY and SELL order, match against themselves, and create artificial trading volume to inflate their leaderboard position.

---

### BIZ-07: Negative Order Quantity Accepted
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A04: Insecure Design |
| CWE | CWE-20 |
| Difficulty | Intermediate |
| File | `OrderService.java:21` |

**Description:** Order quantity is not validated to be positive. A negative quantity order combined with the matching engine can create unexpected balance changes.

---

### BIZ-08: No Price Band Validation
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A04: Insecure Design |
| CWE | CWE-20 |
| Difficulty | Intermediate |
| File | `OrderService.java:22` |

**Description:** Orders at any price are accepted — $0.01 or $999,999. No circuit breaker or price band check. In real exchanges, orders far from the current market price are rejected.

---

### BIZ-09: Position Can Go Negative (Naked Shorting)
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A04: Insecure Design |
| CWE | CWE-20 |
| File | `MatchingEngineService.java:28-29` |

**Description:** Selling more shares than you own is allowed. The position quantity goes negative, effectively creating a naked short position with no margin requirement or borrowing check.

---

### BIZ-10: Client-Side Daily Withdrawal Limit
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A04: Insecure Design |
| CWE | CWE-602 |
| Difficulty | Beginner |
| File | `AccountPage.js:65-71` |

**Description:** The $100,000 daily withdrawal limit is tracked in `localStorage` only. The server has no limit enforcement. Using curl or clearing localStorage bypasses it entirely.

---

### BIZ-11: Client-Side P&L Calculation
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A04: Insecure Design |
| CWE | CWE-602 |
| Difficulty | Intermediate |
| File | `PortfolioPage.js:72-86` |

**Description:** Profit/loss calculations happen entirely in the browser using floating-point arithmetic. Values can be manipulated via React DevTools or by modifying the price data in transit.

---

### BIZ-12: Non-Existent Symbol Accepted
| Field | Value |
|-------|-------|
| Severity | Low |
| OWASP | A04: Insecure Design |
| CWE | CWE-20 |
| File | `OrderService.java:24` |

**Description:** Orders for symbols that don't exist in the symbols table are accepted and processed.

---

### BIZ-13: clientOrderId Replay Allowed
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A04: Insecure Design |
| CWE | CWE-294 |
| File | `OrderService.java:23` |

**Description:** The `clientOrderId` field is not unique-enforced. The same order can be submitted multiple times with the same client ID, enabling replay attacks.

---

### BIZ-14: No Slippage Protection on Market Orders
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A04: Insecure Design |
| CWE | CWE-20 |

**Description:** Market orders execute at whatever price the order book provides. No maximum slippage or price protection. Combined with price manipulation, this enables sandwich attacks.

---

### BIZ-15: Auto-Verification via First Name
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A04: Insecure Design |
| CWE | CWE-20 |
| Difficulty | Beginner |
| Endpoint | `PUT /api/users/{id}/profile` |

**Description:** Setting any non-empty first name automatically upgrades the account to Level 2 (verified). No document upload, no KYC review, no verification delay.

---

### BIZ-16: Predictable VULN Symbol Price Pattern
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A04: Insecure Design |
| CWE | CWE-330 |
| File | `PriceSimulatorService.java:112-118` |

**Description:** The VULN symbol follows a perfectly predictable sinusoidal pattern: `100 + 20 * sin(tickCount * 0.1)`. A bot can predict future prices and trade accordingly for guaranteed profits.
