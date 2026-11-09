#!/usr/bin/env python3
"""
Money and order invariants for VulnTrade, checked straight in Postgres (kubectl exec psql).

    python3 test/invariants.py --ns vt-after --target v1 snapshot > before.json
    ... run traffic ...
    python3 test/invariants.py --ns vt-after --target v1 check --since before.json

  I1  nobody except the house has a negative cash/coin balance or share position
  I2  (v1) held money = sum of hold_left of open orders, per account and asset
  I3  conservation: totals per asset change only by external flows (deposits, withdrawals,
      admin adjustments, house seed) booked in the ledger since the snapshot
  I4  orders: filled_qty <= quantity, filled_qty = sum of its trades, no MARKET order left open
  I5  no Postgres deadlocks since the snapshot

Exit code 0 when everything holds. Users named bug_% (vulnerability probes) are ignored
by I1, because their whole point is to break the rules.
"""
import argparse
import json
import subprocess
import sys
import time
from decimal import Decimal

HOUSE = 1
EXTERNAL_TYPES = "('DEPOSIT','WITHDRAW','ADJUSTMENT','HOUSE_SEED')"


def psql(ns, sql):
    out = subprocess.run(["kubectl", "-n", ns, "exec", "postgres-0", "--", "psql", "-U", "postgres", "-d", "vulntrade",
                          "-At", "-F", "\t", "-c", sql], capture_output=True, text=True, check=True).stdout
    return [line.split("\t") for line in out.strip().splitlines() if line.strip()]


def totals(ns, target):
    """Total amount per asset across everyone (house included)."""
    t = {}
    cash = psql(ns, "SELECT COALESCE(SUM(balance),0) FROM users")[0][0]
    t["USD"] = Decimal(cash)                       # MAIN cash (v1) / the only cash (v0)
    if target == "v1":
        for asset, amount in psql(ns, "SELECT asset, SUM(available + held) FROM balances GROUP BY asset"):
            t[asset] = t.get(asset, Decimal(0)) + Decimal(amount)
    for symbol, qty in psql(ns, "SELECT symbol, SUM(quantity) FROM positions GROUP BY symbol"):
        t["shares:" + symbol] = Decimal(qty)
    return t


def snapshot(ns, target):
    deadlocks = psql(ns, "SELECT deadlocks FROM pg_stat_database WHERE datname = 'vulntrade'")[0][0]
    now = psql(ns, "SELECT now()")[0][0]
    return {"at": now, "deadlocks": int(deadlocks), "totals": {k: str(v) for k, v in totals(ns, target).items()}}


def external_flows(ns, target, since):
    """Ledger rows that legitimately add or remove money, per asset, since the snapshot."""
    asset_col = "asset" if target == "v1" else "'USD'"
    rows = psql(ns, "SELECT %s, COALESCE(SUM(amount),0) FROM transactions WHERE type IN %s AND created_at > '%s' GROUP BY 1"
                % (asset_col, EXTERNAL_TYPES, since))
    return {asset: Decimal(amount) for asset, amount in rows}


def check(ns, target, before):
    failures = []

    def expect(name, rows):
        ok = not rows
        print("  [%s] %s%s" % ("PASS" if ok else "FAIL", name, "" if ok else "  -> %s" % rows[:5]))
        if not ok:
            failures.append(name)

    print("I1 no negative money")
    expect("no negative MAIN cash (non-house)",
           psql(ns, "SELECT id, balance FROM users WHERE id <> %d AND balance < 0 AND username NOT LIKE 'bug\\_%%'" % HOUSE))
    expect("no negative share position (non-house)",
           psql(ns, "SELECT p.user_id, p.symbol, p.quantity FROM positions p JOIN users u ON u.id = p.user_id "
                    "WHERE p.user_id <> %d AND p.quantity < 0 AND u.username NOT LIKE 'bug\\_%%'" % HOUSE))
    if target == "v1":
        expect("no negative product balance (non-house)",
               psql(ns, "SELECT a.user_id, a.product, b.asset, b.available, b.held FROM balances b "
                        "JOIN accounts a ON a.id = b.account_id JOIN users u ON u.id = a.user_id "
                        "WHERE a.user_id <> %d AND (b.available < 0 OR b.held < 0) AND u.username NOT LIKE 'bug\\_%%'" % HOUSE))
        print("I2 holds match open orders")
        expect("held = sum(hold_left) of open orders, per account/asset",
               psql(ns, """
                 WITH h AS (
                   SELECT a.id AS account_id,
                          CASE WHEN o.product = 'CRYPTO' AND o.side = 'SELL' THEN split_part(o.symbol, '-', 1) ELSE 'USD' END AS asset,
                          SUM(o.hold_left) AS hold
                   FROM orders o JOIN accounts a ON a.user_id = o.user_id AND a.product = o.product
                   WHERE o.status IN ('NEW','PARTIAL') GROUP BY 1, 2)
                 SELECT b.account_id, b.asset, b.held, COALESCE(h.hold, 0)
                 FROM balances b LEFT JOIN h ON h.account_id = b.account_id AND h.asset = b.asset
                 WHERE b.held <> COALESCE(h.hold, 0)"""))
        expect("closed orders hold nothing",
               psql(ns, "SELECT id, status, hold_left FROM orders WHERE status NOT IN ('NEW','PARTIAL') AND hold_left <> 0"))

    print("I3 conservation since %s" % before["at"])
    now = totals(ns, target)
    flows = external_flows(ns, target, before["at"])
    bad = []
    for asset in sorted(set(now) | set(before["totals"])):
        delta = now.get(asset, Decimal(0)) - Decimal(before["totals"].get(asset, "0"))
        expected = flows.get(asset, Decimal(0)) if not asset.startswith("shares:") else Decimal(0)
        if abs(delta - expected) > Decimal("0.000001"):
            bad.append((asset, str(delta), str(expected)))
    expect("every asset total changed only by deposits/withdrawals/adjustments", bad)

    print("I4 orders")
    expect("filled_qty <= quantity", psql(ns, "SELECT id FROM orders WHERE filled_qty > quantity"))
    expect("filled_qty = sum of trades",
           psql(ns, "SELECT o.id, o.filled_qty, COALESCE(SUM(t.quantity),0) FROM orders o "
                    "LEFT JOIN trades t ON t.buy_order_id = o.id OR t.sell_order_id = o.id "
                    "GROUP BY o.id, o.filled_qty HAVING o.filled_qty <> COALESCE(SUM(t.quantity),0)"))
    expect("no MARKET order left open",
           psql(ns, "SELECT id FROM orders WHERE order_type = 'MARKET' AND status IN ('NEW','PARTIAL')"))

    print("I5 deadlocks")
    d = int(psql(ns, "SELECT deadlocks FROM pg_stat_database WHERE datname = 'vulntrade'")[0][0])
    expect("no new deadlocks", [] if d == before["deadlocks"] else [("deadlocks", before["deadlocks"], d)])

    print("\n%s" % ("ALL INVARIANTS HOLD" if not failures else "%d FAILED: %s" % (len(failures), failures)))
    return 0 if not failures else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ns", required=True, help="kubernetes namespace (vt-before / vt-after)")
    ap.add_argument("--target", choices=["v0", "v1"], default="v1")
    ap.add_argument("cmd", choices=["snapshot", "check"])
    ap.add_argument("--since", help="snapshot json file (for check)")
    ap.add_argument("--settle", type=float, default=5, help="seconds to wait for in-flight work before checking")
    a = ap.parse_args()
    if a.cmd == "snapshot":
        print(json.dumps(snapshot(a.ns, a.target), indent=2))
        return 0
    if not a.since:
        sys.exit("check needs --since <snapshot.json>")
    time.sleep(a.settle)
    with open(a.since) as f:
        return check(a.ns, a.target, json.load(f))


if __name__ == "__main__":
    sys.exit(main())
