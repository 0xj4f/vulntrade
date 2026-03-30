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
