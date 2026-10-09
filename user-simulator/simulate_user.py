#!/usr/bin/env python3
"""
VulnTrade synthetic-user simulator (browser-driven, POC).

Drives the real React UI with Playwright to look like a normal trader:
register -> browse dashboard & leaderboard -> place a few small trades ->
maybe verify the account -> maybe upload a profile photo. Users are saved to
users.json so a later run can log back in and close some of their open orders.

This is a proof-of-concept: it favors readability over defensive validation.
If a selector isn't found it will just fail loudly - that's fine for a lab.

Usage:
    python simulate_user.py --mode new        --count 1 --headed
    python simulate_user.py --mode returning  --count 1 --headed
"""

import argparse
import json
import os
import random
import time
from datetime import datetime, timezone

from faker import Faker
from playwright.sync_api import sync_playwright

# ---------------------------------------------------------------------------
# Config - tweak these freely.
# ---------------------------------------------------------------------------
BASE_URL = os.environ.get("SIM_BASE_URL", "https://d1v7uo8k715nt7.cloudfront.net")
USERS_FILE = os.path.join(os.path.dirname(__file__), "users.json")
AVATAR = os.path.join(os.path.dirname(__file__), "assets", "avatar.png")

TRADE_BUDGET_PCT = 0.05     # never spend more than 5% of capital across all trades
MIN_TRADES, MAX_TRADES = 5, 20
CLOSE_MIN, CLOSE_MAX = 0.25, 0.75   # returning users close 25%-75% of open orders
VERIFY_CHANCE = 0.5         # chance a new user verifies their account
PHOTO_CHANCE = 0.4          # chance a new user uploads a profile photo

# Tag the traffic so it is easy to find in the SIEM (still behaves like a browser).
USER_AGENT = "VulnTrade-SimUser/1.0"
CAMPAIGN = "sim-users"

faker = Faker()


# ---------------------------------------------------------------------------
# Small helpers.
# ---------------------------------------------------------------------------
def log(msg):
    print(f"{datetime.now(timezone.utc):%H:%M:%SZ}  {msg}", flush=True)


def human_pause(a=0.6, b=2.2):
    """Wait a random moment, like a person reading the page."""
    time.sleep(random.uniform(a, b))


def make_identity():
    """Random identity for a brand-new trader."""
    name = faker.user_name() + str(random.randint(10, 999))
    return {
        "username": name,
        "password": "Passw0rd!" + str(random.randint(100, 999)),
        "email": f"{name}@example.com",
        "firstName": faker.first_name(),
    }


def load_users():
    if not os.path.exists(USERS_FILE):
        return []
    with open(USERS_FILE) as f:
        return json.load(f)


def save_user(record):
    users = load_users()
    users.append(record)
    with open(USERS_FILE, "w") as f:
        json.dump(users, f, indent=2)
    log(f"saved user to {os.path.basename(USERS_FILE)} (now {len(users)} users)")


def read_local_user(page):
    """Read the user JSON the app stores in localStorage after auth."""
    raw = page.evaluate("() => localStorage.getItem('user')")
    return json.loads(raw) if raw else {}


# ---------------------------------------------------------------------------
# Auth.
# ---------------------------------------------------------------------------
def register(page, identity):
    log(f"register as {identity['username']}")
    page.goto(f"{BASE_URL}/register")
    page.get_by_placeholder("Choose a username").fill(identity["username"])
    page.get_by_placeholder("your@email.com").fill(identity["email"])
    page.get_by_placeholder("Enter password").fill(identity["password"])
    page.get_by_placeholder("Confirm password").fill(identity["password"])
    page.get_by_role("button", name="Create Account").click()
    page.wait_for_url("**/dashboard", timeout=20000)
    human_pause()
    return read_local_user(page)


def login(page, user):
    log(f"login as {user['username']}")
    page.goto(f"{BASE_URL}/login")
    page.get_by_placeholder("Enter username").fill(user["username"])
    page.get_by_placeholder("Enter password").fill(user["password"])
    page.get_by_role("button", name="Sign In").click()
    page.wait_for_url("**/dashboard", timeout=20000)
    human_pause()
    return read_local_user(page)


# ---------------------------------------------------------------------------
# Human-like browsing (the "engagement").
# ---------------------------------------------------------------------------
def browse_like_a_human(page):
    log("browsing dashboard + leaderboard")
    page.goto(f"{BASE_URL}/dashboard")
    human_pause(1.0, 3.0)

    # Visit the leaderboard and peek at a few traders.
    page.get_by_role("link", name="Leaderboard").click()
    human_pause(1.0, 2.5)
    rows = page.get_by_text("@", exact=False)
    clicks = min(rows.count(), random.randint(1, 3))
    for i in range(clicks):
        try:
            rows.nth(i).click()          # opens the trader detail modal
            human_pause(0.8, 2.0)
            page.keyboard.press("Escape")  # best-effort close
            human_pause(0.4, 1.0)
        except Exception:
            pass

    # Wander back to the dashboard.
    page.get_by_role("link", name="Dashboard").click()
    human_pause(0.8, 2.0)


# ---------------------------------------------------------------------------
# Trading - keep total spend under 5% of capital.
# ---------------------------------------------------------------------------
def symbol_ask(page, symbol):
    """Select a symbol in the order form and read the auto-filled MARKET ask price."""
    page.locator("select").nth(0).select_option(symbol)   # symbol dropdown
    page.locator("select").nth(1).select_option("MARKET")  # type -> price fills with ask
    human_pause(0.3, 0.7)
    try:
        return float(page.locator('input[step="0.01"]').input_value())
    except Exception:
        return None


def place_random_trades(page, balance):
    budget = balance * TRADE_BUDGET_PCT
    n = random.randint(MIN_TRADES, MAX_TRADES)
    remaining = budget
    spent = 0.0
    log(f"placing up to {n} trades, budget ${budget:.2f} (5% of ${balance:.2f})")

    page.goto(f"{BASE_URL}/dashboard")
    page.wait_for_selector("select", timeout=15000)
    page.wait_for_timeout(3500)   # let the live (WebSocket) price feed populate the form
    symbols = page.locator("select").nth(0).locator("option").all_text_contents()

    placed = 0
    for _ in range(n):
        # Find a symbol we can afford at least 1 unit of.
        random.shuffle(symbols)
        pick = None
        for s in symbols:
            ask = symbol_ask(page, s)
            if ask and ask <= remaining:
                pick, ask_price = s, ask
                break
        if not pick:
            log("no affordable symbol left, stopping early")
            break

        # Size the trade: a slice of the remaining budget, at least 1 unit.
        slice_budget = min(remaining, budget / n)
        qty = max(1, int(slice_budget / ask_price))
        while qty * ask_price > remaining and qty > 1:
            qty -= 1

        use_market = random.random() < 0.2   # a few market fills, mostly resting limits
        page.get_by_role("button", name="BUY", exact=True).click()   # always BUY (new user has no holdings to sell)
        page.locator("select").nth(0).select_option(pick)

        if use_market:
            page.locator("select").nth(1).select_option("MARKET")
            price = ask_price
        else:
            page.locator("select").nth(1).select_option("LIMIT")
            price = round(ask_price * 0.9, 2)   # below market -> rests as an open order
            page.locator('input[step="0.01"]').fill(str(price))

        page.locator('input[max="10000"]').fill(str(qty))
        page.get_by_role("button", name=f"BUY {pick}", exact=True).click()

        notional = qty * price
        remaining -= notional
        spent += notional
        placed += 1
        log(f"  trade {placed}: BUY {qty} {pick} @ {price} ({'MARKET' if use_market else 'LIMIT'})  ~${notional:.2f}")
        human_pause()

    log(f"placed {placed} trades, spent ${spent:.2f} of ${budget:.2f} budget")


# ---------------------------------------------------------------------------
# Optional new-user scenarios.
# ---------------------------------------------------------------------------
def open_account(page, username):
    """Navigate to /account via the avatar dropdown (a hard goto races auth and
    bounces back to /dashboard, so we click through the UI instead)."""
    page.goto(f"{BASE_URL}/dashboard")
    human_pause(0.5, 1.0)
    page.get_by_text(username, exact=False).first.click()   # open avatar dropdown
    human_pause(0.3, 0.7)
    page.get_by_role("button", name="Account").click()
    page.wait_for_timeout(1500)


def maybe_verify(page, identity):
    if random.random() > VERIFY_CHANCE:
        return False
    log("verifying account (Save & Verify)")
    try:
        open_account(page, identity["username"])
        page.get_by_placeholder("First name").fill(identity["firstName"])
        page.get_by_role("button", name="Save & Verify").click()
        human_pause(1.0, 2.0)
        return True
    except Exception as e:
        log(f"  verify skipped ({type(e).__name__})")
        return False


def maybe_upload_photo(page, identity):
    if random.random() > PHOTO_CHANCE:
        return False
    log("uploading profile photo")
    try:
        open_account(page, identity["username"])
        page.locator('input[type="file"]').set_input_files(AVATAR)  # opens the crop modal
        human_pause(0.8, 1.5)
        page.get_by_role("button", name="Apply & Set as Photo").click()
        human_pause(1.0, 2.0)
        return True
    except Exception as e:
        log(f"  photo upload skipped ({type(e).__name__})")
        return False


# ---------------------------------------------------------------------------
# Returning user - close some open orders.
# ---------------------------------------------------------------------------
def my_open_order_ids(page):
    """The user's OWN open orders, read the same way the app does (GET /api/orders)."""
    orders = page.evaluate("""async () => {
        const t = localStorage.getItem('token');
        const r = await fetch('/api/orders', { headers: { Authorization: 'Bearer ' + t } });
        return await r.json();
    }""")
    open_states = ("NEW", "OPEN", "PARTIALLY_FILLED")
    return [str(o["id"]) for o in orders if o.get("status") in open_states]


def cancel_order(page, order_id):
    """Cancel one of my orders via the app's own endpoint, from the browser session.
    (The dashboard's "My Orders" table has no cancel button; the only per-row Cancel is
    in the Order Book, which lists every user's orders and doesn't show all of mine, so
    we call the same REST cancel the app exposes - scoped to my own order ids.)"""
    return page.evaluate(
        """async (id) => {
            const t = localStorage.getItem('token');
            const r = await fetch('/api/orders/' + id + '/cancel',
                                  { method: 'POST', headers: { Authorization: 'Bearer ' + t } });
            return r.status;
        }""",
        order_id,
    )


def close_some_orders(page):
    page.goto(f"{BASE_URL}/dashboard")
    page.wait_for_selector("select", timeout=15000)
    page.wait_for_timeout(2500)

    open_ids = my_open_order_ids(page)
    if not open_ids:
        log("no open orders to close")
        return
    k = max(1, round(len(open_ids) * random.uniform(CLOSE_MIN, CLOSE_MAX)))
    chosen = random.sample(open_ids, k)
    log(f"closing {k} of {len(open_ids)} of my open orders")
    for oid in chosen:
        status = cancel_order(page, oid)
        log(f"  cancelled order #{oid} (HTTP {status})")
        human_pause(0.6, 1.5)


# ---------------------------------------------------------------------------
# Flows.
# ---------------------------------------------------------------------------
def new_user_flow(page):
    identity = make_identity()
    user = register(page, identity)
    balance = float(user.get("balance", 10000))
    browse_like_a_human(page)
    place_random_trades(page, balance)
    verified = maybe_verify(page, identity)
    has_photo = maybe_upload_photo(page, identity)
    save_user({
        "username": identity["username"],
        "password": identity["password"],
        "email": identity["email"],
        "firstName": identity["firstName"],
        "userId": user.get("userId"),
        "verified": verified,
        "hasPhoto": has_photo,
        "baseUrl": BASE_URL,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    })


def returning_user_flow(page):
    users = load_users()
    if not users:
        log("no saved users - run --mode new first")
        return
    user = random.choice(users)
    login(page, user)
    browse_like_a_human(page)
    close_some_orders(page)


# ---------------------------------------------------------------------------
# Entry point.
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="VulnTrade synthetic user simulator")
    parser.add_argument("--mode", choices=["new", "returning"], default="new")
    parser.add_argument("--count", type=int, default=1, help="how many users to simulate")
    parser.add_argument("--headed", action="store_true", help="show the browser window")
    parser.add_argument("--base-url", help="override the target URL")
    args = parser.parse_args()

    global BASE_URL
    if args.base_url:
        BASE_URL = args.base_url

    log(f"target={BASE_URL}  mode={args.mode}  count={args.count}")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        for i in range(args.count):
            log(f"===== user {i + 1}/{args.count} =====")
            # Fresh context per user so logins/localStorage don't leak between them.
            context = browser.new_context(
                user_agent=USER_AGENT,
                extra_http_headers={"campaign": CAMPAIGN},
            )
            page = context.new_page()
            try:
                if args.mode == "new":
                    new_user_flow(page)
                else:
                    returning_user_flow(page)
            finally:
                page.close()
                context.close()
        browser.close()
    log("done")


if __name__ == "__main__":
    main()
