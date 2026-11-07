#!/usr/bin/env python3
"""
VulnTrade trading-integrity regression suite.

Checks that the trading business logic is correct end to end: fills, partial fills,
average cost, realized P&L, settlement that never goes negative, the house market maker,
order notifications, prices, candles and the leaderboard. It does NOT check the
intentional vulnerabilities (that is the exploit matrix's job) — it only uses a few of
them as test tooling (admin/admin123, the admin SQL endpoint, the unauthenticated
admin.setPrice) to pin prices and read exact database values.

Usage:
    pip install requests websocket-client
    python3 test/trading_integrity.py                       # http://localhost:8085
    python3 test/trading_integrity.py --base-url http://localhost:8095

Exit code 0 when every check passes, 1 otherwise. Each run creates its own users
(prefix ti_<run>), pins GME while it runs and restores its price afterwards.
Run it against a lab instance, never anything that matters.
"""
from __future__ import annotations

import argparse
import json
import queue
import sys
import threading
import time
import uuid
from decimal import Decimal as D, ROUND_HALF_UP

try:
    import requests
    import websocket
except ImportError:  # pragma: no cover
    sys.exit("Needs: pip install requests websocket-client")

NUL = "\x00"
EPS = D("0.00000002")
SYMBOL = "GME"
PIN = D("28.50")
SPREAD = D("0.0001")          # liquidity.spread-percent 0.01% as a fraction


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
# Minimal STOMP 1.2 over WebSocket
# ---------------------------------------------------------------------------

class Stomp:
    def __init__(self, ws_url: str, token: str | None):
        self.ws = websocket.create_connection(ws_url, timeout=10)
        self.inbox: "queue.Queue[dict]" = queue.Queue()
        self.buffer: list[dict] = []
        headers = {"accept-version": "1.2", "heart-beat": "0,0"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self._send_frame("CONNECT", headers)
        frame = self._read_frame()
        if not frame or frame["command"] != "CONNECTED":
            raise ConnectionError(f"STOMP CONNECT failed: {frame}")
        self._subs = 0
        self._alive = True
        threading.Thread(target=self._reader, daemon=True).start()

    def _send_frame(self, command, headers, body=""):
        head = "\n".join([command] + [f"{k}:{v}" for k, v in headers.items()])
        self.ws.send(head + "\n\n" + body + NUL)

    def _read_frame(self):
        raw = self.ws.recv()
        if not raw or raw.strip() == "":
            return None
        raw = raw.rstrip(NUL)
        head, _, body = raw.partition("\n\n")
        lines = head.split("\n")
        headers = dict(line.split(":", 1) for line in lines[1:] if ":" in line)
        return {"command": lines[0], "headers": headers, "body": body}

    def _reader(self):
        while self._alive:
            try:
                frame = self._read_frame()
            except Exception:
                break
            if frame and frame["command"] == "MESSAGE":
                try:
                    body = json.loads(frame["body"] or "null", parse_float=D)
                except ValueError:
                    body = frame["body"]
                self.inbox.put({"dest": frame["headers"].get("destination"), "body": body})

    def subscribe(self, dest: str):
        self._subs += 1
        self._send_frame("SUBSCRIBE", {"id": f"sub-{self._subs}", "destination": dest, "ack": "auto"})

    def send(self, dest: str, body):
        self._send_frame("SEND", {"destination": dest, "content-type": "application/json"},
                         json.dumps(body, default=str))

    def wait(self, pred, timeout=6.0):
        """Return the first buffered or incoming message matching pred(dest, body)."""
        for m in list(self.buffer):
            if pred(m["dest"], m["body"]):
                self.buffer.remove(m)
                return m["body"]
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                m = self.inbox.get(timeout=max(0.05, deadline - time.time()))
            except queue.Empty:
                break
            if pred(m["dest"], m["body"]):
                return m["body"]
            self.buffer.append(m)
        return None

    def close(self):
        self._alive = False
        try:
            self.ws.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Lab helpers
# ---------------------------------------------------------------------------

class Lab:
    def __init__(self, base: str, ws_url: str):
        self.base = base.rstrip("/")
        self.ws_url = ws_url
        self.run = uuid.uuid4().hex[:6]
        self.created: list[int] = []
        self.http = requests.Session()
        self.admin = self.login("admin", "admin123")
        self.admin_stomp = Stomp(ws_url, self.admin["token"])
        self.admin_stomp.subscribe("/user/queue/admin")
        self.admin_stomp.subscribe("/user/queue/errors")
        self.admin_stomp.subscribe("/topic/prices")

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
        return D(str(self.scalar(f"SELECT balance FROM users WHERE id = {int(uid)}")))

    def position(self, uid, symbol=SYMBOL):
        rows = self.sql(f"SELECT quantity, avg_price, COALESCE(realized_pnl,0) FROM positions "
                        f"WHERE user_id = {int(uid)} AND symbol = '{symbol}'")
        if not rows:
            return D(0), D(0), D(0)
        return tuple(D(str(v)) for v in rows[0])

    def order(self, oid):
        rows = self.sql(f"SELECT status, filled_qty, filled_price, COALESCE(status_reason,'') FROM orders WHERE id = {int(oid)}")
        return rows[0] if rows else None

    def adjust(self, uid, amount):
        r = self.http.post(f"{self.base}/api/admin/adjust-balance",
                           json={"userId": int(uid), "amount": str(amount), "reason": "trading-integrity funding"},
                           headers={"Authorization": f"Bearer {self.admin['token']}"})
        r.raise_for_status()
        return self._json(r)

    def set_price(self, symbol, price, settle=1.6):
        """Pin a price (admin.setPrice), then give the market maker a pass to re-quote."""
        self.admin_stomp.send("/app/admin.setPrice", {"symbol": symbol, "price": str(price)})
        reply = self.admin_stomp.wait(lambda d, b: isinstance(b, dict) and (
            (b.get("type") == "PRICE_SET" and b.get("symbol") == symbol) or b.get("type") == "ERROR"), 6)
        if settle:
            time.sleep(settle)
        return reply

    def price(self, symbol):
        _, s = self.get(f"/api/market/prices/{symbol}")
        return s

    def cancel_open(self, where: str):
        """Cancel (through the API) every open order matching a SQL condition on orders o / users u."""
        rows = self.sql("SELECT o.id FROM orders o JOIN users u ON u.id = o.user_id "
                        f"WHERE o.status IN ('NEW','PARTIAL') AND ({where})")
        for (oid,) in rows:
            self.http.post(f"{self.base}/api/orders/{oid}/cancel",
                           headers={"Authorization": f"Bearer {self.admin['token']}"})
        return len(rows)

    def cleanup(self, *traders):
        ids = [t.id for t in traders] if traders else self.created
        if ids:
            self.cancel_open("o.user_id IN (" + ",".join(str(int(i)) for i in ids) + ")")


class Trader:
    def __init__(self, lab: Lab, info: dict):
        self.lab = lab
        self.id = int(info["userId"])
        self.name = info["username"]
        self.token = info["token"]
        self.api_key = info.get("apiKey")
        self.stomp = Stomp(lab.ws_url, self.token)
        for q in ("/user/queue/orders", "/user/queue/errors", "/user/queue/order-updates"):
            self.stomp.subscribe(q)
        time.sleep(0.2)

    def place(self, side, qty, price=None, order_type="LIMIT", symbol=SYMBOL, **extra):
        body = {"symbol": symbol, "side": side, "quantity": str(qty), "type": order_type, **extra}
        if price is not None:
            body["price"] = str(price)
        self.stomp.send("/app/trade.placeOrder", body)
        return self.stomp.wait(lambda d, b: isinstance(b, dict) and b.get("type") in ("ORDER_PLACED", "ERROR")
                               and d != "/user/queue/order-updates", 8)

    def market(self, side, qty, symbol=SYMBOL):
        self.stomp.send("/app/trade.executeMarket", {"symbol": symbol, "side": side, "quantity": str(qty)})
        return self.stomp.wait(lambda d, b: isinstance(b, dict) and b.get("type") in ("MARKET_ORDER_EXECUTED", "ERROR"), 8)

    def cancel(self, oid):
        self.stomp.send("/app/trade.cancelOrder", {"orderId": int(oid)})
        return self.stomp.wait(lambda d, b: isinstance(b, dict) and b.get("type") in ("ORDER_CANCELLED", "ERROR")
                               and d != "/user/queue/order-updates", 8)

    def update(self, oid, status, timeout=6.0):
        return self.stomp.wait(lambda d, b: d == "/user/queue/order-updates" and isinstance(b, dict)
                               and b.get("orderId") == oid and b.get("status") == status, timeout)

    def close(self):
        self.stomp.close()


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------

def house_buy_price(lab: Lab) -> D:
    """What a MARKET BUY pays the house at the pinned GME quote (ask + spread)."""
    p = lab.price(SYMBOL)
    return q8(D(str(p["ask"])) * (1 + SPREAD))


def s1_partial_fills(lab: Lab):
    R.section("1. Partial fills, VWAP, average cost, realized P&L, order updates")
    s, b = Trader(lab, lab.register("s1s")), Trader(lab, lab.register("s1b"))
    try:
        m = s.market("BUY", 10)
        fp = D(str(m.get("avgFillPrice") or m.get("filledPrice") or 0)) if m else D(0)
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

        _, book = lab.get(f"/api/market/orderbook/{SYMBOL}")
        mine = [x for x in book["bids"] if x["orderId"] == b2.get("orderId")] if b2 else []
        R.check("order book shows the REMAINING quantity (3)", bool(mine) and close(mine[0]["quantity"], 3), f"{mine}")

        R.check("buyer cash = 10000 - 6 x 28.50", close(lab.balance(b.id), D("9829.00")), f"{lab.balance(b.id)}")
        bq, bavg, _ = lab.position(b.id)
        R.check("buyer position 6 @ 28.50", close(bq, 6) and close(bavg, PIN), f"{bq} @ {bavg}")
        want_cash = D("10000") - q8(10 * fp) + D("171.00")
        R.check("seller cash exact to the 8th decimal", close(lab.balance(s.id), want_cash),
                f"{lab.balance(s.id)} vs {want_cash}")
        sq, savg, sreal = lab.position(s.id)
        R.check("seller keeps 4 at the original average cost", close(sq, 4) and close(savg, fp), f"{sq} @ {savg}")
        R.check("seller realized P&L = 6 x (28.50 - avg cost)", close(sreal, 6 * (PIN - fp), D("0.0000001")),
                f"{sreal} vs {6 * (PIN - fp)}")
        if b2 and b2.get("orderId"):
            c = b.cancel(b2["orderId"])
            R.check("cancel the PARTIAL remainder", bool(c) and c.get("type") == "ORDER_CANCELLED", f"{c}")
    finally:
        lab.cleanup(s, b)
        s.close(), b.close()


def s2_settlement_funds(lab: Lab):
    R.section("2. Settlement at fill: resting BUY that can no longer be paid for")
    c, d = Trader(lab, lab.register("s2c")), Trader(lab, lab.register("s2d"))
    try:
        o1 = c.place("BUY", 300, PIN)
        o2 = c.place("BUY", 300, PIN)
        R.check("two BUY 300 @ 28.50 both accepted (orders are not reserved)",
                bool(o1) and bool(o2) and o1.get("status") == "NEW" and o2.get("status") == "NEW", f"{o1} / {o2}")
        lab.adjust(d.id, 20000)
        m = d.market("BUY", 600)
        R.check("seller buys 600 to sell", bool(m) and m.get("status") == "FILLED", f"{m}")
        sell = d.place("SELL", 600, PIN)
        R.check("SELL 600 fills 300 then stops (PARTIAL)", bool(sell) and sell.get("status") == "PARTIAL"
                and close(sell.get("filledQty"), 300), f"{sell}")
        up = c.update(o2.get("orderId"), "CANCELLED") if o2 else None
        R.check("second BUY auto-cancelled with INSUFFICIENT_FUNDS", bool(up) and up.get("reason") == "INSUFFICIENT_FUNDS", f"{up}")
        R.check("buyer cash = 10000 - 300 x 28.50, never negative", close(lab.balance(c.id), D("1450.00")),
                f"{lab.balance(c.id)}")
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
        R.check("cash 7160.00", close(lab.balance(g.id), D("7160.00")), f"{lab.balance(g.id)}")

        sell = g.place("SELL", 100, D("29.40"))
        lab.set_price(SYMBOL, D("30.00"))
        up = g.update(sell.get("orderId"), "FILLED", timeout=5) if sell else None
        R.check("price rises above the ask -> house fills the SELL at 29.40", bool(up), f"{up}")
        q, avg, real = lab.position(g.id)
        R.check("round trip: cash 10100.00, flat, realized +100.00",
                close(lab.balance(g.id), D("10100.00")) and close(q, 0) and close(real, D("100.00")),
                f"cash={lab.balance(g.id)} qty={q} realized={real}")

        _, stats = lab.get(f"/api/leaderboard?userId={g.id}", token=g.token)
        R.check("leaderboard: ROI 1.00%, win rate 100%, 2 trades, real rank",
                bool(stats) and close(stats.get("roi"), D("1.0"), D("0.001")) and close(stats.get("winRate"), 100)
                and stats.get("tradeCount") == 2 and (stats.get("rank") or 0) > 0, f"{stats and {k: stats.get(k) for k in ('roi', 'winRate', 'tradeCount', 'rank')}}")
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
    R.section("5. Wash trade (intentional, #62): recorded, but cash and shares net to zero")
    u = Trader(lab, lab.register("s5u"))
    try:
        u.market("BUY", 2)
        cash0, (q0, _, _) = lab.balance(u.id), lab.position(u.id)
        s = u.place("SELL", 1, PIN)
        b = u.place("BUY", 1, PIN)
        R.check("own BUY crosses own SELL (no self-trade guard)", bool(b) and b.get("status") == "FILLED", f"{b}")
        n = lab.scalar(f"SELECT COUNT(*) FROM trades WHERE buy_order_id = {int(b['orderId'])} AND sell_order_id = {int(s['orderId'])}") if b and s else 0
        R.check("one trade row recorded", int(n or 0) == 1, f"{n}")
        R.check("cash and position unchanged", close(lab.balance(u.id), cash0) and close(lab.position(u.id)[0], q0),
                f"cash {cash0}->{lab.balance(u.id)} qty {q0}->{lab.position(u.id)[0]}")
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
        both = 0
        for _ in range(5):
            s = maker.place("SELL", 1, PIN) if lab.position(maker.id)[0] >= 1 else None
            if not s:
                maker.market("BUY", 1)
                s = maker.place("SELL", 1, PIN)
            out = {}

            def cancel():
                r = lab.http.post(f"{lab.base}/api/orders/{s['orderId']}/cancel",
                                  headers={"Authorization": f"Bearer {takers[0].token}"})
                out["cancel"] = r.status_code

            def take():
                out["take"] = takers[1].place("BUY", 1, PIN)

            t1, t2 = threading.Thread(target=cancel), threading.Thread(target=take)
            t1.start(), t2.start(), t1.join(), t2.join()
            st = lab.order(s["orderId"])[0]
            took = out["take"] and out["take"].get("status") == "FILLED"
            if (out["cancel"] == 200 and took) or (out["cancel"] != 200 and not took):
                both += 1
            if out["take"] and out["take"].get("status") == "NEW":
                takers[1].cancel(out["take"]["orderId"])
            _ = st
        R.check("cancel vs fill: never both, never neither (5 rounds)", both == 0, f"bad rounds={both}")
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
            R.check(f"{label} rejected", bool(r) and r.get("type") == "ERROR" and needle in str(r.get("message")), f"{r}")
    finally:
        v.close()


def s8_prices_and_candles(lab: Lab):
    R.section("8. Prices, candles, timestamps")
    lab.admin_stomp.buffer.clear()
    lab.set_price(SYMBOL, D("28.55"))
    upd = lab.admin_stomp.wait(lambda d, b: d == "/topic/prices" and isinstance(b, dict)
                               and b.get("symbol") == SYMBOL and close(b.get("last"), D("28.55")), 4)
    R.check("setPrice is broadcast on /topic/prices (internal fields still there)",
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

    _, c = lab.get("/api/market/candles?symbol=AAPL&interval=1m&limit=60")
    bars = c["candles"] if c else []
    times = [b["time"] for b in bars]
    ok_time = all(t % 60 == 0 for t in times) and all(b > a for a, b in zip(times, times[1:]))
    ok_ohlc = all(D(str(b["high"])) >= max(D(str(b["open"])), D(str(b["close"])))
                  and D(str(b["low"])) <= min(D(str(b["open"])), D(str(b["close"]))) for b in bars)
    live = D(str(lab.price("AAPL")["currentPrice"]))
    last_close = D(str(bars[-1]["close"])) if bars else D(0)
    R.check("1m candles: minute-aligned, increasing, OHLC-consistent", len(bars) >= 30 and ok_time and ok_ohlc, f"{len(bars)} bars")
    R.check("last candle close tracks the live price", abs(last_close - live) / live < D("0.01"), f"{last_close} vs {live}")
    _, c5 = lab.get("/api/market/candles?symbol=AAPL&interval=5m&limit=10")
    R.check("5m candles aligned to 300s", bool(c5) and all(b["time"] % 300 == 0 for b in c5["candles"]))
    code, _ = lab.get("/api/market/candles?symbol=AAPL&interval=7m")
    R.check("bad interval -> 400", code == 400, f"{code}")

    t = lab.register("s8t")
    _, orders = lab.get("/api/orders", token=t["token"])
    _, txns = lab.get("/api/accounts/transactions", token=t["token"])
    stamp = (txns or [{}])[0].get("createdAt", "")
    R.check("API timestamps are UTC with a Z suffix", str(stamp).endswith("Z"), f"{stamp}")


def s9_admin_adjust_ledger(lab: Lab):
    R.section("9. Ledger completeness")
    a = lab.register("s9a")
    lab.adjust(a["userId"], 5)
    n = lab.scalar(f"SELECT COUNT(*) FROM transactions WHERE user_id = {int(a['userId'])} AND type = 'ADJUSTMENT'")
    R.check("REST adjust-balance writes an ADJUSTMENT ledger row", int(n or 0) == 1, f"{n}")


def s10_flag11(lab: Lab):
    R.section("10. FLAG 11 chain still works (deposit -> buy VULN -> pump -> rank #1)")
    info = lab.register("s10x")
    r = lab.http.put(f"{lab.base}/api/users/{info['userId']}/profile", json={"firstName": "Pump"},
                     headers={"Authorization": f"Bearer {info['token']}"})
    token = lab._json(r).get("token") or info["token"]
    lab.http.post(f"{lab.base}/api/accounts/deposit", json={"amount": 1000000, "sourceAccount": "fake"},
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


def invariants(lab: Lab):
    R.section("Database invariants")
    ids = ",".join(str(i) for i in lab.created) or "0"
    R.check("no negative balance anywhere", int(lab.scalar("SELECT COUNT(*) FROM users WHERE balance < 0")) == 0)
    R.check("no negative position anywhere", int(lab.scalar("SELECT COUNT(*) FROM positions WHERE quantity < 0")) == 0)
    R.check("no order over-filled", int(lab.scalar("SELECT COUNT(*) FROM orders WHERE filled_qty > quantity")) == 0)
    R.check("no MARKET order left resting",
            int(lab.scalar("SELECT COUNT(*) FROM orders WHERE order_type = 'MARKET' AND status IN ('NEW','PARTIAL')")) == 0)
    bad = lab.sql("SELECT o.id FROM orders o LEFT JOIN trades t ON t.buy_order_id = o.id OR t.sell_order_id = o.id "
                  f"WHERE o.user_id IN ({ids}) GROUP BY o.id, o.filled_qty "
                  "HAVING ABS(COALESCE(o.filled_qty,0) - COALESCE(SUM(t.quantity),0)) > 0.00000001")
    R.check("filled_qty equals the sum of the order's trades (this run)", not bad, f"{bad[:5]}")
    bad = lab.sql("SELECT u.id FROM users u JOIN transactions x ON x.user_id = u.id "
                  f"WHERE u.id IN ({ids}) GROUP BY u.id, u.balance HAVING ABS(u.balance - SUM(x.amount)) > 0.00000001")
    R.check("balance equals the sum of the ledger (this run)", not bad, f"{bad[:5]}")
    crossed = lab.sql("SELECT symbol FROM (SELECT symbol, MAX(price) FILTER (WHERE side='BUY') bb, "
                      "MIN(price) FILTER (WHERE side='SELL') ba FROM orders WHERE status IN ('NEW','PARTIAL') "
                      "AND order_type='LIMIT' GROUP BY symbol) x WHERE bb >= ba")
    R.check("no symbol has a crossed book (best bid < best ask)", not crossed, f"{crossed}")


# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", default="http://localhost:8085")
    ap.add_argument("--ws-url", default=None, help="default: <base-url>/ws as ws://")
    ap.add_argument("--skip-flag", action="store_true", help="skip the FLAG 11 pump (it leaves VULN overridden)")
    args = ap.parse_args()
    ws_url = args.ws_url or args.base_url.replace("https://", "wss://").replace("http://", "ws://").rstrip("/") + "/ws"

    lab = Lab(args.base_url, ws_url)
    original = D(str(lab.price(SYMBOL)["currentPrice"]))
    print(f"VulnTrade trading-integrity suite — run {lab.run} against {args.base_url}")
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

    total = R.passed + len(R.failed)
    print(f"\n{R.passed}/{total} checks passed" + (f" — FAILED: {', '.join(R.failed)}" if R.failed else ""))
    sys.exit(1 if R.failed else 0)


if __name__ == "__main__":
    main()
