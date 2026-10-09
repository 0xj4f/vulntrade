# 01 — Authentication & Session Management

## Overview
VulnTrade's authentication system has vulnerabilities at every layer: login, JWT token generation, session management, and password reset. In a real trading platform, these would allow account takeover, impersonation, and unauthorized access to financial operations.

---

## Vulnerabilities

### AUTH-01: User Enumeration via Login Error Messages
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A07: Identification and Authentication Failures |
| CWE | CWE-204 |
| Difficulty | Beginner |
| Endpoint | `POST /api/auth/login` |
| File | `AuthController.java:72,83` |

**Description:** The login endpoint returns different error messages for "user not found" (line 72) vs "wrong password" (line 83), allowing attackers to enumerate valid usernames.

**How to exploit:**
```bash
# Invalid username
curl -X POST http://localhost:8085/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"nonexistent","password":"test"}'
# Response: "User not found"

# Valid username, wrong password
curl -X POST http://localhost:8085/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"wrongpass"}'
# Response: "Invalid password"
```

**What you learn:** Authentication endpoints should return generic errors like "Invalid credentials" regardless of whether the username or password is wrong.

---

### AUTH-02: SQL Injection in Legacy Login (Blind / Error-Based)
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A03: Injection |
| CWE | CWE-89 |
| Difficulty | Intermediate |
| Endpoint | `POST /api/auth/login-legacy` |
| File | `AuthController.java:143` |

**Description:** The legacy login endpoint concatenates the username directly into a SQL query without parameterization — `"SELECT * FROM users WHERE username = '" + username + "'"` (line 143), executed via `createNativeQuery` (line 144). The endpoint is genuinely SQL-injectable, **but the classic `' OR '1'='1` authentication bypass does _not_ work**: the app still bcrypt-verifies the supplied password against whatever row the query returns (line 155), so a matched row with the wrong password is still rejected. Injection is exploited through side channels instead:

- **Boolean-blind oracle** — "row found" vs "no row" leaks through two different 401 messages, giving a controllable TRUE/FALSE oracle for extracting data character by character.
- **Error-based** — an unbalanced quote breaks the SQL grammar and returns HTTP 500 leaking `org.hibernate ... SQLGrammarException`.

**How to exploit (boolean-blind oracle):**
```bash
# TRUE  predicate: username = trader1' AND '1'='1  -> row matches -> bcrypt fails -> "Invalid password"
# FALSE predicate: username = trader1' AND '1'='2  -> no row                     -> "User not found"
curl -X POST http://localhost:8085/api/auth/login-legacy \
  -H "Content-Type: application/json" \
  --data-raw '{"username":"trader1'\'' AND '\''1'\''='\''1","password":"x"}'
# => {"error":"Invalid password"}

curl -X POST http://localhost:8085/api/auth/login-legacy \
  -H "Content-Type: application/json" \
  --data-raw '{"username":"trader1'\'' AND '\''1'\''='\''2","password":"x"}'
# => {"error":"User not found"}
```

**How to exploit (error-based):**
```bash
# A stray quote breaks SQL grammar -> HTTP 500 leaking the Hibernate SQLGrammarException
curl -X POST http://localhost:8085/api/auth/login-legacy \
  -H "Content-Type: application/json" \
  --data-raw '{"username":"trader1'\''","password":"x"}'
```

See [INJ-01](03-injection.md) for the same injection point treated as a data-extraction primitive.

**What you learn:** Always use parameterized queries. A defence-in-depth password re-check stopped the auth bypass here, but the query is still injectable and leaks data through blind and error-based side channels. Legacy endpoints are a common real-world attack surface during migrations.

---

### AUTH-03: Password in URL (GET Login)
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A07: Identification and Authentication Failures |
| CWE | CWE-598 |
| Difficulty | Beginner |
| Endpoint | `GET /api/auth/login?username=X&password=Y` |
| File | `AuthController.java:123,130` |

**Description:** A GET-based login endpoint accepts credentials as URL query parameters, exposing them in server logs, browser history, and referrer headers.

---

### AUTH-04: Weak JWT Secret
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A02: Cryptographic Failures |
| CWE | CWE-326 |
| Difficulty | Intermediate |
| File | `application.yml:88`, `JwtTokenProvider.java:45,88` |

**Description:** The JWT signing secret defaults to `vulntrade-secret` (`application.yml:88`). Tokens are signed with the raw UTF-8 bytes of this string (`JwtTokenProvider.java:45,88`), so anyone who knows (or cracks) it can mint valid HS256 tokens for any user with any role.

**How to exploit:**
1. Visit jwt.io
2. Decode any valid JWT from login response
3. Modify `role` to `ADMIN`, `accountLevel` to `2`
4. Sign with secret `vulntrade-secret` (HS256)
5. Use forged token in `Authorization: Bearer <token>` header

---

### AUTH-05: JWT alg:none Bypass
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A02: Cryptographic Failures |
| CWE | CWE-347 |
| Difficulty | Advanced |
| File | `JwtTokenProvider.java:142` |

**Description:** When signature validation fails, the JWT parser falls back to manual Base64 decoding of the payload (`JwtTokenProvider.java:142-154`). A token with `alg:none` and no signature is therefore accepted as a valid session.

---

### AUTH-06: JWT Role Tampering
| Field | Value |
|-------|-------|
| Severity | Critical |
| OWASP | A01: Broken Access Control |
| CWE | CWE-863 |
| Difficulty | Intermediate |
| File | `JwtAuthFilter.java:37` |

**Description:** The user's role is stored in the JWT payload and trusted without database verification. A user can decode their JWT, change `"role":"TRADER"` to `"role":"ADMIN"`, re-sign with the weak secret, and gain admin access.

---

### AUTH-07: Account Level Stored in JWT (No DB Check)
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A01: Broken Access Control |
| CWE | CWE-807 |
| Difficulty | Intermediate |
| File | `JwtTokenProvider.java:38,60,97` |

**Description:** The `accountLevel` claim is written into the JWT at token creation (`JwtTokenProvider.java:38,60`) and read straight back out to gate deposits/withdrawals (`JwtTokenProvider.java:97`) without ever verifying against the database. Forging `accountLevel:2` bypasses KYC verification. See [AUTHZ-11](02-authorization.md) for the deposit/withdraw gate that trusts this claim.

---

### AUTH-08: Password Change Without Old Password
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A07: Identification and Authentication Failures |
| CWE | CWE-620 |
| Difficulty | Beginner |
| Endpoint | `PUT /api/auth/change-password` |
| File | `AuthController.java` |

**Description:** Password changes don't require the current password. If an attacker has a valid session (e.g., via XSS stealing the localStorage token), they can change the password and lock out the real user.

---

### AUTH-09: Predictable Password Reset Tokens
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A02: Cryptographic Failures |
| CWE | CWE-330 |
| Difficulty | Intermediate |
| Endpoint | `POST /api/auth/reset` |
| File | `AuthController.java:257,265` |

**Description:** Reset tokens are `String.valueOf(System.currentTimeMillis())` — timestamp-based and predictable (`AuthController.java:257`). The token is also leaked in the API response via the `debug_token` / `reset_url` fields (`AuthController.java:265-266`). Tokens never expire and are reusable.

---

### AUTH-10: JWT Not Invalidated After Logout/Password Change
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A07: Identification and Authentication Failures |
| CWE | CWE-613 |
| Difficulty | Beginner |
| File | `AuthContext.js:99` |

**Description:** Logout only clears localStorage — the JWT token remains valid on the server. Old tokens continue to work indefinitely after logout or password change.

---

### AUTH-11: Mass Assignment on Registration
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A04: Insecure Design |
| CWE | CWE-915 |
| Difficulty | Intermediate |
| Endpoint | `POST /api/auth/register` |
| File | `AuthController.java` |

**Description:** The registration endpoint accepts a `role` parameter from the request body. A user can register directly as `ADMIN` by including `"role":"ADMIN"` in the registration payload.

**How to exploit:**
```bash
curl -X POST http://localhost:8085/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"hacker","password":"test","email":"h@h.com","role":"ADMIN"}'
```

---

### AUTH-12: API Key Leaked in Login Response
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A07: Identification and Authentication Failures |
| CWE | CWE-200 |
| Difficulty | Beginner |
| Endpoint | `POST /api/auth/login` |
| File | `AuthController.java:107` |

**Description:** The login response includes the user's API key in plaintext (`AuthController.java:107`). Check the response body in DevTools Network tab.

---

### AUTH-13: Email Change Without Verification
| Field | Value |
|-------|-------|
| Severity | Medium |
| OWASP | A07: Identification and Authentication Failures |
| CWE | CWE-304 |
| Difficulty | Beginner |
| Endpoint | `PUT /api/users/{id}` |

**Description:** Email can be changed without any verification email or confirmation step. Combined with IDOR, an attacker can change any user's email.

---

### AUTH-14: JWT Expiration Check Bypassed
| Field | Value |
|-------|-------|
| Severity | High |
| OWASP | A07: Identification and Authentication Failures |
| CWE | CWE-613 |
| Difficulty | Advanced |
| File | `JwtTokenProvider.java:137` |

**Description:** The token validation catches `ExpiredJwtException` (`JwtTokenProvider.java:137`) but still returns the claims (line 138), effectively bypassing the expiration check — an expired but correctly-signed token is still accepted.
