## Liquidity Provider & House Market Maker

> **1.0.0:** trading moved out of the single backend. This page describes the engine that now lives in
> **equities-internals** (XSIM, with holds and commission); crypto has its own exchange and FX is a dealer.
> Start with [architecture.md](architecture.md).

**Files:** `backend/src/main/java/com/vulntrade/service/LiquidityProviderService.java`,
`HouseMarketMakerService.java`, `MatchingEngineService.java`

The house (user 1, `admin`) is the market maker. It does three things:

1. **Fills what the book can't** — MARKET orders and marketable LIMIT orders.
2. **Sweeps crossed limits** — once a second, any resting user LIMIT order that the live price has
   crossed is filled at its limit price.
3. **Quotes a ladder** — five price levels per side around the live price, re-quoted every 2 seconds
   (or immediately when the ladder falls behind the price).

Every house fill goes through the same settlement as a user fill (see
[order-flow.md § Settlement](order-flow.md#settlement)): the house never sells shares it doesn't hold or
spends cash it doesn't have, and the trader's side is checked the same way.

### Prices

| Trader side | House price | Example (ask 178.55 / bid 178.45) |
|---|---|---|
| BUY | ask × (1 + spread) | 178.55 × 1.0001 = **178.5679** |
| SELL | bid × (1 − spread) | 178.45 × 0.9999 = **178.4322** |

`liquidity.spread-percent` (default `0.01`, i.e. 0.01 %). Live bid/ask come from the `symbols` table,
which the price simulator updates every second (0.1 % bid/ask spread around the last price).

A **marketable LIMIT** fills at the better of its limit and the house price: a BUY limit of 180 with the
ask at 178.55 pays 178.5679, not 180.

### Order of execution for an incoming order

```
book (best price first, maker's price)  →  house fill for what's left  →  remainder:
                                                                         LIMIT rests · MARKET cancelled (NO_LIQUIDITY)
```

### The ladder

| | |
|---|---|
| Levels | 5 per side, tagged `HOUSE-MM-<symbol>-<BUY|SELL>-<0..4>` (owned by user 1) |
| Best ask / bid | the house prices above (ask × 1.0001, bid × 0.9999) |
| Step | 5 bps of price between levels (at least one tick) |
| Size per level | 2 % of the house position (asks); bids also capped at 0.2 % of house cash per level |
| Re-quote | in place (same order ids, time priority reset); missing levels (filled, or cancelled by someone through the IDOR) are replaced; never re-uses filled rows |
| Skipped | halted symbols; **VULN** (keeps a static seeded ladder) |

Because ladders follow the live price, there is no stale book to arbitrage against the house's own
fills — except VULN, whose static ladder (~100.05 ask / 99.95 bid, 20,000 per level) against a
predictable 80–120 sine is part of the predictable-price lesson.

### House inventory (seed)

| Symbol | Position | Symbol | Position |
|---|---:|---|---:|
| AAPL, GOOGL, MSFT, TSLA, AMZN | 100,000 each | SOL-USD | 50,000 |
| BTC-USD | 10,000 | DOGE-USD | 50,000,000 |
| ETH-USD | 100,000 | NVDA | 50,000 |
| VULN | 1,000,000 | XRP-USD | 10,000,000 |
| AVAX-USD | 200,000 | PEPE-USD | 999,999,999 |
| GME | 500,000 | Cash | $1,000,000,000 |

Inventory is finite and moves with trading; it is not replenished.

### Configuration

```yaml
liquidity:
  enabled: true          # false = no house fills, sweeps or ladders
  house-user-id: 1
  spread-percent: 0.01
```

### Design decisions

| Decision | Choice | Why |
|---|---|---|
| Spread | 0.01 % | A visible, realistic cost of immediacy |
| MARKET orders | always try the house after the book | A trader can always get out |
| MARKET remainder | cancelled, never rests | A resting MARKET order would trade later at a stale price |
| LIMIT orders | rest; the house fills them when the price crosses | The normal maker outcome — no waiting for another trader |
| Self-fill | the house never fills its own orders | — |
| Security events | `trade_executed` from sweeps carries `initiator: system` and `transport: SYSTEM` | Background fills are distinguishable in the SIEM |

### New trader flow

1. Register (start with $10,000) → buy at market: the book's best asks are the house ladder, so the fill
   is immediate at ~ask + 0.01 %.
2. Place a LIMIT BUY below the market → it rests; when the price drops to it, the house fills it and
   the order update arrives on `/user/queue/order-updates`.
3. Sell at market → the house buys at ~bid − 0.01 %.
