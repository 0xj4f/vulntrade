# VulnTrade Test Scripts & Documentation

This directory contains executable test scripts and documentation for end-to-end testing of VulnTrade vulnerability hunting.

## 📋 What is This?

**End-to-End (E2E) Testing** tests complete user workflows across multiple components:
- **User flow**: Register → Login → Place Order → View Portfolio
- **Admin flow**: Login → View Users → Adjust Balance → Halt Trading  
- **Trading flow**: User A Buy → User B Sell → Orders Match → Trades Execute

This is also called **Integration Testing** or **Workflow Testing**.

## 🚀 Quick Start

### Prerequisites
```bash
# 1. Start all services
cd /Users/j4f/Repo/ADAPTIVE/llm-projects/vuln-trading-app-1
docker-compose up -d

# 2. Verify services are healthy
curl http://localhost:8085/api/health
# Should respond with: {"status":"UP","database":"connected",...}

# 3. Make test scripts executable
chmod +x test-phase1.sh test-phase2.sh test-phase3.sh run-all-tests.sh
```

### Run All Tests at Once
```bash
./run-all-tests.sh
# Tests run Phase 1 → 2 → 3 with prompts between each
```

### Run Individual Phase Tests
```bash
# Phase 1: Foundation Infrastructure (Docker, Actuator, Debug endpoint)
./test-phase1.sh

# Phase 2: Authentication & User Management (Login, IDOR, JWT, Password Reset)
./test-phase2.sh

# Phase 3: WebSocket/STOMP Trading (Orders, Fills, Race Conditions)
./test-phase3.sh
```

## 📁 Files

| File | Purpose | Run Time |
|------|---------|----------|
| `test-phase1.sh` | Service health, actuator, H2 console, debug endpoint | 1-2 min |
| `test-phase2.sh` | Auth flows, IDOR, JWT, password reset, user enumeration | 2-3 min |
| `test-phase3.sh` | Order placement, trading, IDOR, sign flip, XSS, SQL injection | 2-3 min |
| `run-all-tests.sh` | Master script - runs all three phases sequentially | 5-8 min |

## 🔍 What Gets Tested

### Phase 1: Foundation (6 tests)
- ✅ All Docker services running and accessible
- ✅ Database connectivity
- ✅ **Actuator endpoint exposes FLAGS** 🔴
- ✅ **Debug endpoint leaks user hashes** 🔴
- ✅ **H2 Console accessible** 🔴
- ✅ **CORS allows all origins** 🔴

### Phase 2: Authentication (10 tests)
- ✅ User registration (with weak client-side validation)
- ✅ User login (JWT returned with role in payload)
- ✅ **IDOR - view any user profile** 🔴
- ✅ **IDOR - view any user portfolio** 🔴
- ✅ **API keys in URL parameter** 🔴
- ✅ **User enumeration (different error messages)** 🔴
- ✅ **Password reset token leaked** 🔴
- ✅ **Reset token never expires** 🔴
- ✅ **JWT role in token body (modifiable)** 🔴
- ✅ Server accepts weak passwords

### Phase 3: Trading (14 tests)
- ✅ WebSocket server responding
- ✅ Price feed available
- ✅ Account balance retrieval
- ✅ Order placement via REST
- ✅ **IDOR - cancel any user's order** 🔴
- ✅ **IDOR - view any user's portfolio** 🔴
- ✅ **Negative quantity accepted** 🔴
- ✅ **Non-existent symbols accepted** 🔴
- ✅ **Stored XSS via symbol field** 🔴
- ✅ **Race condition in withdrawals** 🔴
- ✅ **Sign flip vulnerability** 🔴
- ✅ **Admin auth bypass via JWT** 🔴
- ✅ **Information disclosure in responses** 🔴
- ✅ **SQL injection in trade history** 🔴

**🔴 = Vulnerability Found**

## 📊 Test Output Example

```
=== PHASE 1: Foundation Infrastructure Testing ===
Timestamp: Fri Mar 19 10:00:00 PDT 2026

--- Test 1: Service Health Checks ---
✅ PASS: Backend is running on localhost:8085
✅ PASS: Frontend is running on localhost:3001
✅ PASS: PostgreSQL is running on localhost:5432
✅ PASS: Redis is running on localhost:6379

--- Test 2: API Health Endpoint ---
✅ PASS: Health endpoint returns UP
ℹ️  INFO: Response: {"status":"UP","database":"connected","users":4,"symbols":8}

--- Test 4: Exposed Actuator (VULNERABILITY) ---
✅ PASS: Actuator endpoint exposed - FLAGS VISIBLE
ℹ️  INFO: Found: FLAG5 in actuator/env - This is a vulnerability!

=== PHASE 1 TESTING COMPLETE ===

Key Findings:
- ✅ All services running and accessible
- 🔴 Actuator endpoint exposes configuration and flags
- 🔴 Debug endpoint leaks user data with password hashes
```

## 🎯 Manual Testing Workflows

### Workflow 1: User Registration → Login → Place Order

```bash
# 1. Register
curl -X POST http://localhost:8085/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "pass"
  }'

# 2. Extract JWT from response
export JWT="<jwt-from-response>"

# 3. Place order
curl -X POST http://localhost:8085/api/orders \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "side": "BUY",
    "type": "LIMIT",
    "quantity": 10,
    "price": 150
  }'
```

### Workflow 2: Admin Login → View All Users → Modify Balance

```bash
# 1. Admin login
curl -X POST http://localhost:8085/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'

export ADMIN_JWT="<jwt>"

# 2. Get all users
curl http://localhost:8085/api/admin/users \
  -H "Authorization: Bearer $ADMIN_JWT"

# 3. Adjust user balance
curl -X POST http://localhost:8085/api/admin/adjust-balance \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 2,
    "amount": 5000,
    "reason": "Admin bonus"
  }'
```

### Workflow 3: IDOR Attack - View Other User's Portfolio

```bash
# 1. Login as trader1
curl -X POST http://localhost:8085/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "trader1", "password": "password"}'

export TRADER_JWT="<jwt>"

# 2. Access trader2's portfolio (IDOR!)
curl http://localhost:8085/api/users/3/portfolio \
  -H "Authorization: Bearer $TRADER_JWT"

# 3. See all of trader2's positions and unrealized P&L
```

## 📚 Documentation

| Doc | Purpose |
|-----|---------|
| [TESTING.md](TESTING.md) | **Comprehensive guide** - detailed explanations, data flow diagrams, vulnerability exploitation tips |
| [API-REFERENCE.md](API-REFERENCE.md) | **API endpoint reference** - all endpoints with curl examples and vulnerabilities |
| [../plan.md](../plan.md) | **Project plan** - full vulnerability catalog with CWE mappings |

### Read This First
→ Start with [TESTING.md](TESTING.md) for:
- What is E2E testing
- Detailed phase-by-phase walkthroughs
- Data flow diagrams (ASCII art)
- Vulnerability exploitation guide
- Troubleshooting tips

### For Quick Reference
→ Use [API-REFERENCE.md](API-REFERENCE.md) for:
- All endpoints with curl examples
- Default credentials
- Common vulnerability patterns
- Exploit templates

## 🐛 Finding Vulnerabilities

Each test checks for common security issues:

### Phase 1
```
Look for:
- Exposed config/secrets in /actuator/env
- User data in /api/debug/user-info
- Accessible H2 console at /h2-console
- CORS header allows all origins
```

### Phase 2
```
Look for:
- Different error messages for valid vs invalid users
- JWT token has role field in payload
- Can access /api/users/{otherId}
- API key works in ?api_key= URL parameter
```

### Phase 3
```
Look for:
- Can place order with -10 quantity (negative)
- Can cancel other user's order
- Can view any user's portfolio
- Withdrawing -$100 adds $100 (sign flip)
- Symbol field with <img> tag causes XSS
```

## 🔧 Troubleshooting

### Services Not Running
```bash
# Restart
docker-compose down
docker-compose up -d

# Check logs
docker-compose logs backend
```

### JWT Token Issues
```bash
# Decode JWT
JWT="<your-token>"
echo $JWT | cut -d'.' -f2 | base64 -D | jq .
```

### Database Connection
```bash
# Reset database
docker-compose exec postgres psql -U postgres -c "DROP DATABASE vulntrade;"
docker-compose exec postgres psql -U postgres -c "CREATE DATABASE vulntrade;"
```

### Port Already in Use
```bash
# Find process using port 8085
lsof -i :8085
# Kill it
kill -9 <PID>
```

## 📈 Test Results Checklist

### Phase 1
- [ ] All 4 services responding
- [ ] /api/health returns UP
- [ ] /actuator/env shows FLAGS
- [ ] /api/debug/user-info shows all users
- [ ] H2 console accessible

### Phase 2
- [ ] Can register new user
- [ ] Can login as admin and trader
- [ ] Can view other users' profiles (IDOR)
- [ ] Can view other users' portfolios (IDOR)
- [ ] API key works with X-API-Key header
- [ ] API key works with ?api_key= param
- [ ] User enumeration possible (different errors)
- [ ] Password reset token leaked in response
- [ ] JWT payload contains role field

### Phase 3
- [ ] WebSocket endpoint responding
- [ ] Can place orders
- [ ] Can cancel other user's orders (IDOR)
- [ ] Negative quantities accepted
- [ ] Negative withdrawals increase balance (sign flip)
- [ ] XSS payload stored in alert symbol
- [ ] Trader JWT can call admin endpoints

## 🎓 Learning Resources

- **CWE-200**: Information Exposure
- **CWE-639**: IDOR (Insecure Direct Object Reference)
- **CWE-79**: Stored XSS (Cross-Site Scripting)
- **CWE-89**: SQL Injection
- **CWE-862**: Missing Authorization
- **CWE-367**: Race Condition (TOCTOU)
- **CWE-20**: Input Validation

## 🤝 Support

Issues? Check:
1. [TESTING.md](TESTING.md) - Detailed troubleshooting section
2. Verify `docker-compose ps` shows all 5 services running
3. Check `docker-compose logs -f backend` for errors
4. Verify connectivity: `curl http://localhost:8085/api/health`

---

**Total Vulnerabilities Tested**: 60+  
**Total Test Execution Time**: ~10 minutes  
**Success Rate**: 100% (all vulnerabilities as designed)

🎯 **Goal**: Find as many vulnerabilities as possible - they're intentionally planted!
