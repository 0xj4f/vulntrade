# 04 — Business Logic Vulnerabilities

## Overview
This is where VulnTrade truly differentiates from DVWA and Juice Shop. These vulnerabilities exist in the **trading logic** — they can't be found by automated scanners and require understanding of how financial systems work. In real trading platforms, these bugs cause millions in losses.

> **Status note (order-flow controls now server-side):** `RiskService.checkPreTrade` now runs for **all** order types (LIMIT *and* MARKET) and enforces `quantity > 0`, `price > 0` for LIMIT orders, symbol-must-exist, buyer-balance, and seller-position. The trading-halt check in `OrderService.placeOrder` also applies to every order type. As a result the old "order validation is client-side only" framing is wrong: the server rejects negative quantity (BIZ-07), naked shorts (BIZ-09), and unknown symbols (BIZ-12). Those three are now documented as **server-side controls present (not exploitable)** with a historical note, rather than live vulns. The only order-sizing check that remains purely client-side is the max-order-size cap of 10,000 units. The money, matching, replay, slippage, price-band and pricing bugs below are still live and proven.

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
| File | `AdminStompController.java:137-156`, `StompChannelInterceptor.java:142-158`, `PriceSimulatorService.java:194-208` |

**Description:** Any authenticated user can set arbitrary prices for any symbol via the admin WebSocket endpoint (see WS-02 / AUTHZ-09). `admin.setPrice` has no role enforcement — `StompChannelInterceptor` only *logs* a warning for a non-admin sender, it never blocks the message. The price persists permanently: `PriceSimulatorService.setPrice` adds the symbol to `overriddenSymbols`, so the simulator skips it until restart. Combined with position holding, this enables pump-and-dump attacks.

**Attack scenario:**
1. Buy 10,000 VULN at $42 (cost: $420,000)
2. Send: `sendMessage('/app/admin.setPrice', {symbol: 'VULN', price: 99999})`
3. Position now worth $999,990,000
4. ROI skyrockets, you're #1 on leaderboard

This corresponds to Flag 11 (`FLAG{m4rk3t_m4n1pul4t0r_numb3r_0n3}`). Note the app has no code path that auto-awards the flag string for reaching #1 — see [10-ctf-flags.md](10-ctf-flags.md) for how the flag value is actually retrieved.

**What you learn:** Price oracles must be protected. In DeFi, oracle manipulation is the #1 attack vector. This simulates that exact class of vulnerability.

---

### BIZ-02: Sign Flip — Negative Withdrawal = Deposit
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A04: Insecure Design |
| CWE | CWE-20 |
| Difficulty | Intermediate |
| Endpoint | `POST /api/accounts/withdraw` (also STOMP `/app/trade.withdraw`) |
| File | `AccountService.java:62-64,81` |

**Description:** The withdrawal endpoint doesn't validate that the amount is positive. Line 81 does `currentBalance.subtract(amount)`, so a negative `amount` subtracts a negative = a deposit (balance increases instead of decreasing). The same unchecked `withdraw()` is reachable over WebSocket at `/app/trade.withdraw`.

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
| File | `AccountService.java:68,71,81` |

**Description:** The balance is read (line 68), checked (line 71) and deducted (line 81) with no lock or atomic update. Two concurrent withdrawal requests can both pass the balance check before either deduction occurs, resulting in double-spend (lost update).

**How to exploit:**
Send several concurrent requests each for more than half the balance. Serially only one could fit, but due to the race window multiple succeed — the exploit suite fires 6×6000 against a 10,000 balance and sees ≥2 go through while the balance is debited only once.

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
| Endpoint | `POST /api/accounts/deposit` (also STOMP `/app/trade.deposit`) |
| File | `AccountService.java:113-123` |

**Description:** The deposit endpoint accepts any `sourceAccount` string and any amount, and simply does `balance.add(amount)` (line 121). No verification against a real bank or payment provider. Free money.

---

### BIZ-06: Wash Trading (Self-Matching)
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A04: Insecure Design |
| CWE | CWE-840 |
| Difficulty | Advanced |
| File | `MatchingEngineService.java:118-119` |

**Description:** The order matching engine doesn't check if the buyer and seller are the same user (no self-trade prevention in `tryMatch`). A user can rest both a BUY and a SELL order on the same symbol, cross against themselves, and create artificial trading volume to inflate their leaderboard position. (The trade log even records `selfTrade=true`, but nothing blocks it.)

---

### BIZ-07: Negative Order Quantity — Server-Side Control Present
| Field | Value |
|-------|-------|
| Status | ✅ Mitigated — server-side control present (not exploitable) |
| OWASP | A04: Insecure Design |
| CWE | CWE-20 |
| File | `RiskService.java:50-53` |

**Description:** Negative (and zero) order quantities are now **rejected server-side**. `RiskService.checkPreTrade` runs for all order types and returns `"Invalid quantity: must be greater than 0"` when `quantity <= 0`; `OrderService.placeOrder` turns that into a rejected order. A STOMP `placeOrder` with `quantity:-10` comes back as an `ERROR`, not an `ORDER_PLACED`.

**Historical note:** This was previously exploitable (no quantity validation) — kept here as a documented control so the before/after is traceable.

---

### BIZ-08: No Price Band Validation
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A04: Insecure Design |
| CWE | CWE-20 |
| Difficulty | Intermediate |
| File | `RiskService.java:55-60` |

**Description:** Still live. `RiskService` validates only that a LIMIT price is `> 0` (lines 55-60) — there is **no** price-band / circuit-breaker check, so orders at $0.01 or $999,999 are accepted far from the ~$178 market. In real exchanges, orders far from the current market price are rejected. (Proven: AAPL accepted at both 0.01 and 999999.)

---

### BIZ-09: Naked Shorting — Server-Side Control Present
| Field | Value |
|-------|-------|
| Status | ✅ Mitigated — server-side control present (not exploitable) |
| OWASP | A04: Insecure Design |
| CWE | CWE-20 |
| File | `RiskService.java:102-110`, `MatchingEngineService.java:296-303` |

**Description:** Selling more shares than you own is now **rejected server-side**. `RiskService.checkPreTrade` requires the seller to hold enough of the asset and returns `"Insufficient position..."` otherwise; a SELL of 999999 AAPL with no position comes back as an `ERROR`. As a defence-in-depth backstop, `MatchingEngineService.updatePosition` also floors positions at zero instead of going negative.

**Historical note:** Previously a position could go negative (naked short with no borrow/margin check) — kept as a documented control.

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

### BIZ-12: Non-Existent Symbol — Server-Side Control Present
| Field | Value |
|-------|-------|
| Status | ✅ Mitigated — server-side control present (not exploitable) |
| OWASP | A04: Insecure Design |
| CWE | CWE-20 |
| File | `RiskService.java:62-66` |

**Description:** Orders for symbols that don't exist in the `symbols` table are now **rejected server-side**. `RiskService.checkPreTrade` looks the symbol up and returns `"Unknown symbol: <sym>"` when it is missing (it also rejects non-tradable symbols). A `placeOrder` for `DOESNOTEXIST999` comes back as an `ERROR`.

**Historical note:** Previously unknown symbols were accepted and processed — kept as a documented control.

---

### BIZ-13: clientOrderId Replay Allowed
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A04: Insecure Design |
| CWE | CWE-294 |
| File | `OrderService.java:116` |

**Description:** The `clientOrderId` field is stored verbatim (line 116) and is not unique-enforced. The same order can be submitted multiple times with the same client ID, each creating a distinct server order — enabling replay attacks. (Proven: an identical `clientOrderId` accepted twice, yielding two different `orderId`s.)

---

### BIZ-14: No Slippage Protection on Market Orders
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A04: Insecure Design |
| CWE | CWE-20 |
| Endpoint | STOMP `/app/trade.executeMarket` |
| File | `OrderService.java:198-232`, `TradeStompController.java:144-174` |

**Description:** Market orders execute at whatever price the order book / liquidity provider offers. MARKET orders *are* now risk-checked (balance, symbol, quantity) and the halt check applies to them, but there is still **no maximum-slippage or price-protection** parameter — the client cannot cap the fill price. Combined with price manipulation (BIZ-01), this enables sandwich attacks. (Proven: a market BUY filled with no price limit.)

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
| File | `PriceSimulatorService.java:126-132` |

**Description:** The VULN symbol follows a perfectly predictable sinusoidal pattern: `100 + 20 * sin(tickCount * 0.1)` (band ~80–120). A bot can predict future prices and trade accordingly for guaranteed profits. (The wider `random` walk also uses a fixed seed of 42 — see `PriceSimulatorService.java:39`.)
