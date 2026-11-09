#!/usr/bin/env python3
"""
VulnTrade 1.0.0 trading-integrity regression suite.

Checks that the trading business logic is correct end to end: fills, partial fills, average
cost, realized P&L, holds and commission, settlement that never goes negative, the house
market maker, order notifications, prices, candles, the leaderboard and the ledger. It does
NOT check the intentional vulnerabilities (test/product_bugs.py does) - it only uses a few
of them as tooling (admin/admin123, the admin SQL endpoint, admin.setPrice).

Usage (the frontend/nginx URL: platform /api, /ws and every product gateway behind it):
    python3 test/trading_integrity.py --base-url http://192.168.67.2:31080

Money in 1.0.0: a stock trader's cash is the EQUITIES account (USD, available + held).
New users start with 10,000 demo USD there. Commission: $0.005/share, min $1 per order.
Exit code 0 when every check passes. Each run creates its own users (prefix ti_<run>), pins
GME while it runs and restores its price afterwards. Lab use only.
(The 0.6.0 version of this suite is in git history, tag 0.6.0.)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
import uuid
from decimal import Decimal as D, ROUND_HALF_UP

try:
    import requests
except ImportError:  # pragma: no cover
    sys.exit("Needs: pip install requests websocket-client")

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "bench"))
from stomp import Stomp  # noqa: E402

EPS = D("0.00000002")
SYMBOL = "GME"
PIN = D("28.50")
SPREAD = D("0.0001")          # liquidity.spread-percent 0.01% as a fraction
COMMISSION_MIN = D("1.00")    # $0.005/share, at least $1 per order


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

class Report:
    def __init__(self):
        self.passed = 0
        self.failed = []

    def check(self, name: str, ok: bool, detail: str = ""):
        tag = "PASS" if ok else "FAIL"
        print(f"  [{tag}] {name}" + (f"  — {detail}" if detail else ""))
        if ok:
            self.passed += 1
        else:
            self.failed.append(name)
        return ok

    def section(self, title: str):
        print(f"\n{title}\n" + "-" * len(title))


R = Report()


def close(a, b, eps=EPS) -> bool:
    return a is not None and b is not None and abs(D(str(a)) - D(str(b))) <= eps


def q8(x: D) -> D:
    return x.quantize(D("0.00000001"), rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------------------
# Lab helpers
# ---------------------------------------------------------------------------

class Lab:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        ws = self.base.replace("https://", "wss://").replace("http://", "ws://")
        self.platform_ws = ws + "/ws"
        self.equities_ws = ws + "/api/equities/ws"
        self.run = uuid.uuid4().hex[:6]
        self.created: list[int] = []
        self.http = requests.Session()
        self.admin = self.login("admin", "admin123")
        self.admin_stomp = Stomp(self.platform_ws, self.admin["token"])
        self.admin_stomp.subscribe("/user/queue/admin")
        self.admin_stomp.subscribe("/user/queue/errors")
        self.prices_stomp = Stomp(self.equities_ws, self.admin["token"])
        self.prices_stomp.subscribe("/topic/equities/prices")

    def _json(self, r):
        return json.loads(r.text, parse_float=D) if r.text else None

    def login(self, username, password):
        r = self.http.post(f"{self.base}/api/auth/login", json={"username": username, "password": password})
        r.raise_for_status()
        return self._json(r)

    def register(self, tag: str) -> dict:
        name = f"ti_{self.run}_{tag}"
        r = self.http.post(f"{self.base}/api/auth/register",
                           json={"username": name, "password": "Passw0rd!", "email": f"{name}@example.test"})
        r.raise_for_status()
        info = self._json(r)
        self.created.append(int(info["userId"]))
        return info

    def get(self, path, token=None, headers=None):
        h = dict(headers or {})
        if token:
            h["Authorization"] = f"Bearer {token}"
        r = self.http.get(f"{self.base}{path}", headers=h)
        return r.status_code, self._json(r)

    def sql(self, query: str) -> list[list]:
        """Rows as lists (the endpoint returns bare values for single-column queries)."""
        r = self.http.post(f"{self.base}/api/admin/execute-query", json={"sql": query},
                           headers={"Authorization": f"Bearer {self.admin['token']}"})
        r.raise_for_status()
        return [row if isinstance(row, list) else [row] for row in self._json(r)["results"]]

    def scalar(self, query: str):
        rows = self.sql(query)
        return rows[0][0] if rows and rows[0] else None

    def balance(self, uid) -> D:
        """EQUITIES account cash: available + held (held = locked for open orders)."""
        v = self.scalar("SELECT COALESCE(SUM(b.available + b.held), 0) FROM balances b JOIN accounts a ON a.id = b.account_id "
                        f"WHERE a.user_id = {int(uid)} AND a.product = 'EQUITIES' AND b.asset = 'USD'")
        return D(str(v))

    def held(self, uid) -> D:
        v = self.scalar("SELECT COALESCE(SUM(b.held), 0) FROM balances b JOIN accounts a ON a.id = b.account_id "
                        f"WHERE a.user_id = {int(uid)} AND a.product = 'EQUITIES' AND b.asset = 'USD'")
        return D(str(v))

    def position(self, uid, symbol=SYMBOL):
        rows = self.sql(f"SELECT quantity, avg_price, COALESCE(realized_pnl,0) FROM positions "
                        f"WHERE user_id = {int(uid)} AND symbol = '{symbol}'")
        if not rows:
            return D(0), D(0), D(0)
        return tuple(D(str(v)) for v in rows[0])

    def order(self, oid):
        rows = self.sql(f"SELECT status, filled_qty, filled_price, COALESCE(status_reason,''), hold_left FROM orders WHERE id = {int(oid)}")
        return rows[0] if rows else None

    def adjust(self, uid, amount):
        r = self.http.post(f"{self.base}/api/admin/adjust-balance",
                           json={"userId": int(uid), "amount": str(amount), "reason": "trading-integrity funding"},
                           headers={"Authorization": f"Bearer {self.admin['token']}"})
        r.raise_for_status()
        return self._json(r)

    def fund_equities(self, trader, amount):
        """Admin adds money to MAIN, the trader moves it to the EQUITIES account."""
        self.adjust(trader.id, amount)
        r = self.http.post(f"{self.base}/api/accounts/transfer", json={"from": "MAIN", "to": "EQUITIES", "amount": str(amount)},
                           headers={"Authorization": f"Bearer {trader.token}"})
        r.raise_for_status()

    def set_price(self, symbol, price, settle=1.6):
        """Pin a price (platform admin.setPrice, forwarded to the owning service), let the market maker re-quote."""
        self.admin_stomp.send("/app/admin.setPrice", {"symbol": symbol, "price": str(price)})
        reply = self.admin_stomp.wait(lambda d, b: isinstance(b, dict) and (
            (b.get("type") == "PRICE_SET" and b.get("symbol") == symbol) or b.get("type") == "ERROR"), 6)
        if settle:
            time.sleep(settle)
        return reply

    def price(self, symbol):
        product = "crypto" if symbol.endswith("-USD") else "equities"
        _, s = self.get(f"/api/{product}/market/prices/{symbol}")
        if s is None and product == "crypto":
            _, s = self.get(f"/api/market/prices/{symbol}")   # before crypto-internals existed
        return s

    def cancel_open(self, where: str):
        """Cancel (through the API) every open equities order matching a SQL condition on orders o / users u."""
        rows = self.sql("SELECT o.id FROM orders o JOIN users u ON u.id = o.user_id "
                        f"WHERE o.status IN ('NEW','PARTIAL') AND o.product = 'EQUITIES' AND ({where})")
        for (oid,) in rows:
            self.http.post(f"{self.base}/api/equities/orders/{oid}/cancel",
                           headers={"Authorization": f"Bearer {self.admin['token']}"})
        return len(rows)

    def cleanup(self, *traders):
        ids = [t.id for t in traders] if traders else self.created
        if ids:
            self.cancel_open("o.user_id IN (" + ",".join(str(int(i)) for i in ids) + ")")


class Trader:
    """One trader on the equities WebSocket (orders in, replies and order updates out)."""

    def __init__(self, lab: Lab, info: dict):
        self.lab = lab
        self.id = int(info["userId"])
        self.name = info["username"]
        self.token = info["token"]
        self.api_key = info.get("apiKey")
        self.stomp = Stomp(lab.equities_ws, self.token)
        for q in ("/user/queue/orders", "/user/queue/errors", "/user/queue/order-updates"):
            self.stomp.subscribe(q)
        time.sleep(0.2)

    def place(self, side, qty, price=None, order_type="LIMIT", symbol=SYMBOL, **extra):
        body = {"symbol": symbol, "side": side, "quantity": str(qty), "type": order_type, **extra}
        if price is not None:
            body["price"] = str(price)
        self.stomp.send("/app/order.place", body)
        return self.stomp.wait(lambda d, b: d == "/user/queue/orders" and isinstance(b, dict)
                               and b.get("type") in ("ORDER_PLACED", "ERROR"), 8)

    def market(self, side, qty, symbol=SYMBOL):
        """A MARKET order from the trading screen (WebSocket): priced at the live bid/ask."""
        return self.place(side, qty, order_type="MARKET", symbol=symbol)

    def cancel(self, oid):
        self.stomp.send("/app/order.cancel", {"orderId": int(oid)})
        return self.stomp.wait(lambda d, b: d == "/user/queue/orders" and isinstance(b, dict)
                               and b.get("type") in ("ORDER_CANCELLED", "ERROR"), 8)

    def update(self, oid, status, timeout=6.0):
        return self.stomp.wait(lambda d, b: d == "/user/queue/order-updates" and isinstance(b, dict)
                               and b.get("orderId") == oid and b.get("status") == status, timeout)

    def close(self):
        self.stomp.close()


def error_text(r) -> str:
    return str((r or {}).get("error") or (r or {}).get("message") or "")


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------

def house_buy_price(lab: Lab) -> D:
    """What a MARKET BUY pays the house at the pinned GME quote (ask + spread)."""
    p = lab.price(SYMBOL)
    return q8(D(str(p["ask"])) * (1 + SPREAD))


def s1_partial_fills(lab: Lab):
    R.section("1. Partial fills, VWAP, average cost, realized P&L, commission, order updates")
    s, b = Trader(lab, lab.register("s1s")), Trader(lab, lab.register("s1b"))
    try:
        m = s.market("BUY", 10)
        fp = D(str(m.get("avgFillPrice") or 0)) if m else D(0)
        R.check("market BUY 10 fills against the house at ask + spread",
                bool(m) and m.get("status") == "FILLED" and close(fp, house_buy_price(lab)), f"reply={m}")

        sell = s.place("SELL", 6, PIN)
        sid = sell and sell.get("orderId")
        R.check("SELL 6 @ 28.50 rests (inside the spread)", bool(sell) and sell.get("status") == "NEW", f"{sell}")

        b1 = b.place("BUY", 4, PIN)
        R.check("BUY 4 @ 28.50 fills fully", bool(b1) and b1.get("status") == "FILLED"
                and close(b1.get("filledQty"), 4) and close(b1.get("avgFillPrice"), PIN), f"{b1}")
        up = s.update(sid, "PARTIAL")
        R.check("maker gets ORDER_UPDATE PARTIAL on /user/queue/order-updates",
                bool(up) and close(up.get("filledQty"), 4) and close(up.get("remainingQty"), 2), f"{up}")

        b2 = b.place("BUY", 5, D("28.51"))
        R.check("BUY 5 @ 28.51 fills 2 and rests 3 (PARTIAL)", bool(b2) and b2.get("status") == "PARTIAL"
                and close(b2.get("filledQty"), 2) and close(b2.get("remainingQty"), 3), f"{b2}")
        up = s.update(sid, "FILLED")
        R.check("maker gets ORDER_UPDATE FILLED", bool(up) and close(up.get("filledQty"), 6), f"{up}")

        _, book = lab.get(f"/api/equities/market/orderbook/{SYMBOL}")
        mine = [x for x in book["bids"] if x["orderId"] == b2.get("orderId")] if b2 else []
        R.check("order book shows the REMAINING quantity (3)", bool(mine) and close(mine[0]["quantity"], 3), f"{mine}")

        R.check("buyer cash = 10000 - 6 x 28.50 - 2 x $1 commission", close(lab.balance(b.id), D("9827.00")),
                f"{lab.balance(b.id)}")
        # 5 x 28.51 + $1 was held; 2 filled at 28.50 for 57 + $1 commission -> 85.55 still held
        R.check("buyer still holds money for the 3 resting shares", close(lab.held(b.id), D("85.55")),
                f"held={lab.held(b.id)}")
        bq, bavg, _ = lab.position(b.id)
        R.check("buyer position 6 @ 28.50", close(bq, 6) and close(bavg, PIN), f"{bq} @ {bavg}")
        want_cash = D("10000") - q8(10 * fp) - COMMISSION_MIN + D("171.00") - COMMISSION_MIN
        R.check("seller cash exact to the 8th decimal (two $1 commissions)", close(lab.balance(s.id), want_cash),
                f"{lab.balance(s.id)} vs {want_cash}")
        sq, savg, sreal = lab.position(s.id)
        R.check("seller keeps 4 at the original average cost", close(sq, 4) and close(savg, fp), f"{sq} @ {savg}")
        R.check("seller realized P&L = 6 x (28.50 - avg cost)", close(sreal, 6 * (PIN - fp), D("0.0000001")),
                f"{sreal} vs {6 * (PIN - fp)}")
        if b2 and b2.get("orderId"):
            c = b.cancel(b2["orderId"])
            R.check("cancel the PARTIAL remainder", bool(c) and c.get("type") == "ORDER_CANCELLED", f"{c}")
            R.check("cancel gives the rest of the hold back (held 0, cash unchanged)",
                    close(lab.held(b.id), 0) and close(lab.balance(b.id), D("9827.00")),
                    f"held={lab.held(b.id)} cash={lab.balance(b.id)}")
    finally:
        lab.cleanup(s, b)
        s.close(), b.close()


def s2_settlement_funds(lab: Lab):
    R.section("2. Holds: money for an open BUY is locked, a second BUY can't use it")
    c, d = Trader(lab, lab.register("s2c")), Trader(lab, lab.register("s2d"))
    try:
        o1 = c.place("BUY", 300, PIN)
        R.check("BUY 300 @ 28.50 accepted and rests", bool(o1) and o1.get("status") == "NEW", f"{o1}")
        R.check("it holds 300 x 28.50 + $1.50 commission", close(lab.held(c.id), D("8551.50")), f"held={lab.held(c.id)}")
        o2 = c.place("BUY", 300, PIN)
        R.check("a second BUY 300 is refused at placement (the money is held)",
                bool(o2) and o2.get("type") == "ERROR" and "Insufficient" in error_text(o2), f"{o2}")
        lab.fund_equities(d, 20000)
        m = d.market("BUY", 600)
        R.check("seller buys 600 to sell", bool(m) and m.get("status") == "FILLED", f"{m}")
        sell = d.place("SELL", 600, PIN)
        R.check("SELL 600 fills the 300 bid and rests the rest (PARTIAL)", bool(sell) and sell.get("status") == "PARTIAL"
                and close(sell.get("filledQty"), 300), f"{sell}")
        R.check("buyer cash = 10000 - 300 x 28.50 - $1.50, nothing held any more",
                close(lab.balance(c.id), D("1448.50")) and close(lab.held(c.id), 0),
                f"cash={lab.balance(c.id)} held={lab.held(c.id)}")
        if sell and sell.get("orderId"):
            d.cancel(sell["orderId"])
    finally:
        lab.cleanup(c, d)
        c.close(), d.close()


def s3_settlement_position(lab: Lab):
    R.section("3. Settlement at fill: the same shares offered twice")
    e, f = Trader(lab, lab.register("s3e")), Trader(lab, lab.register("s3f"))
    try:
        e.market("BUY", 10)
        o1 = e.place("SELL", 10, PIN)
        o2 = e.place("SELL", 10, PIN)
        R.check("two SELL 10 @ 28.50 against a 10-share position both accepted",
                bool(o1) and bool(o2) and o1.get("status") == "NEW" and o2.get("status") == "NEW", f"{o1} / {o2}")
        buy = f.place("BUY", 20, PIN)
        R.check("BUY 20 fills 10 (PARTIAL)", bool(buy) and buy.get("status") == "PARTIAL"
                and close(buy.get("filledQty"), 10), f"{buy}")
        up = e.update(o2.get("orderId"), "CANCELLED") if o2 else None
        R.check("second SELL auto-cancelled with INSUFFICIENT_POSITION", bool(up) and up.get("reason") == "INSUFFICIENT_POSITION", f"{up}")
        q, _, _ = lab.position(e.id)
        R.check("seller position 0, never negative", close(q, 0), f"{q}")
        R.check("buyer received exactly 10 (no shares minted)", close(lab.position(f.id)[0], 10), f"{lab.position(f.id)[0]}")
        if buy and buy.get("orderId"):
            f.cancel(buy["orderId"])
    finally:
        lab.cleanup(e, f)
        e.close(), f.close()


def s4_sweep_and_leaderboard(lab: Lab):
    R.section("4. House sweep of crossed limits + leaderboard stats")
    g = Trader(lab, lab.register("s4g"))
    try:
        buy = g.place("BUY", 100, D("28.40"))
        R.check("BUY 100 @ 28.40 rests", bool(buy) and buy.get("status") == "NEW", f"{buy}")
        lab.set_price(SYMBOL, D("28.05"))
        up = g.update(buy.get("orderId"), "FILLED", timeout=5) if buy else None
        R.check("price drops below the bid -> house fills it at 28.40 within seconds",
                bool(up) and close(up.get("avgFillPrice"), D("28.40")), f"{up}")
        R.check("cash 10000 - 2840 - $1 = 7159.00", close(lab.balance(g.id), D("7159.00")), f"{lab.balance(g.id)}")

        sell = g.place("SELL", 100, D("29.40"))
        lab.set_price(SYMBOL, D("30.00"))
        up = g.update(sell.get("orderId"), "FILLED", timeout=5) if sell else None
        R.check("price rises above the ask -> house fills the SELL at 29.40", bool(up), f"{up}")
        q, avg, real = lab.position(g.id)
        R.check("round trip: cash 10098.00 (+100 - 2 x $1), flat, realized +100.00",
                close(lab.balance(g.id), D("10098.00")) and close(q, 0) and close(real, D("100.00")),
                f"cash={lab.balance(g.id)} qty={q} realized={real}")

        _, stats = lab.get(f"/api/leaderboard?userId={g.id}", token=g.token)
        # capital = 10,000 signup (MAIN) + 3 x 10,000 demo funds; P&L = +100 - 2 x $1 commission
        R.check("leaderboard: capital 40000, P&L +98, ROI 0.25%, win rate 100%, 2 trades, real rank",
                bool(stats) and close(stats.get("capital"), 40000) and close(stats.get("pnl"), 98)
                and close(stats.get("roi"), D("0.25"), D("0.001")) and close(stats.get("winRate"), 100)
                and stats.get("tradeCount") == 2 and (stats.get("rank") or 0) > 0,
                f"{stats and {k: stats.get(k) for k in ('capital', 'pnl', 'roi', 'winRate', 'tradeCount', 'rank')}}")
        _, board = lab.get("/api/leaderboard", headers={"X-API-Key": g.api_key})
        R.check("API-key caller gets their own myRank", bool(board) and board.get("myRank") == stats.get("rank"),
                f"myRank={board and board.get('myRank')} rank={stats and stats.get('rank')}")
        lab.adjust(g.id, 1000)
        _, after = lab.get(f"/api/leaderboard?userId={g.id}", token=g.token)
        R.check("a deposit/adjustment is capital, not profit (ROI does not rise)",
                bool(after) and D(str(after.get("roi"))) <= D(str(stats.get("roi"))), f"{after and after.get('roi')}")
    finally:
        lab.cleanup(g)
        lab.set_price(SYMBOL, PIN)
        g.close()


def s5_wash_trade(lab: Lab):
    R.section("5. Wash trade (intentional, #62 / EQ-6): recorded, but cash and shares net to zero")
    u = Trader(lab, lab.register("s5u"))
    try:
        u.market("BUY", 2)
        cash0, (q0, _, _) = lab.balance(u.id), lab.position(u.id)
        s = u.place("SELL", 1, PIN)
        b = u.place("BUY", 1, PIN)
        R.check("own BUY crosses own SELL (no self-trade guard)", bool(b) and b.get("status") == "FILLED", f"{b}")
        n = lab.scalar(f"SELECT COUNT(*) FROM trades WHERE buy_order_id = {int(b['orderId'])} AND sell_order_id = {int(s['orderId'])}") if b and s else 0
        R.check("one trade row recorded", int(n or 0) == 1, f"{n}")
        R.check("cash and position unchanged, nothing left held", close(lab.balance(u.id), cash0)
                and close(lab.position(u.id)[0], q0) and close(lab.held(u.id), 0),
                f"cash {cash0}->{lab.balance(u.id)} qty {q0}->{lab.position(u.id)[0]} held {lab.held(u.id)}")
    finally:
        lab.cleanup(u)
        u.close()


def s6_concurrency(lab: Lab):
    R.section("6. Concurrency: 20 takers race for a 10-lot")
    maker = Trader(lab, lab.register("s6m"))
    takers = [Trader(lab, lab.register(f"s6t{i}")) for i in range(20)]
    try:
        maker.market("BUY", 10)
        sell = maker.place("SELL", 10, PIN)
        results: list = [None] * len(takers)

        def go(i, t):
            results[i] = t.place("BUY", 1, PIN)

        threads = [threading.Thread(target=go, args=(i, t)) for i, t in enumerate(takers)]
        [th.start() for th in threads]
        [th.join() for th in threads]
        filled = sum(1 for r in results if r and r.get("status") == "FILLED")
        resting = [r for r in results if r and r.get("status") == "NEW"]
        R.check("exactly 10 fills, 10 resting", filled == 10 and len(resting) == 10, f"filled={filled} resting={len(resting)}")
        R.check("maker position 0 and order FILLED",
                close(lab.position(maker.id)[0], 0) and lab.order(sell["orderId"])[0] == "FILLED", f"{lab.order(sell['orderId'])}")
        for i, r in enumerate(results):
            if r and r.get("status") == "NEW":
                takers[i].cancel(r["orderId"])

        # IDOR cancel (#44, intentional) racing a fill: exactly one of them wins.
        bad = 0
        for _ in range(5):
            s = maker.place("SELL", 1, PIN) if lab.position(maker.id)[0] >= 1 else None
            if not s or s.get("type") == "ERROR":
                maker.market("BUY", 1)
                s = maker.place("SELL", 1, PIN)
            out = {}

            def cancel():
                r = lab.http.post(f"{lab.base}/api/equities/orders/{s['orderId']}/cancel",
                                  headers={"Authorization": f"Bearer {takers[0].token}"})
                out["cancel"] = r.status_code

            def take():
                out["take"] = takers[1].place("BUY", 1, PIN)

            t1, t2 = threading.Thread(target=cancel), threading.Thread(target=take)
            t1.start(), t2.start(), t1.join(), t2.join()
            took = out["take"] and out["take"].get("status") == "FILLED"
            if (out["cancel"] == 200 and took) or (out["cancel"] != 200 and not took):
                bad += 1
            if out["take"] and out["take"].get("status") == "NEW":
                takers[1].cancel(out["take"]["orderId"])
        R.check("cancel vs fill: never both, never neither (5 rounds)", bad == 0, f"bad rounds={bad}")
    finally:
        lab.cleanup(maker, *takers)
        maker.close()
        for t in takers:
            t.close()


def s7_validation(lab: Lab):
    R.section("7. Order validation")
    v = Trader(lab, lab.register("s7v"))
    try:
        for label, kwargs, needle in (
                ("side HOLD", dict(side="HOLD", qty=1, price=PIN), "Invalid side"),
                ("type STOP", dict(side="BUY", qty=1, price=PIN, order_type="STOP"), "Invalid order type"),
                ("9-decimal quantity", dict(side="BUY", qty="0.000000001", price=PIN), "decimal places")):
            r = v.place(**kwargs)
            R.check(f"{label} rejected", bool(r) and r.get("type") == "ERROR" and needle in error_text(r), f"{r}")
    finally:
        v.close()


def s8_prices_and_candles(lab: Lab):
    R.section("8. Prices, candles, timestamps")
    lab.prices_stomp.buffer.clear()
    lab.set_price(SYMBOL, D("28.55"))
    upd = lab.prices_stomp.wait(lambda d, b: d == "/topic/equities/prices" and isinstance(b, dict)
                                and b.get("symbol") == SYMBOL and close(b.get("last"), D("28.55")), 4)
    R.check("setPrice is broadcast on /topic/equities/prices (internal fields still there)",
            bool(upd) and upd.get("marketMakerId") is not None, f"{upd and {k: upd.get(k) for k in ('last', 'marketMakerId')}}")
    err = lab.set_price(SYMBOL, 0)
    R.check("price 0 rejected", bool(err) and err.get("type") == "ERROR", f"{err}")
    lab.set_price(SYMBOL, PIN)

    pepe = lab.price("PEPE-USD")
    R.check("PEPE keeps sub-cent precision", D(str(pepe["currentPrice"])) < D("0.001"), f"{pepe['currentPrice']}")
    doge1 = D(str(lab.price("DOGE-USD")["currentPrice"]))
    time.sleep(4)
    doge2 = D(str(lab.price("DOGE-USD")["currentPrice"]))
    R.check("DOGE moves (not stuck at 2 decimals)", doge1 != doge2, f"{doge1} -> {doge2}")

    _, c = lab.get("/api/equities/market/candles?symbol=AAPL&interval=1m&limit=60")
    bars = c["candles"] if c else []
    times = [b["time"] for b in bars]
    ok_time = all(t % 60 == 0 for t in times) and all(b > a for a, b in zip(times, times[1:]))
    ok_ohlc = all(D(str(b["high"])) >= max(D(str(b["open"])), D(str(b["close"])))
                  and D(str(b["low"])) <= min(D(str(b["open"])), D(str(b["close"]))) for b in bars)
    live = D(str(lab.price("AAPL")["currentPrice"]))
    last_close = D(str(bars[-1]["close"])) if bars else D(0)
    R.check("1m candles: minute-aligned, increasing, OHLC-consistent", len(bars) >= 30 and ok_time and ok_ohlc, f"{len(bars)} bars")
    R.check("last candle close tracks the live price", abs(last_close - live) / live < D("0.01"), f"{last_close} vs {live}")
    _, c5 = lab.get("/api/equities/market/candles?symbol=AAPL&interval=5m&limit=10")
    R.check("5m candles aligned to 300s", bool(c5) and all(b["time"] % 300 == 0 for b in c5["candles"]))
    code, _ = lab.get("/api/equities/market/candles?symbol=AAPL&interval=7m")
    R.check("bad interval -> 400", code == 400, f"{code}")

    t = lab.register("s8t")
    _, txns = lab.get("/api/accounts/transactions", token=t["token"])
    stamp = (txns or [{}])[0].get("createdAt", "")
    R.check("API timestamps are UTC with a Z suffix", str(stamp).endswith("Z"), f"{stamp}")


def s9_admin_adjust_ledger(lab: Lab):
    R.section("9. Ledger completeness")
    a = lab.register("s9a")
    lab.adjust(a["userId"], 5)
    n = lab.scalar(f"SELECT COUNT(*) FROM transactions WHERE user_id = {int(a['userId'])} AND type = 'ADJUSTMENT'")
    R.check("REST adjust-balance writes an ADJUSTMENT ledger row", int(n or 0) == 1, f"{n}")
    n = lab.scalar(f"SELECT COUNT(*) FROM transactions WHERE user_id = {int(a['userId'])} AND type = 'DEPOSIT' "
                   "AND account_id IS NOT NULL")
    R.check("each new product account has its demo DEPOSIT row (3)", int(n or 0) == 3, f"{n}")


def s10_flag11(lab: Lab):
    R.section("10. FLAG 11 chain still works (deposit -> transfer -> buy VULN -> pump -> rank #1)")
    info = lab.register("s10x")
    r = lab.http.put(f"{lab.base}/api/users/{info['userId']}/profile", json={"firstName": "Pump"},
                     headers={"Authorization": f"Bearer {info['token']}"})
    token = lab._json(r).get("token") or info["token"]
    lab.http.post(f"{lab.base}/api/accounts/deposit", json={"amount": 1000000, "sourceAccount": "fake"},
                  headers={"Authorization": f"Bearer {token}"})
    lab.http.post(f"{lab.base}/api/accounts/transfer", json={"from": "MAIN", "to": "EQUITIES", "amount": "1000000"},
                  headers={"Authorization": f"Bearer {token}"})
    info["token"] = token
    x = Trader(lab, info)
    try:
        vuln = lab.price("VULN")
        qty = int(D("950000") / (D(str(vuln["ask"])) * D("1.001")))
        m = x.market("BUY", qty, symbol="VULN")
        R.check(f"bought {qty} VULN", bool(m) and m.get("status") == "FILLED", f"{m and m.get('status')}")
        lab.set_price("VULN", 99999)
        _, board = lab.get("/api/leaderboard", token=token)
        rows = (board or {}).get("leaderboard", [])
        seeded_top = next((r for r in rows if r.get("username") == "0xj4f"), None)
        me = (board or {}).get("me") or {}
        beats = seeded_top is None or D(str(me.get("roi", 0))) > D(str(seeded_top.get("roi")))
        R.check("pumped account overtakes the seeded #1 (0xj4f)", bool(me) and beats,
                f"me={me.get('roi')} 0xj4f={seeded_top and seeded_top.get('roi')} myRank={board and board.get('myRank')}")
        R.check("rank #1 returns the flag", board.get("myRank") != 1 or bool(board.get("flag")),
                f"myRank={board.get('myRank')} (other pumpers from earlier runs can outrank this one)")
    finally:
        lab.cleanup(x)
        lab.set_price("VULN", 100)
        x.close()


# ---------------------------------------------------------------------------
# Crypto: our own exchange (client to client, maker/taker fees, USD and coins as money)
# ---------------------------------------------------------------------------

MAKER, TAKER = D("0.0010"), D("0.0020")


def fee(value: D, rate: D) -> D:
    return (value * rate).quantize(D("0.01"), rounding="ROUND_DOWN")


def crypto_balance(lab: Lab, uid, asset):
    v = lab.scalar("SELECT COALESCE(SUM(b.available), 0) || ',' || COALESCE(SUM(b.held), 0) FROM balances b "
                   f"JOIN accounts a ON a.id = b.account_id WHERE a.user_id = {int(uid)} AND a.product = 'CRYPTO' "
                   f"AND b.asset = '{asset}'")
    avail, held = str(v).split(",")
    return D(avail), D(held)


def crypto_order(lab: Lab, user: dict, **body):
    r = lab.http.post(f"{lab.base}/api/crypto/orders", json={k: str(v) for k, v in body.items()},
                      headers={"Authorization": f"Bearer {user['token']}"})
    return lab._json(r) or {}


def c1_client_to_client(lab: Lab):
    R.section("C1. Crypto: client to client trade, maker 0.10% / taker 0.20%")
    a, b = lab.register("c1a"), lab.register("c1b")
    m = crypto_order(lab, a, symbol="ETH-USD", side="BUY", type="MARKET", quantity="1")
    value = q8(D(str(m.get("filledQty", 0))) * D(str(m.get("avgFillPrice") or 0)))
    usd, _ = crypto_balance(lab, a["userId"], "USD")
    eth, _ = crypto_balance(lab, a["userId"], "ETH")
    R.check("MARKET BUY 1 ETH from the bot: taker fee 0.20%, coins received",
            m.get("status") == "FILLED" and close(eth, 1) and close(usd, D(10000) - value - fee(value, TAKER)),
            f"status={m.get('status')} eth={eth} usd={usd} value={value}")

    lab.set_price("ETH-USD", D("3450.00"), settle=2.5)   # pin it, so the bot's ladder stays put
    px = lab.price("ETH-USD")
    mid = ((D(str(px["bid"])) + D(str(px["ask"]))) / 2).quantize(D("0.01"))
    s = crypto_order(lab, a, symbol="ETH-USD", side="SELL", type="LIMIT", quantity="0.5", price=mid)
    eth_avail, eth_held = crypto_balance(lab, a["userId"], "ETH")
    R.check("SELL 0.5 ETH rests and holds 0.5 ETH", s.get("status") == "NEW" and close(eth_held, D("0.5"))
            and close(eth_avail, D("0.5")), f"{s.get('status')} avail={eth_avail} held={eth_held}")

    usd_a0, _ = crypto_balance(lab, a["userId"], "USD")
    house0 = D(str(lab.scalar("SELECT b.available FROM balances b JOIN accounts a ON a.id = b.account_id "
                              "WHERE a.user_id = 1 AND a.product = 'CRYPTO' AND b.asset = 'USD'")))
    t = crypto_order(lab, b, symbol="ETH-USD", side="BUY", type="LIMIT", quantity="0.5", price=mid)
    v = q8(D("0.5") * mid)
    R.check("BUY 0.5 ETH matches the resting SELL at the maker's price", t.get("status") == "FILLED"
            and close(t.get("avgFillPrice"), mid), f"{t}")
    usd_b, held_b = crypto_balance(lab, b["userId"], "USD")
    eth_b, _ = crypto_balance(lab, b["userId"], "ETH")
    R.check("buyer (taker): -value -0.20% fee, +0.5 ETH, nothing left held",
            close(usd_b, D(10000) - v - fee(v, TAKER)) and close(eth_b, D("0.5")) and close(held_b, 0),
            f"usd={usd_b} eth={eth_b} held={held_b}")
    usd_a, _ = crypto_balance(lab, a["userId"], "USD")
    eth_avail, eth_held = crypto_balance(lab, a["userId"], "ETH")
    R.check("seller (maker): +value -0.10% fee, coins left its hold",
            close(usd_a, usd_a0 + v - fee(v, MAKER)) and close(eth_held, 0) and close(eth_avail, D("0.5")),
            f"usd={usd_a} eth={eth_avail}/{eth_held}")
    house1 = D(str(lab.scalar("SELECT b.available FROM balances b JOIN accounts a ON a.id = b.account_id "
                              "WHERE a.user_id = 1 AND a.product = 'CRYPTO' AND b.asset = 'USD'")))
    R.check("the house earned both fees", house1 - house0 >= fee(v, TAKER) + fee(v, MAKER) - EPS,
            f"house +{house1 - house0}, fees {fee(v, TAKER) + fee(v, MAKER)}")


def c2_hold_and_cancel(lab: Lab):
    R.section("C2. Crypto: a resting BUY holds USD (value + taker fee), cancel gives it back")
    c = lab.register("c2c")
    px = lab.price("BTC-USD")
    price = (D(str(px["bid"])) * D("0.5")).quantize(D("0.01"))
    o = crypto_order(lab, c, symbol="BTC-USD", side="BUY", type="LIMIT", quantity="0.01", price=price)
    value = D("0.01") * price
    avail, held = crypto_balance(lab, c["userId"], "USD")
    R.check("BUY 0.01 BTC far below the market rests", o.get("status") == "NEW", f"{o}")
    R.check("it holds value + taker fee", close(held, value + fee(value, TAKER)) and close(avail + held, D(10000)),
            f"held={held} avail={avail}")
    r = lab.http.post(f"{lab.base}/api/crypto/orders/{o.get('orderId')}/cancel",
                      headers={"Authorization": f"Bearer {c['token']}"})
    avail, held = crypto_balance(lab, c["userId"], "USD")
    R.check("cancel gives the whole hold back", r.status_code == 200 and close(held, 0) and close(avail, D(10000)),
            f"{r.status_code} held={held} avail={avail}")


def c3_market_without_money(lab: Lab):
    R.section("C3. Crypto: a MARKET BUY it can't pay for stops, never negative")
    d = lab.register("c3d")
    o = crypto_order(lab, d, symbol="BTC-USD", side="BUY", type="MARKET", quantity="5")
    avail, held = crypto_balance(lab, d["userId"], "USD")
    R.check("5 BTC with 10,000 USD: cancelled INSUFFICIENT_FUNDS, USD untouched",
            o.get("status") == "CANCELLED" and o.get("reason") == "INSUFFICIENT_FUNDS" and close(avail, D(10000))
            and close(held, 0), f"{o.get('status')}/{o.get('reason')} usd={avail}")


def invariants(lab: Lab):
    R.section("Database invariants")
    ids = ",".join(str(i) for i in lab.created) or "0"
    R.check("no negative MAIN balance anywhere", int(lab.scalar("SELECT COUNT(*) FROM users WHERE balance < 0")) == 0)
    R.check("no negative product balance (this run)", int(lab.scalar(
        "SELECT COUNT(*) FROM balances b JOIN accounts a ON a.id = b.account_id "
        f"WHERE a.user_id IN ({ids}) AND (b.available < 0 OR b.held < 0)")) == 0)
    R.check("no negative position anywhere", int(lab.scalar("SELECT COUNT(*) FROM positions WHERE quantity < 0")) == 0)
    R.check("no order over-filled", int(lab.scalar("SELECT COUNT(*) FROM orders WHERE filled_qty > quantity")) == 0)
    R.check("no MARKET order left resting",
            int(lab.scalar("SELECT COUNT(*) FROM orders WHERE order_type = 'MARKET' AND status IN ('NEW','PARTIAL')")) == 0)
    R.check("closed orders hold nothing (this run)", int(lab.scalar(
        f"SELECT COUNT(*) FROM orders WHERE user_id IN ({ids}) AND status NOT IN ('NEW','PARTIAL') AND hold_left <> 0")) == 0)
    bad = lab.sql("SELECT o.id FROM orders o LEFT JOIN trades t ON t.buy_order_id = o.id OR t.sell_order_id = o.id "
                  f"WHERE o.user_id IN ({ids}) GROUP BY o.id, o.filled_qty "
                  "HAVING ABS(COALESCE(o.filled_qty,0) - COALESCE(SUM(t.quantity),0)) > 0.00000001")
    R.check("filled_qty equals the sum of the order's trades (this run)", not bad, f"{bad[:5]}")
    bad = lab.sql("SELECT u.id FROM users u JOIN transactions x ON x.user_id = u.id AND x.account_id IS NULL "
                  f"WHERE u.id IN ({ids}) GROUP BY u.id, u.balance HAVING ABS(u.balance - SUM(x.amount)) > 0.00000001")
    R.check("MAIN cash equals the sum of its ledger rows (this run)", not bad, f"{bad[:5]}")
    bad = lab.sql("SELECT a.id FROM accounts a JOIN balances b ON b.account_id = a.id AND b.asset = 'USD' "
                  f"WHERE a.user_id IN ({ids}) AND a.product <> 'FX' AND ABS(b.available + b.held - "
                  "(SELECT COALESCE(SUM(x.amount),0) FROM transactions x WHERE x.account_id = a.id AND x.asset = 'USD')) > 0.00000001")
    R.check("product account USD equals the sum of its ledger rows (this run)", not bad, f"{bad[:5]}")
    crossed = lab.sql("SELECT symbol FROM (SELECT symbol, MAX(price) FILTER (WHERE side='BUY') bb, "
                      "MIN(price) FILTER (WHERE side='SELL') ba FROM orders WHERE status IN ('NEW','PARTIAL') "
                      "AND order_type='LIMIT' GROUP BY symbol) x WHERE bb >= ba")
    R.check("no symbol has a crossed book (best bid < best ask)", not crossed, f"{crossed}")


# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", required=True, help="frontend (nginx) URL, e.g. http://192.168.67.2:31080")
    ap.add_argument("--skip-flag", action="store_true", help="skip the FLAG 11 pump (it leaves VULN overridden)")
    args = ap.parse_args()

    lab = Lab(args.base_url)
    original = D(str(lab.price(SYMBOL)["currentPrice"]))
    print(f"VulnTrade 1.0.0 trading-integrity suite — run {lab.run} against {args.base_url}")
    try:
        stale = lab.cancel_open("u.username LIKE 'ti\\_%'")
        if stale:
            print(f"(cancelled {stale} open orders left by earlier runs)")
        lab.set_price(SYMBOL, PIN, settle=2.5)   # let the market maker re-quote around the pin
        for scenario in (s1_partial_fills, s2_settlement_funds, s3_settlement_position, s4_sweep_and_leaderboard,
                         s5_wash_trade, s6_concurrency, s7_validation, s8_prices_and_candles, s9_admin_adjust_ledger):
            try:
                scenario(lab)
            except Exception as e:  # keep going; report the crash as a failure
                R.check(f"{scenario.__name__} ran to completion", False, repr(e))
        for scenario in (c1_client_to_client, c2_hold_and_cancel, c3_market_without_money):
            try:
                scenario(lab)
            except Exception as e:
                R.check(f"{scenario.__name__} ran to completion", False, repr(e))
        if not args.skip_flag:
            try:
                s10_flag11(lab)
            except Exception as e:
                R.check("s10_flag11 ran to completion", False, repr(e))
        lab.cleanup()
        time.sleep(1)
        invariants(lab)
    finally:
        try:
            lab.set_price(SYMBOL, original)
        finally:
            lab.admin_stomp.close()
            lab.prices_stomp.close()

    total = R.passed + len(R.failed)
    print(f"\n{R.passed}/{total} checks passed" + (f" — FAILED: {', '.join(R.failed)}" if R.failed else ""))
    sys.exit(1 if R.failed else 0)


if __name__ == "__main__":
    main()
