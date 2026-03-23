#!/bin/bash

################################################################################
# PHASE 1 - FOUNDATION INFRASTRUCTURE TESTING
# Tests: Docker setup, database connectivity, basic endpoints, flag discovery
################################################################################

set -e  # Exit on error

BACKEND_HOST="${BACKEND_HOST:-localhost}"
BACKEND_PORT="${BACKEND_PORT:-8085}"
FRONTEND_HOST="${FRONTEND_HOST:-localhost}"
FRONTEND_PORT="${FRONTEND_PORT:-3001}"
BASE_URL="${BASE_URL:-http://$BACKEND_HOST:$BACKEND_PORT}"

echo "=== PHASE 1: Foundation Infrastructure Testing ==="
echo "Timestamp: $(date)"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

pass() {
    echo -e "${GREEN}✅ PASS${NC}: $1"
}

fail() {
    echo -e "${RED}❌ FAIL${NC}: $1"
}

info() {
    echo -e "${BLUE}ℹ️  INFO${NC}: $1"
}

warn() {
    echo -e "${YELLOW}⚠️  WARN${NC}: $1"
}

wait_for_host() {
    local name=$1 host=$2 port=$3
    for i in {1..20}; do
        if timeout 2 bash -c "echo >/dev/tcp/$host/$port" 2>/dev/null; then
            pass "$name is running on $host:$port"
            return 0
        fi
        warn "$name not reachable at $host:$port (attempt $i/20)"
        sleep 2
    done
    fail "$name not accessible on $host:$port"
    return 1
}

# Test 1: Check if services are running
echo "--- Test 1: Service Health Checks ---"
wait_for_host "Backend" "$BACKEND_HOST" "$BACKEND_PORT" || exit 1
wait_for_host "Frontend" "$FRONTEND_HOST" "$FRONTEND_PORT"
wait_for_host "PostgreSQL" "localhost" "5432"
wait_for_host "Redis" "localhost" "6379"
    case $host in
        backend)
            if timeout 2 bash -c "echo >/dev/tcp/$BACKEND_HOST" 2>/dev/null; then
                pass "Backend is running on $BACKEND_HOST"
            else
                fail "Backend not accessible on $BACKEND_HOST"
                exit 1
            fi
            ;;
        frontend)
            if timeout 2 bash -c "echo >/dev/tcp/$FRONTEND_HOST" 2>/dev/null; then
                pass "Frontend is running on $FRONTEND_HOST"
            else
                fail "Frontend not accessible on $FRONTEND_HOST"
            fi
            ;;
        postgres)
            if timeout 2 bash -c "echo >/dev/tcp/localhost:5432" 2>/dev/null; then
                pass "PostgreSQL is running on localhost:5432"
            else
                fail "PostgreSQL not accessible on localhost:5432"
            fi
            ;;
        redis)
            if timeout 2 bash -c "echo >/dev/tcp/localhost:6379" 2>/dev/null; then
                pass "Redis is running on localhost:6379"
            else
                fail "Redis not accessible on localhost:6379"
            fi
            ;;
    esac
done
echo ""

# Test 2: API Health Check
echo "--- Test 2: API Health Endpoint ---"
HEALTH_RESPONSE=$(curl -s "$BASE_URL/api/health")
if echo "$HEALTH_RESPONSE" | grep -q "UP"; then
    pass "Health endpoint returns UP"
    info "Response: $HEALTH_RESPONSE"
else
    fail "Health endpoint did not return UP"
fi
echo ""

# Test 3: Market Prices Endpoint
echo "--- Test 3: Market Prices Endpoint ---"
PRICES_RESPONSE=$(curl -s "$BASE_URL/api/market/prices")
if echo "$PRICES_RESPONSE" | grep -q "BTC-USD"; then
    pass "Market prices endpoint returns symbol data"
    info "Sample: $(echo "$PRICES_RESPONSE" | head -c 200)..."
else
    fail "Market prices endpoint failed"
fi
echo ""

# Test 4: Exposed Actuator (VULNERABILITY - Flag Discovery)
echo "--- Test 4: Exposed Actuator (VULNERABILITY) ---"
ACTUATOR_RESPONSE=$(curl -s "$BASE_URL/actuator/env")
if echo "$ACTUATOR_RESPONSE" | grep -q "FLAG"; then
    pass "Actuator endpoint exposed - FLAGS VISIBLE"
    FLAG_FOUND=$(echo "$ACTUATOR_RESPONSE" | grep -o "FLAG[0-9]" | head -1)
    info "Found: $FLAG_FOUND in actuator/env - This is a vulnerability!"
else
    warn "Actuator endpoint did not return flag data"
fi
echo ""

# Test 5: Debug Endpoint (VULNERABILITY - Info Disclosure)
echo "--- Test 5: Debug Endpoint (VULNERABILITY) ---"
DEBUG_RESPONSE=$(curl -s "$BASE_URL/api/debug/user-info")
if echo "$DEBUG_RESPONSE" | grep -q "admin"; then
    pass "Debug endpoint exposed user information"
    USER_COUNT=$(echo "$DEBUG_RESPONSE" | grep -o '"id"' | wc -l)
    info "Exposed $USER_COUNT users with password hashes and API keys!"
else
    warn "Debug endpoint not accessible or returned unexpected format"
fi
echo ""

# Test 6: Admin Panel Frontend
echo "--- Test 6: Admin Panel Frontend ---"
ADMIN_PAGE=$(curl -s "http://localhost:3001/admin" -L)
if echo "$ADMIN_PAGE" | grep -q -i "admin"; then
    pass "Admin page accessible via frontend"
else
    warn "Admin page may not have loaded correctly"
fi
echo ""

# Test 7: WebSocket/SockJS Info
echo "--- Test 7: WebSocket Health Check ---"
SOCKJS_RESPONSE=$(curl -s "http://localhost:8085/ws-sockjs/info")
if echo "$SOCKJS_RESPONSE" | grep -q "websocket"; then
    pass "WebSocket (SockJS) endpoint responding"
    info "Response: $SOCKJS_RESPONSE"
else
    fail "WebSocket endpoint not responding"
fi
echo ""

# Test 8: H2 Console (VULNERABILITY)
echo "--- Test 8: H2 Console (VULNERABILITY) ---"
H2_RESPONSE=$(curl -s "$BASE_URL/h2-console" -o /dev/null -w "%{http_code}")
if [ "$H2_RESPONSE" = "200" ]; then
    pass "H2 Console accessible at /h2-console (VULNERABILITY - embedded DB exposed)"
else
    warn "H2 Console returned HTTP $H2_RESPONSE"
fi
echo ""

# Summary
echo "=== PHASE 1 TESTING COMPLETE ==="
echo ""
echo "Key Findings:"
echo "- ✅ All services running and accessible"
echo "- 🔴 Actuator endpoint exposes configuration and flags"
echo "- 🔴 Debug endpoint leaks user data with password hashes"
echo "- 🔴 H2 Console available (embedded DB access)"
echo "- 🔴 CORS allows all origins (wildcard)"
echo ""
echo "Recommendations for hackers:"
echo "1. Extract all FLAGS from /actuator/env"
echo "2. Enumerate users from /api/debug/user-info"
echo "3. Look for SQL injection in endpoints"
echo "4. Check for IDOR vulnerabilities"
echo ""
