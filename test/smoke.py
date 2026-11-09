#!/usr/bin/env python3
"""
VulnTrade 1.0.0 smoke test: is every service up, and does one happy path per product work?

    python3 test/smoke.py --base-url http://192.168.67.2:31080

Checks (a product section is skipped while its gateway is not deployed yet):
  platform   health, login, my accounts, transfer MAIN -> product -> MAIN
  fx         quotes stream, BUY 1,000 EURUSD on a quote -> FILLED, balances moved
  equities   price stream, MARKET BUY 1 AAPL -> FILLED, SELL 1 -> FILLED
  crypto     price stream, MARKET BUY 0.001 BTC-USD -> FILLED, SELL -> FILLED
Exit code 0 when everything that ran passed.
"""
import argparse
import os
import sys
import time
import uuid
from decimal import Decimal as D

import requests

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "bench"))
from stomp import Stomp  # noqa: E402

PASSED, FAILED = [], []


def check(name, ok, detail=""):
    (PASSED if ok else FAILED).append(name)
    print("  [%s] %s%s" % ("PASS" if ok else "FAIL", name, "" if ok else "  -> %s" % str(detail)[:300]))
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True, help="frontend (nginx) URL, e.g. http://192.168.67.2:31080")
    a = ap.parse_args()
    base = a.base_url.rstrip("/")
    ws_base = base.replace("http", "ws", 1)
    http = requests.Session()

    print("platform")
    r = http.get(base + "/api/health", timeout=10)
    check("platform health", r.status_code == 200 and r.json().get("status") == "UP", r.text)
    name = "smoke_" + uuid.uuid4().hex[:6]
    r = http.post(base + "/api/auth/register", json={"username": name, "password": "Passw0rd!", "email": name + "@example.test"})
    check("register", r.status_code in (200, 201), r.text)
    token = r.json()["token"]
    auth = {"Authorization": "Bearer " + token}
    r = http.get(base + "/api/accounts", headers=auth)
    accounts = {acc["product"]: acc for acc in r.json().get("accounts", [])} if r.ok else {}
    check("4 accounts (MAIN, FX, EQUITIES, CRYPTO)", set(accounts) == {"MAIN", "FX", "EQUITIES", "CRYPTO"}, r.text)
    usd = lambda acc: next((D(str(b["available"])) for b in acc["balances"] if b["asset"] == "USD"), D(0))
    check("product accounts start with 10,000 demo USD", all(usd(accounts[p]) == D(10000) for p in ("FX", "EQUITIES", "CRYPTO")),
          {p: str(usd(accounts[p])) for p in accounts})
    r = http.post(base + "/api/accounts/transfer", headers=auth, json={"from": "MAIN", "to": "FX", "amount": "250"})
    check("transfer MAIN -> FX 250", r.ok and r.json().get("status") == "COMPLETED", r.text)
    r = http.post(base + "/api/accounts/transfer", headers=auth, json={"from": "FX", "to": "MAIN", "amount": "250"})
    check("transfer FX -> MAIN 250", r.ok and r.json().get("status") == "COMPLETED", r.text)
    r = http.post(base + "/api/accounts/transfer", headers=auth, json={"from": "MAIN", "to": "FX", "amount": "-5"})
    check("negative transfer refused (safe version)", r.status_code == 400, r.text)

    if http.get(base + "/api/fx/pairs", timeout=10).status_code == 200:
        print("fx")
        stream = Stomp(ws_base + "/api/fx/ws", token)
        stream.subscribe("/topic/fx/prices")
        tick = stream.wait(lambda d, b: d == "/topic/fx/prices", 5)
        check("FX price stream delivers quotes", isinstance(tick, dict) and tick.get("quoteId"), tick)
        stream.close()
        quote = next(q for q in http.get(base + "/api/fx/quotes").json() if q["pair"] == "EURUSD")
        r = http.post(base + "/api/fx/orders", headers=auth, json={"pair": "EURUSD", "side": "BUY", "amount": "1000",
                                                                    "quoteId": quote["quoteId"]})
        order = r.json() if r.ok else {}
        check("BUY 1,000 EURUSD on a quote -> FILLED", order.get("status") == "FILLED", r.text)
        bal = {b["asset"]: D(str(b["available"])) for b in http.get(base + "/api/fx/balances", headers=auth).json()["balances"]}
        want_usd = D(10000) - (D(1000) * D(str(quote["ask"]))).quantize(D("0.01"), rounding="ROUND_DOWN")
        check("FX balances: +1,000 EUR, USD paid at the ask", bal.get("EUR") == D(1000) and bal.get("USD") == want_usd,
              {k: str(v) for k, v in bal.items()})

    for product, symbol, qty in (("equities", "AAPL", "1"), ("crypto", "BTC-USD", "0.001")):
        if http.get("%s/api/%s/market/prices" % (base, product), timeout=10).status_code != 200:
            continue
        print(product)
        stream = Stomp("%s/api/%s/ws" % (ws_base, product), token)
        stream.subscribe("/topic/%s/prices" % product)
        tick = stream.wait(lambda d, b: d == "/topic/%s/prices" % product, 5)
        check("%s price stream delivers prices" % product, isinstance(tick, dict) and tick.get("symbol"), tick)
        stream.close()
        for side in ("BUY", "SELL"):
            r = http.post("%s/api/%s/orders" % (base, product), headers=auth,
                          json={"symbol": symbol, "side": side, "quantity": qty, "type": "MARKET"})
            check("%s MARKET %s %s %s -> FILLED" % (product, side, qty, symbol),
                  r.ok and r.json().get("status") == "FILLED", r.text)
            time.sleep(0.2)

    print("\n%d passed, %d failed%s" % (len(PASSED), len(FAILED), (": %s" % FAILED) if FAILED else ""))
    return 0 if not FAILED else 1


if __name__ == "__main__":
    sys.exit(main())
