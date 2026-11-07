# Changelog

All notable changes to VulnTrade. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions are the git tags CI creates on every merge to `main` (`MAJOR.MINOR.<n>`), and the same tag is
published as the Docker images `0xj4f/vulntrade-backend:<version>` / `0xj4f/vulntrade-frontend:<version>`.

> **Intentional vulnerabilities are not "bugs" in this changelog.** Unless an entry says otherwise, every
> documented vulnerability and flag keeps working ([docs/vulnerabilities.md](docs/vulnerabilities.md)).

## [0.6.0] — stable baseline

The release to pin before the next big refactor: trading logic fixed end to end (browser → STOMP/REST →
matching → settlement → notifications), a redesigned UI, Kubernetes manifests, and a regression suite for
the business logic. Verified on docker compose and on minikube (Helm chart, through the ingress): exploit
matrix 68 pass / 0 fail / 8 skip (unchanged; 69/0/7 through the frontend URL), frontend checks 9/9,
security-events test 89/89, the new trading-integrity suite 60/60, and the synthetic user simulator.

### Upgrade notes
- **Reseed the database** (`docker compose down -v && docker compose up`, or `make -C deploy reset`).
  Older volumes keep the corrupted sub-cent prices (PEPE/DOGE/XRP), the crossed seed order book and
  seeded traders with negative cash. Two columns are new (`orders.status_reason`,
  `positions.realized_pnl`); `ddl-auto` adds them to an old schema, but the seed fixes need a fresh one.
- Pin images to `:0.6.0` instead of `:latest` to stay on this baseline.
- New client contract: asynchronous order events arrive on **`/user/queue/order-updates`**
  (`ORDER_UPDATE`). `/user/queue/orders` and `/user/queue/errors` are unchanged request/reply queues.
- API timestamps are now UTC with a `Z` suffix (`2026-11-06T13:50:13.428Z`).

### Fixed — trading and business logic (server)
- **Order notifications reached nobody.** Fills of resting orders and cancels were sent to the numeric
  user id, but STOMP users are keyed by username. They now go to `/user/queue/order-updates` after the
  transaction commits, with status, filled/remaining quantity, average fill price and a cancel reason.
- **Settlement never goes negative.** Orders are still not reserved when placed (the #43 lesson), but a
  fill now checks the buyer's cash and the seller's shares at execution. A resting order that can no
  longer be covered is cancelled (`INSUFFICIENT_FUNDS` / `INSUFFICIENT_POSITION`); an incoming one stops
  and cancels its remainder. Previously overlapping orders could overdraw cash, and overselling minted
  shares (the seller was paid while the position was floored at zero), bypassing the naked-short control.
- **Atomic matching.** Place, cancel, delete and the market-maker pass run under one lock and one
  transaction; balances and positions move with conditional SQL, so concurrent orders can't double-fill a
  resting order or lose updates (the withdraw race, BIZ-03, is deliberately untouched).
- **Average fill price** is volume-weighted across levels (it was the last fill's price).
- **Realized P&L** is recorded per position on every sell; the average cost resets when a position closes.
- **Side/type/precision validation.** Only `BUY`/`SELL` and `LIMIT`/`MARKET`, at most 8 decimals. An
  unknown side used to skip the risk checks and self-fill another user's order; an unknown type threw.
- **MARKET orders** never rest: an unfilled remainder is cancelled (`NO_LIQUIDITY`) instead of sitting in
  the book at a stale price. The risk check includes the house spread. Marketable LIMIT orders fill
  against the house at their limit or better.
- **House market maker.** Resting LIMIT orders that the price later crosses are filled by the house at
  their limit price (limits used to fill only when another order arrived). The house's two-sided ladder is
  re-quoted around the live price every 2 s — or at once when it falls behind — instead of sitting at
  boot-time prices (risk-free arbitrage). VULN keeps its static ladder (predictable-price lesson).
- **Sub-cent coins.** All `*-USD` prices keep 8 decimals. PEPE used to jump ~800× to $0.01 on the first
  tick and DOGE/XRP froze at two decimals.
- **Calmer, more realistic volatility** (stocks ~2.4 %/hour, BTC ~5 %/hour, one sigma) instead of
  10–30 %/hour swings. Same fixed-seed sequence; the VULN sine is unchanged.
- **Seed data.** Seeded traders' resting ladders stepped the wrong way and started crossed (e.g. BTC bids
  at 84,000 against a 67,510 ask); seeded histories left five traders with negative cash. Trades are now
  replayed chronologically with funding covered; the dev account no longer has sell orders without
  shares; the house keeps free inventory and cash.
- **Leaderboard.** ROI is measured against net deposits (deposits − withdrawals ± adjustments), not the
  first deposit, so free deposits no longer count as profit. Live trades were invisible to the win-rate
  parser (always 0 %) and the trader detail counted buys as sells; trades are now read from the trades
  table with one moving-average cost method. `?userId` returns the real rank, API-key callers get their
  `myRank`, wash trades count once. FLAG 11 and the notes leak are unchanged; the pump chain still beats
  the seeded #1 (now seeded with $4 M of capital).
- **Admin price override** is broadcast on `/topic/prices`, fires alerts and feeds the candles; a race
  that let the next tick overwrite it is closed. Prices ≤ 0 are refused (any positive price still works).
- **REST admin balance adjustment** writes its ledger row (balances always equal the sum of the ledger).
- **Order book** shows remaining (not original) quantity, sorts bids correctly, excludes MARKET orders,
  and adds an aggregated `levels` view; `/topic/orderbook/{symbol}` carries one symbol's book.
- **Timestamps** are written as UTC with `Z`, so browsers no longer shift them by the server offset.
- Hard-deleting an order that already traded returns `409` instead of a `500`.

### Fixed — client
- Subscriptions survive WebSocket reconnects; the `LIVE` badge reflects the real connection state; sends
  report failure instead of toasting success while offline; the socket reconnects after a token refresh;
  an expired session signs out cleanly instead of leaving a broken page.
- Order ticket: limit price pre-fills from the live price (not a hard-coded 150.00); robust number
  parsing with field errors; estimated cost/proceeds including the house spread; available cash/shares
  and quick-size buttons; one submit in flight at a time; real order status in the confirmation.
- No more refresh storm (8 × 3 requests per order plus one refresh per market-wide trade); data refreshes
  once per relevant event. My orders have their own Cancel button; your orders are marked in the book.
- Portfolio no longer shows a full loss for a symbol without a live price, hides closed positions and
  refreshes when your orders fill. Account shows one consistent balance, keeps unsaved profile edits,
  and the photo cropper's wheel zoom and file re-pick work.
- Number formatting: grouped thousands everywhere, magnitude-aware price precision, no `-$0.00`, quantities
  up to 8 decimals, consistent `en-US` locale.
- Symbol page: real candles with working 1m/5m/15m/1H intervals, correct precision for sub-dollar coins,
  resize handling, and Buy/Sell buttons that open the ticket preset.
- Dialogs: focus trap, Escape to close, proper positioning (portal), screen-reader semantics.

### Changed — UI/UX
- New design system: dark (default) and light themes with a no-flash toggle, contrast-checked tokens
  (WCAG AA), Inter + JetBrains Mono (self-hosted) with tabular figures, a 4 px spacing grid, Lucide icons.
- Dashboard is now a trading terminal: markets watchlist with sparklines, instrument header, candlestick
  chart, positions/orders/history/tape blotter, order ticket, depth-bar order book, price alerts.
- Live ticker strip, connection status and cash balance in the top bar; responsive layouts down to 375 px.
- Leaderboard: podium for the top three, "your rank" card with the distance to #1, sortable/filterable
  rankings with win-rate bars and P&L sparklines, richer trader detail.
- Portfolio: equity hero, allocation bar, holdings with weight/return/realized P&L, cash activity ledger.
- Account: two-column settings with a verification stepper; sign-in/register pages with a live market panel.

### Added
- `GET /api/market/candles?symbol=&interval=1m|5m|15m|1h&limit=` — OHLC candles (6 h back-filled at boot).
- Session open price and change % on `/topic/prices` and `/api/market/prices`.
- `deploy/` — Helm chart and Makefile for minikube and OrbStack Kubernetes (docker compose remains the
  quick path); `test/trading_integrity.py` — business-logic regression suite.
- `docs/security-events.md` — the full security-events catalog (73 events + 43 not applicable).
- Host ports in the compose files are configurable (`FRONTEND_PORT`, `BACKEND_PORT`, `ADMINER_PORT`,
  `DEBUG_PORT`, `JMX_PORT`).
- Security events from background work (the market maker) carry `transport: "SYSTEM"`; engine cancels
  log `initiator: "system"` so they don't look like IDOR cancels.

## [0.5.5] — 2026-10-09
- Vulnerability optimizations: hardened input controls where documented, refreshed the vulnerability
  inventory and exploit matrix (#18).

## [0.5.4] — 2026-10-09
- Security logging: structured `security.log` with lower_snake event names and categories, Wazuh
  decoders and rules, log shipping (#17).

## [0.5.3] — 2026-10-08
- Production updates (#16).

## [0.5.2] — 2026-04-23
- Production updates: logging, log shipping, documentation (#14, #15).

## [0.5.1] — 2026-04-06
- CI/CD: Docker image builds, automatic version tags; license (#13).

## [0.5.0] — 2026-04-05
- Log4Shell over WebSocket RCE path (#12).

## [0.4.1] — 2026-04-04
- Documentation and minor bug fixes (#11).

## [0.4.0] — 2026-04-03
- Leaderboard (#10).

## [0.3.4] — 2026-04-03
- Leaderboard (initial tag) (#10).

## [0.3.3] — 2026-04-02
- Navigation and pages refactor (#9).

[0.6.0]: https://github.com/0xj4f/vulntrade/compare/0.5.5...0.6.0
[0.5.5]: https://github.com/0xj4f/vulntrade/compare/0.5.4...0.5.5
[0.5.4]: https://github.com/0xj4f/vulntrade/compare/0.5.3...0.5.4
[0.5.3]: https://github.com/0xj4f/vulntrade/compare/0.5.2...0.5.3
[0.5.2]: https://github.com/0xj4f/vulntrade/compare/0.5.1...0.5.2
[0.5.1]: https://github.com/0xj4f/vulntrade/compare/0.5.0...0.5.1
[0.5.0]: https://github.com/0xj4f/vulntrade/compare/0.4.1...0.5.0
[0.4.1]: https://github.com/0xj4f/vulntrade/compare/0.4.0...0.4.1
[0.4.0]: https://github.com/0xj4f/vulntrade/compare/0.3.4...0.4.0
[0.3.4]: https://github.com/0xj4f/vulntrade/compare/0.3.3...0.3.4
[0.3.3]: https://github.com/0xj4f/vulntrade/releases/tag/0.3.3
