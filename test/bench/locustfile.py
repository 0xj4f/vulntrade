"""
Locust load test for VulnTrade: the same trader behaviour against 0.6.0 and 1.0.0.

Run (headless, 50 traders + 50 price-stream listeners, CSV + HTML report):
    VT_TARGET=v0 locust -f test/bench/locustfile.py --host http://192.168.67.2:30080 \
        --headless -u 100 -r 20 -t 3m --csv out/v0_mixed --html out/v0_mixed.html
    (-u 50 Trader only:  add  Trader  at the end of the command line)

VT_TARGET picks the URL layout:
    v0 = VulnTrade 0.6.0 (one backend: /api/orders, /api/market/*)
    v1 = VulnTrade 1.0.0 (one gateway per product: /api/equities/*, /api/crypto/*, /api/fx/*)
VT_FX=1 adds the FX task (1.0.0 only). VT_NO_THINK=1 removes think time (stress).
One scenario only: --tags eq_mkt   (read, eq_mkt, eq_lim, cr_mkt, cr_lim, login, fx)

Each simulated trader registers its own account, gets funded by the admin, then picks
weighted tasks with 0.5-1.5 s think time. Order results that are a normal business "no"
(not enough money, no liquidity) are reported under their own name ending in "[rejected]",
so they never hide real errors.
"""
import os
import uuid

import sys

from locust import HttpUser, User, between, constant, tag, task

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stomp import Stomp  # noqa: E402  (tiny STOMP client next to this file)

TARGET = os.environ.get("VT_TARGET", "v0")
WITH_FX = os.environ.get("VT_FX") == "1"
NO_THINK = os.environ.get("VT_NO_THINK") == "1"   # stress: no pause between tasks
RUN = uuid.uuid4().hex[:6]

# URL layout per version. Everything else in this file is the same for both.
ROUTES = {
    "v0": {"orders": {"equities": "/api/orders", "crypto": "/api/orders"},
           "my_orders": "/api/orders", "prices": ["/api/market/prices"]},
    "v1": {"orders": {"equities": "/api/equities/orders", "crypto": "/api/crypto/orders"},
           "my_orders": "/api/equities/orders",
           "prices": ["/api/equities/market/prices", "/api/crypto/market/prices"]},
}[TARGET]

# Live price streams a browser listens to: (WebSocket path, STOMP topic)
STREAMS = {
    "v0": [("/ws", "/topic/prices")],
    "v1": [("/api/equities/ws", "/topic/equities/prices"), ("/api/crypto/ws", "/topic/crypto/prices")],
}[TARGET]

ADMIN = {"username": "admin", "password": "admin123"}
PASSWORD = "Passw0rd!"


def admin_token(client):
    r = client.post("/api/auth/login", json=ADMIN, name="setup: admin login")
    return r.json()["token"]


class Trader(HttpUser):
    wait_time = constant(0) if NO_THINK else between(0.5, 1.5)

    def on_start(self):
        self.username = "bench_%s_%s" % (RUN, uuid.uuid4().hex[:6])
        r = self.client.post("/api/auth/register", name="setup: register",
                             json={"username": self.username, "password": PASSWORD,
                                   "email": self.username + "@example.test"})
        info = r.json()
        self.user_id = info["userId"]
        self.headers = {"Authorization": "Bearer " + info["token"]}
        # Same starting money for both versions: 100k in total.
        self.client.post("/api/admin/adjust-balance", name="setup: fund",
                         headers={"Authorization": "Bearer " + admin_token(self.client)},
                         json={"userId": self.user_id, "amount": "90000", "reason": "benchmark funding"})
        if TARGET == "v1":
            for product, amount in (("EQUITIES", 30000), ("CRYPTO", 30000), ("FX", 10000)):
                self.client.post("/api/accounts/transfer", name="setup: transfer", headers=self.headers,
                                 json={"from": "MAIN", "to": product, "amount": str(amount)})
        self.prices = self.load_prices()

    def load_prices(self):
        prices = {}
        for path in ROUTES["prices"]:
            for p in self.client.get(path, name="setup: prices").json():
                prices[p["symbol"]] = float(p.get("currentPrice") or p.get("last") or p.get("price"))
        return prices

    # ---- helpers -------------------------------------------------------

    def order(self, product, symbol, side, qty, otype, price=None, want="FILLED"):
        body = {"symbol": symbol, "side": side, "quantity": str(qty), "type": otype}
        if price is not None:
            body["price"] = str(price)
        name = "%s %s order" % (product, otype.lower())
        headers = self.headers
        if TARGET == "v1" and product == "equities":
            # The trading screen sends orders over the product WebSocket; the gateway then adds
            # X-Channel: ws and equities-internals prices a MARKET order at the live bid/ask.
            # Without it, a priceless REST MARKET order takes the EQ-5 bug path (holds $0, house fill).
            headers = dict(self.headers, **{"X-Channel": "ws"})
        with self.client.post(ROUTES["orders"][product], json=body, headers=headers,
                              name=name, catch_response=True) as r:
            data = safe_json(r)
            if r.status_code < 300 and data.get("status") == want:
                r.success()
                return data
            if is_business_no(r, data):
                r.request_meta["name"] = name + " [rejected]"   # report it on its own line
                r.success()
                return data
            r.failure("%s %s" % (r.status_code, r.text[:200]))
            return data

    def cancel(self, product, order_id):
        path = "%s/%s/cancel" % (ROUTES["orders"][product], order_id)
        with self.client.post(path, headers=self.headers, name="%s cancel" % product, catch_response=True) as r:
            if r.status_code < 300:
                r.success()
            else:
                r.failure("%s %s" % (r.status_code, r.text[:200]))

    # ---- tasks (weights = the realistic mix) ---------------------------

    @tag("read")
    @task(30)
    def read(self):
        self.client.get("/api/accounts/balance", headers=self.headers, name="read balance")
        self.client.get(ROUTES["my_orders"], headers=self.headers, name="read my orders")
        self.client.get(ROUTES["prices"][0], name="read prices")

    @tag("eq_mkt")
    @task(20)
    def stock_market_round_trip(self):
        self.order("equities", "AAPL", "BUY", 1, "MARKET")
        self.order("equities", "AAPL", "SELL", 1, "MARKET")

    @tag("eq_lim")
    @task(10)
    def stock_limit_then_cancel(self):
        o = self.order("equities", "MSFT", "BUY", 1, "LIMIT", round(self.prices["MSFT"] * 0.5, 2), want="NEW")
        if o.get("orderId"):
            self.cancel("equities", o["orderId"])

    @tag("cr_mkt")
    @task(15)
    def crypto_market_round_trip(self):
        self.order("crypto", "BTC-USD", "BUY", "0.001", "MARKET")
        self.order("crypto", "BTC-USD", "SELL", "0.001", "MARKET")

    @tag("cr_lim")
    @task(10)
    def crypto_limit_then_cancel(self):
        o = self.order("crypto", "ETH-USD", "BUY", "0.01", "LIMIT", round(self.prices["ETH-USD"] * 0.5, 2), want="NEW")
        if o.get("orderId"):
            self.cancel("crypto", o["orderId"])

    @tag("login")
    @task(10)
    def login(self):
        self.client.post("/api/auth/login", json={"username": self.username, "password": PASSWORD}, name="login")

    @tag("fx")
    @task(15 if (WITH_FX and TARGET == "v1") else 0)
    def fx_round_trip(self):
        """Buy 1,000 EURUSD on a fresh quote, then sell it back (FX fills instantly against the House)."""
        for side in ("BUY", "SELL"):
            quotes = self.client.get("/api/fx/quotes", name="fx quotes").json()
            quote = next(q for q in quotes if q["pair"] == "EURUSD")
            with self.client.post("/api/fx/orders", headers=self.headers, name="fx order", catch_response=True,
                                  json={"pair": "EURUSD", "side": side, "amount": "1000",
                                        "quoteId": quote["quoteId"]}) as r:
                data = safe_json(r)
                if r.status_code < 300 and data.get("status") == "FILLED":
                    r.success()
                elif is_business_no(r, data):
                    r.request_meta["name"] = "fx order [rejected]"
                    r.success()
                else:
                    r.failure("%s %s" % (r.status_code, r.text[:200]))


class PriceWatcher(User):
    """A browser tab that only listens to the live price stream (STOMP over WebSocket).

    Each received price is reported as a "WS price" sample whose response time is the
    stream lag: receive time minus the server timestamp in the message.
    Run with -u 100 to get 50 Trader + 50 PriceWatcher (fixed_count below).
    """
    fixed_count = 50
    wait_time = constant(1)

    def on_start(self):
        ws_base = self.host.replace("http", "ws", 1)
        self.streams = []
        for path, topic in STREAMS:
            s = Stomp(ws_base + path, on_message=self.on_price)
            s.subscribe(topic)
            self.streams.append(s)

    def on_price(self, dest, body, received):
        if isinstance(body, dict) and isinstance(body.get("timestamp"), (int, float)):
            self.environment.events.request.fire(request_type="WS", name="WS price", context={},
                                                 response_time=max(0.0, received * 1000 - body["timestamp"]),
                                                 response_length=0, exception=None)

    @task
    def check_connection(self):
        for s in self.streams:
            if s.disconnected:
                self.environment.events.request.fire(request_type="WS", name="WS disconnect", context={},
                                                     response_time=0, response_length=0,
                                                     exception=ConnectionError("stream dropped"))
                s.disconnected = False

    def on_stop(self):
        for s in self.streams:
            s.close()


def safe_json(r):
    try:
        data = r.json()
        return data if isinstance(data, dict) else {}
    except ValueError:
        return {}


def is_business_no(r, data):
    text = (r.text or "").lower()
    if "busy" in text or r.status_code >= 500:
        return False
    return data.get("status") in ("REJECTED", "CANCELLED") or "insufficient" in text or "liquidity" in text
