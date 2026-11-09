#!/usr/bin/env bash
# shellcheck disable=SC2016  # the jq conditions use $vars on purpose (jq --arg), so single quotes are right
################################################################################
# test-security-events.sh - end-to-end check of VulnTrade's security.log
#
# What it does:
#   1. Notes how many lines security.log has now.
#   2. Drives real flows over HTTP (curl) and STOMP (adversarial-emulation's
#      lib/stomp_send.py). Every HTTP call gets its own User-Agent tag,
#      "VT-SECEVENTS-TEST/<run id>/<tag>", so its events can be found again.
#   3. Reads ONLY the lines this run added and checks them against
#      docs/logging-guide.md: the shape of every line (§2), the event each flow
#      must write (§4), and that no password / JWT / API key was written (§3).
#   4. Prints a PASS/FAIL table.
#
# Run it against a backend rebuilt with the new logging:
#   docker compose up -d --build
#   ./test/test-security-events.sh
#
# Settings (env vars, all optional):
#   BASE_URL   default http://localhost:8085
#   WS_URL     default ws://localhost:8085/ws
#   LOG_FILE   default <repo>/logs/vulntrade/security.log (the docker bind mount)
#   PYBIN      python with websocket-client; default exploit/.venv/bin/python3
#
# What it changes in the lab (small, and undone where possible):
#   - registers one new user vtsec_<run id> (left in place, enabled)
#   - trader1: deposit 10, withdraw -10, withdraw 20 -> balance unchanged
#   - two 1-share AAPL BUY limit orders at $1.00, both cancelled again
#   - halts and then resumes the made-up symbol VTTEST (no real market)
#   - sets logger SECURITY_EVENTS to INFO (its normal level)
#
# Exit code: 0 = all checks passed, 1 = at least one FAIL, 2 = could not run.
################################################################################

set -uo pipefail   # no "set -e": many calls are EXPECTED to return 4xx

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BASE_URL="${BASE_URL:-http://localhost:8085}"
WS_URL="${WS_URL:-ws://localhost:8085/ws}"
LOG_FILE="${LOG_FILE:-$REPO_DIR/logs/vulntrade/security.log}"

# Seeded accounts (backend/.../config/DataInitializer.java) and the debug key (application.yml)
TRADER_USER="${TRADER_USER:-trader1}"
TRADER_PASS="${TRADER_PASS:-password}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin123}"
DEBUG_KEY="${DEBUG_KEY:-vulntrade-debug-key-2024}"
HALT_SYMBOL="${HALT_SYMBOL:-VTTEST}"   # made up on purpose: no real market is ever halted

# Helpers reused from the adversarial-emulation suite
STOMP_SEND="$REPO_DIR/adversarial-emulation/lib/stomp_send.py"
export VTLAB_DIR="$REPO_DIR/exploit"   # jwt.sh imports exploit/vtlab/jwt_utils.py
if [[ -z "${PYBIN:-}" ]]; then
  if [[ -x "$VTLAB_DIR/.venv/bin/python3" ]]; then
    PYBIN="$VTLAB_DIR/.venv/bin/python3"
  else
    PYBIN="$(command -v python3)"
  fi
fi
export PYBIN
# shellcheck source=SCRIPTDIR/../adversarial-emulation/lib/jwt.sh
source "$REPO_DIR/adversarial-emulation/lib/jwt.sh"   # gives: forge_none BASE_TOKEN ROLE LEVEL

# --- Names and secrets for this run -------------------------------------------
RUN_ID="$(date +%Y%m%d%H%M%S)-$RANDOM"
FRESH_USER="vtsec_${RUN_ID//-/_}"                  # the new user this run registers
FRESH_EMAIL="${FRESH_USER}@example.test"
FRESH_EMAIL_NEW="${FRESH_USER}.new@example.test"
UNKNOWN_USER="vtsec_nobody_${RUN_ID//-/_}"
UNKNOWN_EMAIL="vtsec-nobody-${RUN_ID}@example.test"
FRESH_PASS="VtSecRegister-$RUN_ID"                 # distinctive passwords, so we can
NEW_PASS="VtSecChanged-$RUN_ID"                    # grep security.log for them later
RESET_PASS="VtSecReset-$RUN_ID"
WRONG_PASS="VtSecWrong-$RUN_ID"
SQLI_USER="x' OR '1'='1"
BAD_API_KEY="vt-api-bogus-$RUN_ID"

# --- Output helpers ------------------------------------------------------------
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  GREEN=$'\e[32m'; RED=$'\e[31m'; BOLD=$'\e[1m'; DIM=$'\e[2m'; RST=$'\e[0m'
else
  GREEN=""; RED=""; BOLD=""; DIM=""; RST=""
fi

section() { echo; echo "${BOLD}== $* ==${RST}"; }
info()    { echo "${DIM}   $*${RST}"; }
abort()   { echo "${RED}ABORT${RST}: $*"; exit 2; }

CHECK_NAMES=()
CHECK_RESULTS=()
FAILS=0

# record PASS|FAIL NAME [NOTE] -> print one result line and remember it for the summary
record() {
  CHECK_RESULTS+=("$1")
  CHECK_NAMES+=("$2")
  if [[ "$1" == PASS ]]; then
    echo "  ${GREEN}PASS${RST} $2"
  else
    FAILS=$((FAILS + 1))
    echo "  ${RED}FAIL${RST} $2${3:+   -> $3}"
  fi
}

TMP_BASE="${TMPDIR:-/tmp}"
TMP_DIR="$(mktemp -d "${TMP_BASE%/}/vt-secevents.XXXXXX")"
RAW="$TMP_DIR/new-lines.raw"     # the new security.log lines, exactly as written
NEW="$TMP_DIR/new-lines.jsonl"   # the same lines, keeping only valid JSON objects
KEEP_TMP=0
trap '[[ "$KEEP_TMP" == 1 ]] || rm -rf "$TMP_DIR"' EXIT

# --- HTTP helpers --------------------------------------------------------------

# ua TAG -> the User-Agent that marks one HTTP call of this run
ua() { echo "VT-SECEVENTS-TEST/$RUN_ID/$1"; }

# api TAG TOKEN METHOD PATH [JSON_BODY] [extra curl args...]
#   TAG    short name for this call (goes into the User-Agent)
#   TOKEN  JWT sent as "Authorization: Bearer ...", or - for none
# Sets STATUS (HTTP status code) and BODY (response body).
api() {
  local tag="$1" token="$2" method="$3" path="$4" body="${5:-}"
  shift 5 2>/dev/null || shift "$#"
  local args=(-sS --max-time 20 -o "$TMP_DIR/body" -w '%{http_code}'
              -X "$method" "$BASE_URL$path" -H "User-Agent: $(ua "$tag")")
  if [[ -n "$token" && "$token" != "-" ]]; then
    args+=(-H "Authorization: Bearer $token")
  fi
  if [[ -n "$body" ]]; then
    args+=(-H "Content-Type: application/json" --data "$body")
  fi
  STATUS="$(curl "${args[@]}" "$@" 2>/dev/null)" || true
  BODY="$(cat "$TMP_DIR/body" 2>/dev/null)" || true
  rm -f "$TMP_DIR/body"
  printf '   %-6s %-46s %-16s -> %s\n' "$method" "$path" "[$tag]" "${STATUS:-000}"
}

# jget JQ_PATH -> one field of the last response body ("" when missing)
jget() { jq -r "$1 // empty" <<<"$BODY" 2>/dev/null || true; }

# creds USER PASS -> login JSON (jq does the quoting, which matters for the SQLi name)
creds() { jq -nc --arg u "$1" --arg p "$2" '{username: $u, password: $p}'; }

# need VALUE WHAT -> stop when a value that later steps depend on is missing
need() { [[ -n "$1" ]] || abort "no $2 (last HTTP status ${STATUS:-000}). Is the backend up and rebuilt?"; }

# stomp_session LABEL TOKEN PLAN_JSON -> one STOMP connection running PLAN (see stomp_send.py)
#   TOKEN "" connects without a token. STOMP_TOKEN="" stops the script picking one up from the env.
stomp_session() {
  local label="$1" token="$2" plan="$3" out
  if [[ -n "$token" ]]; then
    out="$(STOMP_TOKEN="" "$PYBIN" "$STOMP_SEND" --ws-url "$WS_URL" --token "$token" <<<"$plan" 2>&1)"
  else
    out="$(STOMP_TOKEN="" "$PYBIN" "$STOMP_SEND" --ws-url "$WS_URL" <<<"$plan" 2>&1)"
  fi
  if grep -q '"event": "done"' <<<"$out"; then
    info "STOMP $label: connected, sent $(grep -c '"event": "sent"' <<<"$out") frame(s)"
  else
    record FAIL "STOMP session $label ran" "$(head -c 300 <<<"$out")"
  fi
}

# --- Assertion helpers (they read $NEW) ----------------------------------------

# source_filter SOURCE -> jq condition selecting the lines that one source wrote
#   <tag>       the HTTP call made with that tag (matched on its User-Agent)
#   no-ua       the HTTP call sent without a User-Agent
#   stomp       the STOMP session of the new user
#   stomp-anon  STOMP lines with no user (the CONNECT without a token)
source_filter() {
  case "$1" in
    no-ua)      echo '.transport == "HTTP" and .userAgent == ""' ;;
    stomp)      echo '.transport == "STOMP" and .username == $fresh_user' ;;
    stomp-anon) echo '.transport == "STOMP" and (has("username") | not)' ;;
    *)          echo '.userAgent == $ua' ;;
  esac
}

# count SOURCE EVENT [CONDITION] -> how many new lines from SOURCE have that eventType
#   CONDITION is extra jq. It may use: $fresh_user $fresh_id $t1_user $t1_id $sqli $halt_symbol
count() {
  jq -s \
    --arg ua "$(ua "$1")" --arg event "$2" \
    --arg fresh_user "$FRESH_USER" --arg fresh_id "${FRESH_ID:-}" \
    --arg t1_user "$TRADER_USER" --arg t1_id "${T1_ID:-}" \
    --arg sqli "$SQLI_USER" --arg halt_symbol "$HALT_SYMBOL" \
    "[.[] | select(($(source_filter "$1")) and .eventType == \$event and (${3:-true}))] | length" \
    "$NEW" 2>/dev/null || echo "jq-error"
}

# expect once|some|none SOURCE EVENT [CONDITION]
#   once = exactly one line, some = one or more, none = zero
expect() {
  local how="$1" src="$2" event="$3" cond="${4:-true}" n ok=no
  n="$(count "$src" "$event" "$cond")"
  case "$how" in
    once) [[ "$n" == 1 ]] && ok=yes ;;
    some) [[ "$n" =~ ^[1-9][0-9]*$ ]] && ok=yes ;;
    none) [[ "$n" == 0 ]] && ok=yes ;;
  esac
  local name="[$src] $event ($how)"
  [[ "$cond" == true ]] || name="$name where $cond"
  if [[ "$ok" == yes ]]; then record PASS "$name"; else record FAIL "$name" "found $n"; fi
}

# every NAME CONDITION -> PASS when every new line satisfies the jq CONDITION
every() {
  local bad
  bad="$(jq -c "select(($2) | not)" "$NEW" 2>&1)"
  if [[ -z "$bad" ]]; then
    record PASS "$1"
  else
    record FAIL "$1" "$(wc -l <<<"$bad" | tr -d ' ') line(s), e.g. $(head -n 1 <<<"$bad" | cut -c 1-300)"
  fi
}

# never_logged NAME VALUE -> FAIL when VALUE appears anywhere in the new lines
never_logged() {
  if [[ -z "$2" ]]; then info "skipped: $1 (no value captured)"; return; fi
  local n
  n="$(grep -cF -- "$2" "$RAW")" || true
  if [[ "$n" == 0 ]]; then record PASS "$1 not logged"; else record FAIL "$1 not logged" "in $n line(s)"; fi
}

# never_a_value NAME VALUE -> FAIL when any JSON value equals VALUE exactly.
#   For short, common seed passwords like "password", where a substring grep would
#   also hit harmless words such as "password_changed".
never_a_value() {
  local n
  n="$(jq -s --arg v "$2" '[.[] | select([.. | scalars | tostring] | any(. == $v))] | length' "$NEW")"
  if [[ "$n" == 0 ]]; then record PASS "$1 not logged"; else record FAIL "$1 not logged" "in $n line(s)"; fi
}

################################################################################
section "0. Preflight"
################################################################################
info "BASE_URL=$BASE_URL  WS_URL=$WS_URL"
info "LOG_FILE=$LOG_FILE  run id=$RUN_ID"
command -v curl >/dev/null || abort "curl not found"
command -v jq   >/dev/null || abort "jq not found"
"$PYBIN" -c 'import websocket' 2>/dev/null || abort "$PYBIN cannot import websocket (pip install websocket-client)"
[[ -f "$STOMP_SEND" ]] || abort "missing $STOMP_SEND"

api health - GET /api/health
[[ "$STATUS" == 200 ]] || abort "backend not reachable at $BASE_URL"
[[ -f "$LOG_FILE" ]] || abort "$LOG_FILE not found (set LOG_FILE=...)"

START_LINE=$(( $(wc -l < "$LOG_FILE") ))
info "security.log has $START_LINE lines before this run"

################################################################################
section "1. Authentication (HTTP)"
################################################################################
api login-ok - POST /api/auth/login "$(creds "$TRADER_USER" "$TRADER_PASS")"
T1_TOKEN="$(jget .token)"
T1_ID="$(jget .userId)"
T1_ROLE="$(jget .role)"
T1_LEVEL="$(jget .accountLevel)"
T1_API_KEY="$(jget .apiKey)"
T1_API_KEY="${T1_API_KEY:-vt-api-trader1-key}"
need "$T1_TOKEN" "token for $TRADER_USER"
need "$T1_ID" "user id for $TRADER_USER"

api login-badpw  - POST /api/auth/login "$(creds "$TRADER_USER" "$WRONG_PASS")"
api login-nouser - POST /api/auth/login "$(creds "$UNKNOWN_USER" "$WRONG_PASS")"
api legacy-ok    - POST /api/auth/login-legacy "$(creds "$TRADER_USER" "$TRADER_PASS")"
LEGACY_TOKEN="$(jget .token)"
api legacy-sqli  - POST /api/auth/login-legacy "$(creds "$SQLI_USER" "$WRONG_PASS")"

api register - POST /api/auth/register \
  "$(jq -nc --arg u "$FRESH_USER" --arg e "$FRESH_EMAIL" --arg p "$FRESH_PASS" '{username: $u, email: $e, password: $p}')"
FRESH_TOKEN="$(jget .token)"
FRESH_ID="$(jget .userId)"
need "$FRESH_TOKEN" "token for the new user $FRESH_USER"
need "$FRESH_ID" "user id for the new user $FRESH_USER"

api reset-known    - POST /api/auth/reset "$(jq -nc --arg e "$FRESH_EMAIL" '{email: $e}')"
RESET_TOKEN="$(jget .debug_token)"
api reset-unknown  - POST /api/auth/reset "$(jq -nc --arg e "$UNKNOWN_EMAIL" '{email: $e}')"
api reset-badtoken - POST /api/auth/reset-confirm \
  "$(jq -nc --arg t "not-a-token-$RUN_ID" --arg p "$RESET_PASS" '{token: $t, newPassword: $p}')"

api change-pw "$FRESH_TOKEN" PUT  /api/auth/change-password "$(jq -nc --arg p "$NEW_PASS" '{newPassword: $p}')"
api refresh   "$T1_TOKEN"    POST /api/auth/refresh-token
REFRESHED_TOKEN="$(jget .token)"
# Logout is at the end of section 7: JWTs are stateless, so we keep using T1_TOKEN until then.

################################################################################
section "2. User profiles (HTTP)"
################################################################################
api read-other    "$T1_TOKEN"    GET "/api/users/$FRESH_ID"    # cross-user read: must log
api read-own      "$T1_TOKEN"    GET "/api/users/$T1_ID"       # own read: must NOT log
api profile-email "$FRESH_TOKEN" PUT "/api/users/$FRESH_ID" "$(jq -nc --arg e "$FRESH_EMAIL_NEW" '{email: $e}')"
api kyc           "$FRESH_TOKEN" PUT "/api/users/$FRESH_ID/profile" '{"firstName":"Vt","lastName":"Sectest"}'
KYC_TOKEN="$(jget .token)"   # the KYC call mints a new token

################################################################################
section "3. Deposit and withdraw (HTTP)"
################################################################################
# Funding needs accountLevel 2 in the JWT, and the server trusts the claim (VULN #92/#94).
FORGED_TOKEN="$(forge_none "$T1_TOKEN" "${T1_ROLE:-TRADER}" 2)"
need "$FORGED_TOKEN" "forged alg:none token"
if [[ "${T1_LEVEL:-1}" == 2 ]]; then
  FUND_TOKEN="$T1_TOKEN"
  info "$TRADER_USER is already level 2: using the real token"
else
  FUND_TOKEN="$FORGED_TOKEN"
  info "$TRADER_USER is level ${T1_LEVEL:-1}: using a forged alg:none token with accountLevel 2"
fi
# +10, +10 (sign flip), -20: the balance ends where it started.
api deposit      "$FUND_TOKEN" POST /api/accounts/deposit  '{"amount":10,"sourceAccount":"VT-SECEVENTS-TEST"}'
api withdraw-neg "$FUND_TOKEN" POST /api/accounts/withdraw '{"amount":-10,"destinationAccount":"VT-SECEVENTS-TEST"}'
api withdraw     "$FUND_TOKEN" POST /api/accounts/withdraw '{"amount":20,"destinationAccount":"VT-SECEVENTS-TEST"}'

################################################################################
section "4. Orders and export (HTTP)"
################################################################################
# A $1.00 bid never matches the seeded asks, so nothing trades.
ORDER_BODY='{"symbol":"AAPL","side":"BUY","type":"LIMIT","quantity":1,"price":1.00}'
api order-own   "$T1_TOKEN"    POST /api/equities/orders "$ORDER_BODY"   # 1.0.0: orders live on the product gateways
OWN_ORDER_ID="$(jget .orderId)"
api order-other "$FRESH_TOKEN" POST /api/equities/orders "$ORDER_BODY"
OTHER_ORDER_ID="$(jget .orderId)"
api cancel-own   "$T1_TOKEN" POST "/api/equities/orders/$OWN_ORDER_ID/cancel"
api cancel-other "$T1_TOKEN" POST "/api/equities/orders/$OTHER_ORDER_ID/cancel"   # someone else's order (IDOR)
api export       "$T1_TOKEN" GET  /api/export/trades

################################################################################
section "5. Admin (HTTP)"
################################################################################
api admin-login - POST /api/auth/login "$(creds "$ADMIN_USER" "$ADMIN_PASS")"
ADMIN_TOKEN="$(jget .token)"
api admin-users "$ADMIN_TOKEN" GET  /api/admin/users
api admin-query "$ADMIN_TOKEN" POST /api/admin/execute-query '{"sql":"SELECT 1"}'
api toggle-off  "$ADMIN_TOKEN" PUT  "/api/admin/users/$FRESH_ID/toggle"   # disables the new user
api toggle-on   "$ADMIN_TOKEN" PUT  "/api/admin/users/$FRESH_ID/toggle"   # and enables it again
api adjust      "$ADMIN_TOKEN" POST /api/admin/adjust-balance \
  "$(jq -nc --arg id "$FRESH_ID" '{userId: ($id | tonumber), amount: 1, reason: "vt-secevents-test"}')"

################################################################################
section "6. Debug endpoints (HTTP)"
################################################################################
api debug-badkey - POST /api/debug/execute '{"command":"id"}' -H "X-Debug-Key: wrong-key-$RUN_ID"
api debug-exec   - POST /api/debug/execute '{"command":"id"}' -H "X-Debug-Key: $DEBUG_KEY"
api debug-query  - POST /api/debug/query   '{"sql":"SELECT 1"}' -H "X-Debug-Key: $DEBUG_KEY"

################################################################################
section "7. Fallbacks, framework surfaces, API keys, tokens (HTTP)"
################################################################################
api unauth   - GET  /api/accounts/balance                          # no token -> 403
# The one call with NO User-Agent header (curl's -H 'User-Agent:' removes it).
STATUS="$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' -H 'User-Agent:' "$BASE_URL/api/accounts/balance" 2>/dev/null)" || true
printf '   %-6s %-46s %-16s -> %s\n' GET /api/accounts/balance "[no-ua]" "${STATUS:-000}"
api bad-json - POST /api/auth/login '{"username": "broken'           # malformed JSON -> 400
api actuator - GET  /actuator/health
api loggers  - POST /actuator/loggers/SECURITY_EVENTS '{"configuredLevel":"INFO"}'   # INFO is its normal level
api h2       - GET  /h2-console
api apikey-ok  - GET "/api/users/$T1_ID" "" -H "X-API-Key: $T1_API_KEY"
api apikey-bad - GET "/api/users/$T1_ID" "" -H "X-API-Key: $BAD_API_KEY"
api alg-none "$FORGED_TOKEN" GET "/api/users/$T1_ID"                # own read, so only the token event
api logout   "$T1_TOKEN"     POST /api/auth/logout

################################################################################
section "8. WebSocket / STOMP"
################################################################################
# As the new (non-admin) user: admin topic + admin commands are let through but must
# be logged. The 1 s pause makes sure the halt is handled before the resume.
STOMP_PLAN="$(jq -nc --arg sym "$HALT_SYMBOL" '[
  {action: "subscribe", destination: "/topic/admin/alerts"},
  {action: "send", destination: "/app/admin.haltTrading", body: {symbol: $sym, reason: "vt-secevents-test"}},
  {action: "collect", seconds: 1},
  {action: "send", destination: "/app/admin.resumeTrading", body: {symbol: $sym}},
  {action: "send", destination: "/app/trade.getHistory",
   body: {startDate: "2000-01-01", endDate: "2100-01-01", symbol: "AAPL"}},
  {action: "collect", seconds: 2}
]')"
stomp_session "with token ($FRESH_USER)" "$FRESH_TOKEN" "$STOMP_PLAN"
stomp_session "without token" "" '[{"action":"collect","seconds":1}]'

################################################################################
section "9. Reading the new security.log lines"
################################################################################
sleep 2
END_LINE=$(( $(wc -l < "$LOG_FILE") ))
if (( END_LINE < START_LINE )); then
  info "security.log got shorter (rotated?): checking the whole current file"
  START_LINE=0
fi
tail -n "+$((START_LINE + 1))" "$LOG_FILE" > "$RAW"
jq -R -c 'fromjson? | select(type == "object")' "$RAW" > "$NEW"
info "$((END_LINE - START_LINE)) new line(s)"

################################################################################
section "10. Every new line has the canonical shape (logging-guide §2)"
################################################################################
BAD_JSON="$(jq -R -r '. as $line | try (fromjson | if type == "object" then empty else $line end) catch $line' "$RAW")"
if [[ -z "$BAD_JSON" ]]; then
  record PASS "every line is one JSON object"
else
  record FAIL "every line is one JSON object" "$(head -n 1 <<<"$BAD_JSON" | cut -c 1-300)"
fi
if [[ -s "$NEW" ]]; then record PASS "security.log got new lines"; else record FAIL "security.log got new lines" "none - is the backend writing $LOG_FILE?"; fi

every "required fields present" \
  '(["@timestamp","level","logger","thread","application","environment","category","eventType","outcome","message","transport"] - keys) == []'
every "application is vulntrade"          '.application == "vulntrade"'
every "eventType is lower_snake_case"     '.eventType | type == "string" and test("^[a-z0-9_]+$")'
every "category is lower_snake_case"      '.category | type == "string" and test("^[a-z0-9_]+$")'
every "no old UPPER_SNAKE eventType"      '(.eventType | tostring | test("[A-Z]")) | not'
every "outcome is success|failure|denied|error" '.outcome | IN("success", "failure", "denied", "error")'
every "level matches outcome"             'has("level") and {"success": "INFO", "failure": "WARN", "denied": "WARN", "error": "ERROR"}[.outcome // ""] == .level'
every "message is the eventType with spaces" '.message == ((.eventType // "") | gsub("_"; " "))'
every "transport is HTTP, STOMP or SYSTEM" '.transport | IN("HTTP", "STOMP", "SYSTEM")'
every "SYSTEM lines: background work, initiator=system or no user" \
  '.transport != "SYSTEM" or ((has("requestId") | not) and (has("sessionId") | not))'
every "HTTP lines: requestId, clientIp, userAgent, no sessionId" \
  '.transport != "HTTP" or (has("requestId") and has("clientIp") and has("userAgent") and (has("sessionId") | not))'
every "STOMP lines: sessionId, no requestId" \
  '.transport != "STOMP" or (has("sessionId") and (has("requestId") | not))'
every "httpStatus only on authorization_denied / input_validation_failed / unexpected_exception" \
  '(has("httpStatus") | not) or (.eventType | IN("authorization_denied", "input_validation_failed", "unexpected_exception"))'

################################################################################
section "11. Each flow wrote its event (logging-guide §4)"
################################################################################
echo "${DIM}  -- authentication, credentials, account${RST}"
expect once login-ok       login_success              '.username == $t1_user'
expect once login-badpw    login_failure              '.details.reason == "bad_password" and .details.attemptedUsername == $t1_user and (has("username") | not)'
expect once login-nouser   login_failure              '.details.reason == "user_not_found"'
expect once legacy-ok      login_success              '.path == "/api/auth/login-legacy"'
expect once legacy-sqli    login_failure              '.details.attemptedUsername == $sqli'
expect once register       account_created            '.username == $fresh_user'
expect once reset-known    password_reset_requested   '.outcome == "success"'
expect once reset-unknown  password_reset_requested   '.outcome == "failure"'
expect once reset-badtoken password_reset_completed   '.outcome == "failure" and .details.reason == "invalid_token"'
expect none reset-badtoken input_validation_failed    # the 400 is explained, so no fallback
expect once change-pw      password_changed           '.outcome == "success"'
expect once refresh        refresh_token_used         '.outcome == "success"'
expect once logout         logout

echo "${DIM}  -- user profiles${RST}"
expect once read-other     sensitive_data_read        '(.details.targetUserId | tostring) == $fresh_id'
expect none read-own       sensitive_data_read
expect once profile-email  security_attribute_updated '.details.changedFields | tostring | test("email")'
expect once kyc            sensitive_data_updated     '.details.resource == "kyc_profile"'
expect once kyc            permission_changed         '(.details.accountLevel | tostring) == "2"'

echo "${DIM}  -- funding${RST}"
expect once deposit        deposit_completed
expect once withdraw-neg   withdrawal_completed       '.details.amount | tostring | startswith("-")'
expect once withdraw       withdrawal_completed
if [[ "$FUND_TOKEN" == "$FORGED_TOKEN" ]]; then
  expect once deposit      token_validation_failed    '.details.reason == "alg_none"'
fi

echo "${DIM}  -- orders and export${RST}"
expect once order-own      order_created
expect once order-other    order_created
expect once cancel-own     order_cancelled            '.outcome == "success" and .details.isOwner == true'
expect once cancel-other   order_cancelled            '.outcome == "success" and .details.isOwner == false and (.details.targetUserId | tostring) == $fresh_id'
expect once export         data_exported

echo "${DIM}  -- admin${RST}"
expect once admin-login    login_success
expect once admin-users    sensitive_data_read        '.details.targetUserId == null'
expect once admin-query    admin_action               '.details.action == "execute_query" and .outcome == "success"'
expect once toggle-off     account_disabled           '(.details.targetUserId | tostring) == $fresh_id'
expect once toggle-on      account_enabled            '(.details.targetUserId | tostring) == $fresh_id'
expect some adjust         admin_action               '.details.action == "adjust_balance"'

echo "${DIM}  -- debug${RST}"
expect once debug-badkey   authorization_denied       '.httpStatus == 403'
expect none debug-badkey   debug_command_executed
expect once debug-exec     debug_command_executed     '.details.command == "id"'
expect once debug-query    debug_query_executed

echo "${DIM}  -- fallbacks, framework, API keys, tokens${RST}"
expect once unauth         authorization_denied       '.httpStatus | IN(401, 403)'
expect once no-ua          authorization_denied       '.path == "/api/accounts/balance"'
expect once bad-json       input_validation_failed    '.httpStatus == 400'
expect once actuator       framework_endpoint_accessed '.details.surface == "actuator"'
expect once loggers        audit_configuration_changed '.details.loggerName == "SECURITY_EVENTS"'
expect none loggers        framework_endpoint_accessed # audit_configuration_changed is the only event
expect once h2             framework_endpoint_accessed '.details.surface == "h2_console"'
expect once apikey-ok      api_key_used               '.outcome == "success" and .details.source == "header"'
expect once apikey-bad     api_key_used               '.outcome == "failure"'
expect once apikey-bad     authorization_denied
expect once alg-none       token_validation_failed    '.details.reason == "alg_none"'

echo "${DIM}  -- websocket / STOMP${RST}"
expect once stomp          session_created
expect once stomp          websocket_authorization_failed '.path == "/topic/admin/alerts"'
expect once stomp          websocket_authorization_failed '.path == "/app/admin.haltTrading"'
expect once stomp          websocket_authorization_failed '.path == "/app/admin.resumeTrading"'
expect once stomp          admin_action               '.details.action == "halt_trading" and .details.symbol == $halt_symbol'
expect once stomp          admin_action               '.details.action == "resume_trading"'
expect once stomp          sensitive_data_read        '.details.resource == "trade_history"'
expect some stomp-anon     websocket_authentication_failed '.details.reason == "missing_token"'

# Wazuh 110441 joins the failed admin SEND and the admin_action on sessionId.
SAME_SESSION="$(jq -s --arg fresh_user "$FRESH_USER" '
  [.[] | select(.transport == "STOMP" and .username == $fresh_user)] as $mine
  | ([$mine[] | select(.eventType == "websocket_authorization_failed" and .path == "/app/admin.haltTrading") | .sessionId] | first) as $denied
  | ([$mine[] | select(.eventType == "admin_action" and .details.action == "halt_trading") | .sessionId] | first) as $acted
  | $denied != null and $denied == $acted' "$NEW" 2>/dev/null)"
if [[ "$SAME_SESSION" == true ]]; then
  record PASS "[stomp] halt_trading admin_action has the sessionId of its websocket_authorization_failed"
else
  record FAIL "[stomp] halt_trading admin_action has the sessionId of its websocket_authorization_failed"
fi

################################################################################
section "12. No secrets in the new lines (logging-guide §3 rule 6)"
################################################################################
never_logged  "password: new user's register password"     "$FRESH_PASS"
never_logged  "password: change-password new password"      "$NEW_PASS"
never_logged  "password: reset-confirm new password"        "$RESET_PASS"
never_logged  "password: wrong password of the bad logins"  "$WRONG_PASS"
never_a_value "password: $TRADER_USER's password"           "$TRADER_PASS"
never_a_value "password: $ADMIN_USER's password"            "$ADMIN_PASS"
never_logged  "JWT: $TRADER_USER login token"               "$T1_TOKEN"
never_logged  "JWT: legacy login token"                     "$LEGACY_TOKEN"
never_logged  "JWT: new user's register token"              "$FRESH_TOKEN"
never_logged  "JWT: token minted by the KYC update"         "$KYC_TOKEN"
never_logged  "JWT: refreshed token"                        "$REFRESHED_TOKEN"
never_logged  "JWT: admin login token"                      "${ADMIN_TOKEN:-}"
never_logged  "JWT: forged alg:none token"                  "$FORGED_TOKEN"
never_logged  "API key: $TRADER_USER's key"                 "$T1_API_KEY"
never_logged  "API key: the bad key"                        "$BAD_API_KEY"
never_logged  "password reset token"                        "${RESET_TOKEN:-}"
never_logged  "debug key"                                   "$DEBUG_KEY"

################################################################################
section "Summary"
################################################################################
i=0
while (( i < ${#CHECK_NAMES[@]} )); do
  if [[ "${CHECK_RESULTS[$i]}" == PASS ]]; then result="${GREEN}PASS${RST}"; else result="${RED}FAIL${RST}"; fi
  printf '  %s  %s\n' "$result" "${CHECK_NAMES[$i]}"
  i=$((i + 1))
done
echo
TOTAL=${#CHECK_NAMES[@]}
if (( FAILS > 0 )); then
  KEEP_TMP=1
  echo "${RED}${BOLD}$FAILS of $TOTAL checks FAILED${RST}  (run id $RUN_ID)"
  echo "The new security.log lines of this run are in: $NEW"
  exit 1
fi
echo "${GREEN}${BOLD}All $TOTAL checks passed${RST}  (run id $RUN_ID)"
exit 0
