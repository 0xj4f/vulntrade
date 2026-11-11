#!/usr/bin/env bash
# One benchmark run = environment snapshot + invariants snapshot + Locust + invariants check.
#
#   test/bench/run.sh <label> <v0|v1> <frontend-url> <namespace> <seconds> [locust args...]
#
# Examples:
#   test/bench/run.sh v0-mixed-1 v0 http://192.168.67.2:30080 vt-before 180 -u 100 -r 20
#   VT_NO_THINK=1 test/bench/run.sh v0-stress-50 v0 http://192.168.67.2:30080 vt-before 90 -u 100 -r 20
#   test/bench/run.sh v0-iso-eq_mkt v0 http://192.168.67.2:30080 vt-before 60 Trader -u 50 -r 25 --tags eq_mkt
#
# Results land in $OUT/<label>/ (default OUT=./bench-results): Locust CSV + HTML, invariants,
# pod CPU/memory before and after, host load, and the other minikube cluster's CPU (noise check).
set -euo pipefail
label=$1 target=$2 url=$3 ns=$4 secs=$5; shift 5
here=$(cd "$(dirname "$0")" && pwd)
out=${OUT:-./bench-results}/$label
mkdir -p "$out"
py=${PYTHON:-python3}
locust=${LOCUST:-locust}

snap_env() {
  { echo "## $1 $(date -Is)"; uptime
    docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}' 2>/dev/null | grep -E 'minikube|thinkpad|vulntrade' || true
    kubectl -n "$ns" top pods 2>/dev/null || true
    kubectl -n "$ns" get pods -o custom-columns=POD:.metadata.name,RESTARTS:.status.containerStatuses[*].restartCount --no-headers
  } >> "$out/environment.txt"
}

snap_env before
python3 "$here/../invariants.py" --ns "$ns" --target "$target" snapshot > "$out/invariants-before.json"
VT_TARGET=$target $locust -f "$here/locustfile.py" --host "$url" --headless -t "${secs}s" \
  --csv "$out/locust" --html "$out/locust.html" --only-summary "$@" > "$out/locust.txt" 2>&1 || true
snap_env after
python3 "$here/../invariants.py" --ns "$ns" --target "$target" check --since "$out/invariants-before.json" > "$out/invariants.txt" 2>&1 || true
tail -1 "$out/invariants.txt"
grep -E 'Aggregated' "$out/locust.txt" | head -1
