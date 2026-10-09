# VulnTrade Synthetic User Simulator

Browser-driven bot (Playwright) that behaves like a real trader on the VulnTrade UI:
registers, browses the dashboard + leaderboard, places a few small trades, and sometimes
verifies the account or uploads a profile photo. Generated users are saved to `users.json`
so a later run can log back in and close some of their open orders.

It's a POC — readable over robust. Traffic is tagged (`User-Agent: VulnTrade-SimUser/1.0`
and header `campaign: sim-users`) so it's easy to find in the SIEM.

## Setup (once)
```bash
/opt/homebrew/bin/python3.13 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/playwright install chromium
```

## Run
```bash
# a brand-new trader, full end-to-end, watch the browser
.venv/bin/python simulate_user.py --mode new --count 1 --headed

# a returning trader: log in and close 25-75% of open orders
.venv/bin/python simulate_user.py --mode returning --count 1 --headed

# unattended / many users
.venv/bin/python simulate_user.py --mode new --count 5

# point at a local docker stack instead of the deployed lab
.venv/bin/python simulate_user.py --mode new --base-url http://localhost:3001
```

## Flags
- `--mode new|returning` (default `new`)
- `--count N` — how many users this run (default 1)
- `--headed` — show the browser (default headless)
- `--base-url URL` — override target (default is the CloudFront lab; env `SIM_BASE_URL` also works)

## Knobs (top of `simulate_user.py`)
`TRADE_BUDGET_PCT` (5%), `MIN_TRADES`/`MAX_TRADES` (5–20), `CLOSE_MIN`/`CLOSE_MAX` (25–75%),
`VERIFY_CHANCE`, `PHOTO_CHANCE`.

## Notes
- Trades total ≤ 5% of the trader's capital; buys are mostly resting LIMIT orders so returning
  runs have something to close.
- `users.json` holds plaintext lab creds → gitignored.
- Max verification level via the UI is Level 2 (that's all the app exposes).
