# Order Flow

> How an order travels through VulnTrade, from the order ticket to settlement and notifications
> (0.6.0). Source: `OrderService`, `RiskService`, `MatchingEngineService`,
> `LiquidityProviderService`, `HouseMarketMakerService`, `MatchingCoordinator`, `TradingEvents`.
> The intentional business-logic vulnerabilities are listed at the end — they are part of the lab.

## Contents

1. [Overview](#overview)
2. [Placing an order](#placing-an-order)
3. [Matching](#matching)
4. [Settlement](#settlement)
5. [The house: liquidity and market making](#the-house-liquidity-and-market-making)
6. [Cancels](#cancels)
7. [Notifications](#notifications)
8. [Worked example](#worked-example)
9. [Behaviour summary](#behaviour-summary)
10. [Intentional business-logic vulnerabilities](#intentional-business-logic-vulnerabilities)

---

## Overview

| Component | Responsibility |
|---|---|
| `OrderService` | Validates the request, runs the risk check, saves the order, asks the engine to match it |
| `RiskService` | Pre-trade check: quantity, price, symbol, buyer cash (BUY), seller shares (SELL). Advisory — nothing is reserved |
| `MatchingEngineService` | Matches against the book, settles each fill, closes or rests the remainder |
| `LiquidityProviderService` | Prices house fills (touch ± 0.01 % spread) and records the house's side of a fill |
| `HouseMarketMakerService` | Every second: fills resting LIMIT orders the price has crossed; re-quotes the house ladder |
| `MatchingCoordinator` | One global lock + one transaction around every book change |
| `TradingEvents` | After commit: order updates to owners, trades, order-book broadcasts |

**Order statuses:** `NEW` → `PARTIAL` → `FILLED`, or `CANCELLED` (with an optional `statusReason`:
`INSUFFICIENT_FUNDS`, `INSUFFICIENT_POSITION`, `NO_LIQUIDITY`).

Orders arrive over STOMP (`/app/trade.placeOrder`, `/app/trade.executeMarket`) or REST
(`POST /api/orders`); both go through `OrderService.placeOrder`.

## Placing an order

1. **Normalise and validate** — side must be `BUY`/`SELL`, type `LIMIT`/`MARKET` (a missing type means
   MARKET without a price, LIMIT with one), quantity and price at most 8 decimals. A rejection is sent to
   `/user/queue/errors` and logged as `order_rejected`.
2. **Take the matching lock** (`MatchingCoordinator`): one fair global lock, then one transaction. All
   reads after this point are fresh.
3. **MARKET price** — if none was sent, the live ask (BUY) or bid (SELL) is used. A client-supplied
   MARKET price is kept and caps book matching (vuln #45).
4. **Halt check** — a halted symbol rejects every order type.
5. **Risk check** (`RiskService.checkPreTrade`) — quantity > 0, price > 0 for LIMIT, known tradable
   symbol, buyer cash ≥ quantity × price (MARKET BUY uses the house fill price, ask + spread), seller
   shares ≥ quantity. **Nothing is reserved**: several open orders may together exceed the balance.
6. **Save** the order as `NEW`, log `order_created`, then **match**.

## Matching

`MatchingEngineService.match(order)`:

1. Load the opposite side's open LIMIT orders for the symbol, best price first, then oldest first.
2. Walk the book while the incoming price crosses: BUY ≥ ask, SELL ≤ bid. Each fill is
   `min(remaining, resting remaining)` at the **resting (maker) price** and goes through
   [settlement](#settlement).
3. **House liquidity** for what is left:
   - MARKET → the house fills at ask × 1.0001 (BUY) or bid × 0.9999 (SELL);
   - a **marketable LIMIT** (BUY limit ≥ ask, SELL limit ≤ bid) → the house fills at the better of the
     limit and its own price;
   - the house fills as much as its inventory (sells) or cash (buys) allows.
4. **Remainder:** a LIMIT order rests (`NEW` or `PARTIAL`); a MARKET order is cancelled with
   `NO_LIQUIDITY`; an order whose owner couldn't cover a fill is cancelled with the shortfall reason.

The reply carries the final `status`, `filledQty`, `avgFillPrice` (volume-weighted across every fill),
`remainingQty` and `reason`.

## Settlement

Each fill settles inside the transaction, with conditional SQL so a balance or position can never go
below zero:

| Step | Statement |
|---|---|
| Seller holds the shares? | `SELECT quantity …` (positions only change under the lock) |
| Debit buyer | `UPDATE users SET balance = balance - :v WHERE id = :buyer AND balance >= :v` |
| Take shares from seller | `UPDATE positions … quantity = quantity - :q, realized_pnl += (:price - avg_price) × :q … WHERE quantity >= :q` |
| Credit seller | `UPDATE users SET balance = balance + :v` |
| Give shares to buyer | `INSERT … ON CONFLICT (user_id, symbol) DO UPDATE` (weighted average cost) |

- If the **resting** order's owner can't cover the fill, that order is cancelled
  (`INSUFFICIENT_FUNDS` / `INSUFFICIENT_POSITION`) and matching moves to the next level.
- If the **incoming** order's owner can't cover it, matching stops and the remainder is cancelled.
- Each fill writes one `trades` row and two ledger rows (`TRADE_BUY` −value, `TRADE_SELL` +value), so a
  balance always equals the sum of its transactions.
- **Wash trades** (#62): when both sides belong to the same user the trade and both ledger rows are
  recorded (`selfTrade=true`) but cash and shares net to zero.
- Realized P&L is booked on every sell against the average cost; the average resets when a position
  closes.

## The house: liquidity and market making

The house is user 1 (`admin`), with $1 B of cash and large positions. See
[liquidity-provider.md](liquidity-provider.md) for prices, ladders and inventory. In short:

- **Sweep** (every second): resting user LIMIT orders that the live quote now crosses are filled by the
  house at their limit price — a limit order no longer waits for another trader.
- **Re-quote** (every 2 s, or at once when its quotes fall behind the price): a 5-level ladder per side,
  tagged `HOUSE-MM-<symbol>-<side>-<level>`, re-priced in place around the live quote.
- **VULN** keeps a static seeded ladder (~100.05 / 99.95) while its price follows a predictable sine.

## Cancels

`/app/trade.cancelOrder` and `POST /api/orders/{id}/cancel` → `OrderService.cancelOrder`, under the same
lock: an open order becomes `CANCELLED`; a filled or already-cancelled one returns
`Order already FILLED|CANCELLED`. There is **no ownership check** (vuln #44). The owner is told through
`/user/queue/order-updates`. `DELETE /api/orders/{id}` hard-deletes an order with no fills (also no
ownership check); one that traded returns `409`.

## Notifications

Sent only after the transaction commits (nothing is sent for a rolled-back attempt):

| Destination | Payload | Audience |
|---|---|---|
| `/user/queue/orders` | `ORDER_PLACED`, `ORDER_CANCELLED`, `MARKET_ORDER_EXECUTED` replies | the caller |
| `/user/queue/errors` | `ERROR` replies | the caller |
| `/user/queue/order-updates` | `ORDER_UPDATE` for every order that changed (fills of resting orders, auto-cancels, IDOR cancels) | the order's owner (by username; never the house) |
| `/topic/trades` | `TradeNotification` (includes buyer/seller ids — vuln #61) | everyone |
| `/topic/orderbook` | open orders of one symbol (ids, user ids, usernames — vuln #60) | everyone |
| `/topic/orderbook/{symbol}` | `{symbol, bids, asks, levels}` | everyone |

## Worked example

GME pinned at 28.50 (bid 28.48575, ask 28.51425); house fills BUY at ask × 1.0001 = 28.51710143.

1. **S** sends MARKET BUY 10 → the house fills 10 @ 28.51710143. S: cash 10,000 − 285.17101430,
   position 10 @ 28.51710143.
2. **S** places LIMIT SELL 6 @ 28.50 → not marketable (28.50 > bid) → rests `NEW`.
3. **B** places LIMIT BUY 4 @ 28.50 → crosses S → fill 4 @ 28.50. B's order `FILLED`; S gets
   `ORDER_UPDATE PARTIAL` (filled 4, remaining 2).
4. **B** places LIMIT BUY 5 @ 28.51 → fills S's last 2 @ 28.50, rests 3 @ 28.51 (`PARTIAL`, avg 28.50);
   S gets `ORDER_UPDATE FILLED`.
5. Result: B cash 9,829.00, position 6 @ 28.50; S position 4 @ 28.51710143, realized P&L
   6 × (28.50 − 28.51710143) = −0.10260858. The book shows B's bid with **remaining** quantity 3.

This scenario (and the settlement, sweep, concurrency and leaderboard cases) is checked by
`test/trading_integrity.py`.

## Behaviour summary

| | MARKET BUY | MARKET SELL | LIMIT BUY | LIMIT SELL |
|---|:---:|:---:|:---:|:---:|
| Side / type / precision validated | ✅ | ✅ | ✅ | ✅ |
| Symbol, quantity > 0, halt | ✅ | ✅ | ✅ | ✅ |
| Price > 0 | — | — | ✅ | ✅ |
| Risk check: cash (BUY) / shares (SELL) | ✅ (incl. spread) | ✅ | ✅ | ✅ |
| Cash / shares **reserved** at placement | ❌ | ❌ | ❌ | ❌ |
| Settlement re-checks cash / shares at fill | ✅ | ✅ | ✅ | ✅ |
| House fills when the book can't | ✅ | ✅ | when marketable | when marketable |
| Rests in the book | never | never | ✅ | ✅ |
| Filled by the house later if the price crosses | — | — | ✅ | ✅ |

## Intentional business-logic vulnerabilities

The validation and settlement fixes close input and accounting gaps; these stay exploitable on purpose:

| Vuln | Where | Ref |
|---|---|---|
| Sign-flip withdrawal (negative = deposit) | `AccountController` withdraw | #50 |
| TOCTOU double-spend on concurrent withdrawals (and a racing withdraw can overwrite a concurrent trade settlement) | withdraw read-check-write, no lock | #43 / #51 |
| Deposit without source verification | deposit endpoint | #52 |
| Wash trading (self-matching) | `MatchingEngineService` (no self-trade guard) | #62 |
| No price band on LIMIT orders | `RiskService` (price > 0 only) | #40 |
| clientOrderId replay | `OrderService` (no uniqueness) | #41 |
| No slippage protection on MARKET orders | client price caps the book; the house fills at its price | #45 |
| IDOR cancel / delete any order | `OrderService.cancelOrder`, `deleteOrder` | #44 |
| Order placed as another user (hidden `userId`) | `TradeStompController.placeOrder` | #71 |
| Market price manipulation (`admin.setPrice` has no authorization) | `AdminStompController` | #58 / BIZ-01 |

(Numbers reference [vulnerabilities.md](vulnerabilities.md).)
