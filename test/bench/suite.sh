#!/usr/bin/env bash
# The full benchmark set for one version (about 20 minutes).
#
#   OUT=<results dir> test/bench/suite.sh <v0|v1> <frontend-url> <namespace>
#
#   1. warm-up      mixed, 60 s (results thrown away)
#   2. mixed x3     50 traders (0.5-1.5 s think time) + 50 price-stream listeners, 180 s each
#   3. stress       same mix with no think time, at 50 and at 100 traders, 90 s each
#   4. isolated     one scenario at a time, 50 traders, no think time, 60 s each
#   5. (v1 only)    mixed with FX trading added, 180 s
set -euo pipefail
target=$1 url=$2 ns=$3
here=$(cd "$(dirname "$0")" && pwd)
run() { echo "== $1"; "$here/run.sh" "$@"; }

OUT=${OUT:-./bench-results}/warmup run warmup "$target" "$url" "$ns" 60 -u 100 -r 20
for i in 1 2 3; do run "mixed-$i" "$target" "$url" "$ns" 180 -u 100 -r 20; done
VT_NO_THINK=1 run stress-50 "$target" "$url" "$ns" 90 -u 100 -r 20
VT_NO_THINK=1 run stress-100 "$target" "$url" "$ns" 90 -u 150 -r 30
for s in read eq_mkt eq_lim cr_mkt cr_lim login; do
  VT_NO_THINK=1 run "iso-$s" "$target" "$url" "$ns" 60 Trader -u 50 -r 25 --tags "$s"
done
if [ "$target" = v1 ]; then
  VT_FX=1 run mixed-fx "$target" "$url" "$ns" 180 -u 100 -r 20
  VT_NO_THINK=1 VT_FX=1 run iso-fx "$target" "$url" "$ns" 60 Trader -u 50 -r 25 --tags fx
fi
echo "suite done"
