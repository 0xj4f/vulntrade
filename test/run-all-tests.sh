#!/bin/bash

################################################################################
# QUICK START - RUN ALL PHASE TESTS
# This script runs Phase 1, 2, and 3 tests in sequence
################################################################################

echo "╔════════════════════════════════════════════════════════════╗"
echo "║           VulnTrade - Complete Test Suite                 ║"
echo "║        Phase 1, 2, and 3 Vulnerability Testing            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check prerequisites
echo "Checking prerequisites..."

# Check if Docker services are running
if ! curl -s http://localhost:8085/api/health > /dev/null 2>&1; then
    echo -e "${RED}❌ ERROR${NC}: Backend is not running!"
    echo "Please start services with: docker-compose up -d"
    exit 1
fi

echo -e "${GREEN}✅${NC} All services healthy"
echo ""

# Get current script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Run Phase 1 Tests
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}PHASE 1: Foundation Infrastructure${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""

if [ -f "$SCRIPT_DIR/test-phase1.sh" ]; then
    bash "$SCRIPT_DIR/test-phase1.sh"
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Phase 1 tests completed${NC}"
    else
        echo -e "${RED}❌ Phase 1 tests failed${NC}"
    fi
else
    echo -e "${RED}❌ test-phase1.sh not found${NC}"
fi

echo ""
echo "Press Enter to continue to Phase 2..."
read

# Run Phase 2 Tests
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}PHASE 2: Authentication & User Management${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""

if [ -f "$SCRIPT_DIR/test-phase2.sh" ]; then
    bash "$SCRIPT_DIR/test-phase2.sh"
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Phase 2 tests completed${NC}"
    else
        echo -e "${RED}❌ Phase 2 tests failed${NC}"
    fi
else
    echo -e "${RED}❌ test-phase2.sh not found${NC}"
fi

echo ""
echo "Press Enter to continue to Phase 3..."
read

# Run Phase 3 Tests
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}PHASE 3: WebSocket/STOMP Trading${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""

if [ -f "$SCRIPT_DIR/test-phase3.sh" ]; then
    bash "$SCRIPT_DIR/test-phase3.sh"
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Phase 3 tests completed${NC}"
    else
        echo -e "${RED}❌ Phase 3 tests failed${NC}"
    fi
else
    echo -e "${RED}❌ test-phase3.sh not found${NC}"
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║           ALL TESTS COMPLETED!                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "1. Review vulnerabilities found in each phase"
echo "2. Check docs/TESTING.md for detailed explanations"
echo "3. Check docs/API-REFERENCE.md for endpoint details"
echo "4. Attempt manual exploits using curl commands"
echo ""
