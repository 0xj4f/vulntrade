# Order Flow Documentation

> Analysis of the trading order lifecycle in VulnTrade.  
> Source files: `OrderService`, `RiskService`, `MatchingEngineService`

---

## Table of Contents

1. [Overview](#overview)
2. [Market Buy Flow (Step-by-Step)](#market-buy-flow)
3. [Market Sell Flow (Step-by-Step)](#market-sell-flow)
4. [Matching Engine: How Orders Get Filled](#matching-engine)
5. [Balance & Position Updates on Fill](#balance--position-updates-on-fill)
6. [Full Example: Trader 1 Buys, Trader 2 Sells](#full-example)
7. [Limit Order Flow](#limit-order-flow)
8. [Key Observations & Issues](#key-observations--issues)

---

## Overview

The order system has four main services:

| Service                      | Responsibility                                     |
|------------------------------|----------------------------------------------------|
| `OrderService`               | Receives order requests, runs risk checks, saves order, triggers matching |
| `RiskService`                | Pre-trade validation (balance, position, symbol checks) |
| `MatchingEngineService`      | Matches buy vs sell orders, executes trades, updates balances & positions |
| `LiquidityProviderService`   | House market maker — guarantees MARKET order fills when no book match exists |

**Order lifecycle:** `NEW` → `PARTIAL` → `FILLED` (or `CANCELLED`)

---

## Market Buy Flow

**Example:** Trader 1 places a MARKET BUY for 0.5 BTC-USD.

### Step 1: `OrderService.placeOrder()` is called

```
userId = 1, type = "MARKET", side = "BUY", symbol = "BTC-USD", quantity = 0.5
```

### Step 2: Halt check — SKIPPED for MARKET orders

The halt check (`priceSimulator.isHalted()`) only runs for `LIMIT` orders.  
Market orders bypass the halt check entirely.

### Step 3: `RiskService.checkPreTrade()` — SKIPPED for MARKET orders

```java
if ("MARKET".equalsIgnoreCase(orderType)) {
    return null;  // no risk check at all
}
```

**This means: NO balance check happens for market orders.**  
The buyer's balance is NOT verified before the order is created.

### Step 4: Order saved to DB with status `NEW`

The order is persisted with the current ask price from the Symbol table.  
For market buys, the price is set to the current `ask` price of the symbol.

### Step 5: `matchingEngine.tryMatch(order)` — immediate matching attempt

The matching engine looks for opposing `SELL` orders with status `NEW` on the same symbol.

- If a matching sell order exists → trade executes immediately
- If no matching sell order exists → order stays as `NEW` in the book

### Step 6: WebSocket notifications sent

- Order status pushed to the user via `/queue/orders`
- Order book broadcast updated via `/topic/orderbook`

### What happens to Trader 1's balance at this point?

**NOTHING.** The balance is only deducted when the order is **matched and filled** (inside `MatchingEngineService.executeTrade()`). If there's no opposing sell order, the buy order sits in the book with status `NEW` and the trader's balance is untouched.

---

## Market Sell Flow

**Example:** Trader 2 places a MARKET SELL for 0.5 BTC-USD.

### Step 1–4: Same as buy flow

- Halt check: SKIPPED (market order)
- Risk check: SKIPPED (market order)
- **No check that Trader 2 actually owns 0.5 BTC.** The `RiskService` has no sell-side validation at all:

```java
// VULN: No risk checks for SELL side
// (could sell shares you don't own - naked short selling)
```

- Order saved with current `bid` price from Symbol table

### Step 5: Matching attempt

The engine looks for opposing `BUY` orders with status `NEW`.  
If Trader 1's buy order from above exists, it will match.

---

## Matching Engine

### How `tryMatch()` works

```
1. Find all opposing orders: same symbol, opposite side, status = "NEW"
2. Sort by price-time priority:
   - Buy incoming  → match against LOWEST sell prices first
   - Sell incoming → match against HIGHEST buy prices first
3. For each opposing order:
   a. Check price compatibility:
      - Buy:  incoming.price >= opposing.price
      - Sell: incoming.price <= opposing.price
   b. Calculate fill quantity = min(remaining incoming, remaining opposing)
   c. Execute trade at the RESTING order's price (the order already in the book)
   d. Subtract fill from remaining quantity
4. Update incoming order status: FILLED / PARTIAL / stays NEW
```

### Price used for execution

The trade always executes at the **resting order's price** (the order that was already in the book), not the incoming order's price.

---

## Balance & Position Updates on Fill

When two orders match, `executeTrade()` does the following **atomically per trade** (but not in a DB transaction):

### 1. Trade record created

```
Trade { buyOrderId, sellOrderId, symbol, quantity, price, executedAt }
```

### 2. Both orders updated

```
filledQty += fillQuantity
filledPrice = execution price
status = "FILLED" if filledQty >= quantity, else "PARTIAL"
```

### 3. Buyer's balance DEDUCTED

```java
tradeValue = quantity * price
buyer.balance = buyer.balance - tradeValue
// Transaction record: type = "TRADE_BUY", amount = -tradeValue
```

### 4. Seller's balance CREDITED

```java
seller.balance = seller.balance + tradeValue
// Transaction record: type = "TRADE_SELL", amount = +tradeValue
```

### 5. Positions updated

**Buyer:** Position quantity increases, average price recalculated  
**Seller:** Position quantity decreases (can go negative — naked short)

---

## Full Example

### Setup
- **Trader 1**: balance = $100,000, no positions
- **Trader 2**: balance = $50,000, no positions
- **BTC-USD**: bid = $64,000, ask = $64,100

### Step 1: Trader 1 places MARKET BUY 0.5 BTC-USD

1. `OrderService.placeOrder(userId=1, MARKET, BUY, BTC-USD, qty=0.5)`
2. Price set to ask: **$64,100**
3. Risk check: **SKIPPED** (MARKET order)
4. Order saved: `{id=1, userId=1, BUY, MARKET, BTC-USD, qty=0.5, price=$64,100, status=NEW}`
5. `tryMatch()` runs → no SELL orders exist → **no match**
6. Order stays `NEW` in the order book
7. **Trader 1 balance: still $100,000** (no deduction yet)

### Step 2: Trader 2 places MARKET SELL 0.5 BTC-USD

1. `OrderService.placeOrder(userId=2, MARKET, SELL, BTC-USD, qty=0.5)`
2. Price set to bid: **$64,000**
3. Risk check: **SKIPPED** (MARKET order)
4. **No check that Trader 2 owns any BTC** (no sell-side validation)
5. Order saved: `{id=2, userId=2, SELL, MARKET, BTC-USD, qty=0.5, price=$64,000, status=NEW}`
6. `tryMatch()` runs → finds Trader 1's BUY order

### Step 3: Match found — trade executes

```
Incoming: SELL @ $64,000
Resting:  BUY  @ $64,100

Price check: sell.price ($64,000) <= buy.price ($64,100) ✓
Fill quantity: min(0.5, 0.5) = 0.5
Execution price: $64,100 (resting order's price — the BUY)
```

Wait — actually, the incoming order is the SELL, and it matches against the resting BUY. The execution price is the **resting** order's price = **$64,100**.

### Step 4: `executeTrade()` runs

```
Trade value = 0.5 × $64,100 = $32,050

Trader 1 (buyer):
  balance: $100,000 - $32,050 = $67,950
  position: BTC-USD qty = +0.5, avgPrice = $64,100
  transaction: TRADE_BUY, amount = -$32,050

Trader 2 (seller):
  balance: $50,000 + $32,050 = $82,050
  position: BTC-USD qty = -0.5 (NEGATIVE — naked short!)
  transaction: TRADE_SELL, amount = +$32,050
```

### Step 5: Both orders marked FILLED

```
Order 1: status=FILLED, filledQty=0.5, filledPrice=$64,100
Order 2: status=FILLED, filledQty=0.5, filledPrice=$64,100
```

### Final State

| Trader   | Balance   | BTC-USD Position |
|----------|-----------|------------------|
| Trader 1 | $67,950   | +0.5 BTC         |
| Trader 2 | $82,050   | -0.5 BTC (short) |

---

## Limit Order Flow

Limit orders follow the same path but with two differences:

### 1. Halt check IS enforced

```java
if ("LIMIT".equalsIgnoreCase(request.getType())) {
    if (priceSimulator.isHalted(request.getSymbol())) {
        throw new RuntimeException("Trading halted for " + request.getSymbol());
    }
}
```

### 2. Risk check IS performed (for BUY side only)

```java
// For LIMIT BUY:
orderValue = quantity × price
if (user.balance < orderValue) → reject "Insufficient balance"

// For LIMIT SELL:
// No check at all — can sell assets you don't own
```

**However:** The balance is only **checked**, not **reserved/locked**. This creates a TOCTOU (Time-of-Check, Time-of-Use) gap — the balance could change between the check and the actual trade execution.

---

## Key Observations & Issues

### 1. Balance is NOT deducted at order placement

Balance is only deducted when the order is **filled** (matched with an opposing order). A market buy order with no opposing sell will sit in the book without affecting the trader's balance.

### 2. No sell-side validation exists

A trader can sell assets they don't own. There is no position check for sell orders. The `RiskService` explicitly skips sell-side checks:

```java
// VULN: No risk checks for SELL side
```

This means Trader 2 can sell 0.5 BTC even with 0 BTC in their position, resulting in a **negative position** (naked short).

### 3. Market orders skip ALL risk checks

The `RiskService.checkPreTrade()` returns `null` (pass) immediately for any `MARKET` order type. No balance check, no position check, nothing.

### 4. Balance check only exists for LIMIT BUY

The only pre-trade validation that exists is: for `LIMIT` orders on the `BUY` side, check that `user.balance >= quantity × price`. That's it. No other combination is validated.

### 5. No balance reservation / locking

Even when the LIMIT BUY balance check passes, the balance is not locked or reserved. A trader could place multiple limit buy orders that each pass the balance check individually but collectively exceed their balance.

### 6. Self-matching is allowed (wash trading)

The matching engine does not check if the buyer and seller are the same user. A single trader can create both a buy and sell order and match with themselves.

### 7. Execution price is always the resting order's price

When a trade matches, the price used is the price of the order that was already in the book (the "maker"), not the incoming order (the "taker").

### Summary Table

| Check                        | MARKET BUY | MARKET SELL | LIMIT BUY | LIMIT SELL |
|------------------------------|:----------:|:-----------:|:---------:|:----------:|
| Halt check                   | ❌         | ❌          | ✅        | ✅         |
| Balance check                | ❌         | ❌          | ✅        | ❌         |
| Position/asset check         | ❌         | ❌          | ❌        | ❌         |
| Balance reservation          | ❌         | ❌          | ❌        | ❌         |
| Balance deducted on fill     | ✅         | N/A         | ✅        | N/A        |
| Balance credited on fill     | N/A        | ✅          | N/A       | ✅         |

---

## Fix Plan: Making VulnTrade a Working Trading App

> While VulnTrade is designed with intentional vulnerabilities, the core trading logic
> must be functional so it can be tested as a real trading application.

### Implemented Fixes

| # | Fix | File |
|---|-----|------|
| 1 | Risk checks for ALL order types (balance, position, symbol, qty) | `RiskService.java` |
| 2 | Halt check for all order types, symbol validation | `OrderService.java` |
| 3 | Prevent negative positions (no naked shorts) | `MatchingEngineService.java` |
| 4 | REST order endpoint routes through OrderService (same validation as WS) | `OrderController.java` |
| 5 | **Liquidity Provider Service** — house market maker for guaranteed MARKET fills | `LiquidityProviderService.java` |
| 6 | House seeded with $1B balance and large positions | `DataInitializer.java` |

### Post-Fix Validation Summary

| Check                        | MARKET BUY | MARKET SELL | LIMIT BUY | LIMIT SELL |
|------------------------------|:----------:|:-----------:|:---------:|:----------:|
| Symbol validation            | ✅         | ✅          | ✅        | ✅         |
| Quantity > 0                 | ✅         | ✅          | ✅        | ✅         |
| Halt check                   | ✅         | ✅          | ✅        | ✅         |
| Balance check (BUY)          | ✅         | N/A         | ✅        | N/A        |
| Position check (SELL)        | N/A        | ✅          | N/A       | ✅         |
| Liquidity provider fill      | ✅         | ✅          | ❌        | ❌         |
| Balance deducted on fill     | ✅         | N/A         | ✅        | N/A        |
| Balance credited on fill     | N/A        | ✅          | N/A       | ✅         |

---

## Liquidity Provider Service

**File:** `backend/src/main/java/com/vulntrade/service/LiquidityProviderService.java`

The liquidity provider acts as the **house / market maker**. It guarantees that
MARKET orders always execute, even when there are no matching orders in the book.

### How It Works

```
Trader places MARKET BUY 10 AAPL
        │
        ▼
  OrderService.placeOrder()
        │  ✓ risk checks pass (balance, symbol, qty)
        ▼
  MatchingEngine.tryMatch()
        │
        ├── Found matching SELL orders in book?
        │       YES → execute trades (price-time priority)
        │       NO  ↓
        │
        └── Remaining unfilled qty > 0 AND order is MARKET?
                │
                ▼
        LiquidityProvider.fillMarketOrder(order, remainingQty)
                │
                ├── Get live price from Symbol table (ask for BUY, bid for SELL)
                ├── Apply spread: 0.01% (configurable)
                │     BUY  → fill at ask × 1.0001  (trader pays slightly more)
                │     SELL → fill at bid × 0.9999  (trader receives slightly less)
                ├── Check house has enough position (for sells to trader)
                ├── Check house has enough balance (for buys from trader)
                ├── Create synthetic house counter-order (status=FILLED)
                └── MatchingEngine.executeTrade() handles the rest
```

### Configuration

In `application.yml`:

```yaml
liquidity:
  enabled: true              # enable/disable the provider
  house-user-id: 1           # user ID of the house account
  spread-percent: 0.01       # 0.01% spread fee on house fills
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Spread fee | **0.01%** (configurable) | Simulates real market maker spread. Variable in config. |
| House balance | **$1,000,000,000** | Large enough for testing. No auto-replenish. |
| House inventory | 100k–1M per symbol | Drains as traders buy. Finite. |
| LIMIT order fill | **No** — book only | LIMIT orders only match real orders. House doesn't fill them. |
| MARKET order fill | **Yes** — guaranteed | The whole point. MARKET orders always execute. |
| Self-fill | **No** | House won't fill its own orders. |
| Price source | **Live bid/ask** from Symbol table | Not the order's stale price. Fresh market data. |

### Spread Calculation Example

Trader places MARKET BUY 10 AAPL. Current ask = $178.55.

```
spread_percent = 0.01
spread_amount  = 178.55 × (0.01 / 100) = $0.017855
fill_price     = 178.55 + 0.017855     = $178.567855

Trade value    = 10 × $178.567855      = $1,785.68
Spread revenue = 10 × $0.017855        = $0.18 (goes to house)
```

Trader places MARKET SELL 10 AAPL. Current bid = $178.45.

```
spread_amount  = 178.45 × (0.01 / 100) = $0.017845
fill_price     = 178.45 - 0.017845     = $178.432155

Trade value    = 10 × $178.432155      = $1,784.32
Spread cost    = 10 × $0.017845        = $0.18 (house keeps the difference)
```

---

## Seeded Order Book (House Inventory)

On startup, the admin/house account is seeded with:
- **$1,000,000,000** cash balance
- Large positions in all tradable symbols
- **5 SELL + 5 BUY limit orders** per symbol at various price levels

This creates a two-sided order book so traders can both buy and sell via the book,
plus the liquidity provider as a backstop for MARKET orders.

### Seeded Symbols & Order Book Depth

| Symbol   | House Position | Orders/Side | Ask Levels (5)                       | Bid Levels (5)                       |
|----------|---------------|-------------|--------------------------------------|--------------------------------------|
| AAPL     | 100,000       | 20,000 each | $178.55 → $178.95                    | $178.35 → $177.95                    |
| GOOGL    | 100,000       | 20,000 each | $141.85 → $142.25                    | $141.65 → $141.25                    |
| MSFT     | 100,000       | 20,000 each | $378.95 → $379.55                    | $378.65 → $378.05                    |
| TSLA     | 100,000       | 20,000 each | $248.60 → $249.40                    | $248.20 → $247.40                    |
| AMZN     | 100,000       | 20,000 each | $178.30 → $178.70                    | $178.10 → $177.70                    |
| BTC-USD  | 10,000        | 2,000 each  | $67,510 → $67,710                    | $67,410 → $67,210                    |
| ETH-USD  | 100,000       | 20,000 each | $3,452 → $3,472                      | $3,442 → $3,422                      |
| VULN     | 1,000,000     | 200,000 each| $42.05 → $42.25                      | $41.95 → $41.75                      |

### MARKET Order Fill Priority

```
1. Match against real orders in the book (price-time priority)
2. If unfilled remainder → LiquidityProviderService fills at live price + 0.01% spread
3. LIMIT orders → book only, no liquidity provider
```

### New Trader Test Flow

1. Register a new account → starts with default balance
2. Place a MARKET BUY for e.g. 10 AAPL
3. Risk check passes (balance ≥ 10 × $178.55 = $1,785.50)
4. Matching engine finds admin's SELL order at $178.55 → trade executes
5. If no book match → liquidity provider fills at $178.57 (ask + 0.01% spread)
6. Position created, balance deducted, order status = FILLED
7. Sell the position → MARKET SELL matches admin's BUY orders or LP fills at bid - spread
