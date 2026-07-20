# Antigravity CLI Prompt — Bid/Ask-Based Exit Pricing & P&L

You are generating a detailed implementation plan and code changes for two interconnected algo trading repos. The goal is to replace **LTP-based pricing** with **bid/ask-based pricing** for exit orders and P&L calculations.

---

## Background

The current code uses **LTP (Last Traded Price)** everywhere:
- Exit LIMIT orders are priced relative to LTP
- Real-time P&L is calculated using LTP
- Market data fetches only LTP (mode: 'LTP')

This causes real problems:
1. **Exit orders fail to fill** — LIMIT sell priced above ask never executes (e.g., sell at ₹119.20 when ask is ₹110.50)
2. **P&L is misleading** — shows +₹2,679 but actual exit at bid would yield -₹1,185 (₹3,864 difference)
3. **Stop-loss/Profit-target may fire prematurely or too late** — because they're based on LTP, not executable price

## Architecture

### Current flow:
```
getOptionLtps(mode: 'LTP') → { ltp: number }
        ↓
Exit logic: LIMIT price = LTP * 0.97 (or similar)
P&L calc:   (ltp - entry) * qty
```

### Desired flow:
```
getOptionQuotes(mode: 'QUOTE') → { ltp, bid, ask, bidQty, askQty }
        ↓
Exit logic: SELL at bid × 0.997, BUY at ask × 1.003
P&L calc:   use mid-price (bid+ask)/2 for fair value
            use bid for long legs, ask for short legs for conservative P&L
```

---

## Repos to modify

### Repo 1: `ratio-spread-expiryday-strategy` (Nifty/SENSEX)
GitHub: `kunalrbhatia/ratio-spread-expiryday-strategy`
Structure: TypeScript, compiled to `dist/`, runs as PM2 daemon

### Repo 2: `ubiquitous-algo` (Bank Nifty monthly calendar spread)
GitHub: `kunalrbhatia/ubiquitous-algo`
Structure: TypeScript, compiled to `dist/`, run-and-exit via system cron

---

## Detailed changes

### Change 1 — Market data: add `getOptionQuotes()` (both repos)

**File:** `src/helpers/marketData.ts` (repo 1) / `src/execution/brokerClient.ts` (repo 2)

Add a new function that fetches bid/ask alongside LTP:

```typescript
export interface OptionQuote {
  symbolToken: string;
  ltp: number;
  bid: number;
  ask: number;
  bidQty: number;
  askQty: number;
}

// Uses mode: 'QUOTE' instead of mode: 'LTP'
export async function getOptionQuotes(
  tokens: string[],
  exchange: string   // e.g. 'NFO' or 'BFO'
): Promise<Map<string, OptionQuote>> {
  const response = await apiRequest({
    method: 'POST',
    url: `${BASE_URL}/rest/secure/angelbroking/market/v1/quote`,
    data: {
      mode: 'QUOTE',
      exchangeTokens: {
        [exchange]: tokens,
      },
    },
  });

  const quoteMap = new Map<string, OptionQuote>();
  if (response.status === true && response.data?.fetched) {
    for (const item of response.data.fetched) {
      const depth = item.depth;
      quoteMap.set(item.symbolToken, {
        symbolToken: item.symbolToken,
        ltp: parseFloat(item.ltp),
        bid: depth?.buy?.[0]?.price ? parseFloat(depth.buy[0].price) : parseFloat(item.ltp),
        ask: depth?.sell?.[0]?.price ? parseFloat(depth.sell[0].price) : parseFloat(item.ltp),
        bidQty: depth?.buy?.[0]?.quantity ? parseInt(depth.buy[0].quantity) : 0,
        askQty: depth?.sell?.[0]?.quantity ? parseInt(depth.sell[0].quantity) : 0,
      });
    }
  }
  return quoteMap;
}
```

For the Bank Nifty repo, add a similar method in `brokerClient.ts`:
```typescript
async getMarketDataBatch(exchange: string, tokens: string[]): Promise<Map<string, OptionQuote>>
```

### Change 2 — P&L calculation: use mid-price (both repos)

**File:** `src/jobs/monitorJob.ts` (repo 1) and `src/execution/executionManager.ts` (repo 2)

Update the P&L calculation to use mid-price when available:

```typescript
export function getLegPnl(
  direction: 'BUY' | 'SELL',
  entryPremium: number,
  quote: OptionQuote,
  qty: number
): number {
  // Use executable price (bid for sells, ask for buys) for conservative P&L
  const executablePrice = direction === 'BUY'
    ? (quote.bid > 0 ? quote.bid : quote.ltp)     // if we sold now, we get bid
    : (quote.ask > 0 ? quote.ask : quote.ltp);     // if we buy now, we pay ask

  if (direction === 'BUY') {
    return (executablePrice - entryPremium) * qty;
  } else {
    return (entryPremium - executablePrice) * qty;
  }
}
```

For monitoring/display P&L, use **mid-price** (fair value):
```typescript
export function getFairPnl(
  direction: 'BUY' | 'SELL',
  entryPremium: number,
  quote: OptionQuote,
  qty: number
): number {
  const midPrice = (quote.bid > 0 && quote.ask > 0)
    ? (quote.bid + quote.ask) / 2
    : quote.ltp;

  if (direction === 'BUY') return (midPrice - entryPremium) * qty;
  else return (entryPremium - midPrice) * qty;
}
```

### Change 3 — Exit pricing: use bid/ask per side (both repos)

**File:** `src/jobs/exitAllPositions` in `monitorJob.ts` (repo 1) and `executeExit` in `executionManager.ts` (repo 2)

Replace LIMIT price calculation:

```typescript
// OLD: limit price based on LTP
const limitPrice = ltp * 0.97;

// NEW: limit price based on market side
function getExitLimitPrice(quote: OptionQuote, direction: 'BUY' | 'SELL'): number {
  const TICK = 0.05; // Angel One minimum tick

  if (direction === 'SELL') {
    // Selling to close a LONG position → price near bid
    return quote.bid > 0 ? Math.round((quote.bid - TICK) / TICK) * TICK : quote.ltp;
  } else {
    // Buying to close a SHORT position → price near ask
    return quote.ask > 0 ? Math.round((quote.ask + TICK) / TICK) * TICK : quote.ltp;
  }
}
```

### Change 4 — WebSocket: parse bid/ask from binary stream (repo 1)

**File:** `src/helpers/websocket.ts`

The SmartStream binary protocol includes depth data. Extend the parser:

```typescript
// Current: extracts token + ltp
const token = tokenBuffer.toString('utf8').replace(/\0/g, '').trim();
const ltp = Number(data.readBigInt64LE(43)) / 100;

// Also extract best bid/ask from the QUOTE packet (type 2)
// SmartStream packet type 2 (QUOTE) has:
// Byte 43-50: LTP (8 bytes, BigInt64LE / 100)
// Byte 51-58: Last Traded Qty
// Byte 59-66: Avg Traded Price
// Byte 67-74: Volume
// Byte 75-78: Total Buy Qty
// Byte 79-82: Total Sell Qty
// Byte 83-86: Open Interest
// Byte 87-90: Change OI
// Best Bid:  Byte 91-94 (4 bytes, Int32LE / 100)
// Best Ask:  Byte 95-98 (4 bytes, Int32LE / 100)
```

### Change 5 — Position Store: add bid/ask fields (both repos)

**File:** `src/store/positionStore.ts` (repo 1) and `src/positions/positionsStore.ts` (repo 2)

```typescript
export interface OptionLeg {
  // ... existing fields ...
  currentPrice?: number;
  currentBid?: number;    // NEW
  currentAsk?: number;    // NEW
}
```

Update the WebSocket handler and tick processor to populate these:
```typescript
export const handleIncomingTick = async (tick: TickData) => {
  // ... existing code ...
  for (const leg of positions.legs) {
    if (leg.token === tick.token) {
      leg.currentPrice = tick.ltp;
      leg.currentBid = tick.bid;    // NEW
      leg.currentAsk = tick.ask;    // NEW
      store.updateLegPrice(tick.token, tick.ltp);
    }
  }
};
```

### Change 6 — P&L Checker Cron (Hermes)

The existing Hermes cron job (`pnl-checker`, job_id: `fba5a6d72054`) should be updated to:

1. Fetch QUOTE mode data (bid/ask) instead of LTP mode
2. Display **mid-price P&L** as the primary number
3. Display **bid/ask prices** alongside the spot price
4. Add a note like `(spread: ₹X.X)` when spread is unusually wide

---

## SmartAPI Reference

### Quote endpoint (QUOTE mode)
```
POST /rest/secure/angelbroking/market/v1/quote
{
  "mode": "QUOTE",
  "exchangeTokens": {
    "NFO": ["61947", "61834", "59254", "58975"]
  }
}
```

Response includes `depth.buy[0].price`, `depth.buy[0].quantity`, `depth.sell[0].price`, `depth.sell[0].quantity`.

### SmartStream WebSocket QUOTE packet (type 2)
- Byte 0: Subscription mode (2 = QUOTE)
- Byte 1: Exchange type
- Bytes 2-26: Token (25 bytes)
- Bytes 27-34: Sequence number
- Bytes 35-42: Exchange timestamp
- Bytes 43-50: LTP (BigInt64LE, paise → divide by 100)
- Bytes 91-94: Best Bid (Int32LE, paise → divide by 100)
- Bytes 95-98: Best Ask (Int32LE, paise → divide by 100)

---

## Testing Strategy

| Test | What to verify |
|------|---------------|
| `getOptionQuotes` returns bid/ask correctly | Mock API response with depth data |
| Mid-price P&L is accurate | Compare against LTP-only P&L |
| Exit LIMIT price uses correct side | SELL → near bid, BUY → near ask |
| Fallback when no depth exists | Uses LTP when bid/ask = 0 |
| WebSocket parses bid/ask from binary | Mock binary buffer with known bytes |

---

## Implementation Order

1. Add `getOptionQuotes()` to both repos
2. Add bid/ask fields to `OptionLeg` and position store
3. Update P&L calculation in monitoring to use mid-price
4. Update exit limit pricing to use bid/ask
5. Update Hermes P&L checker cron to show bid/ask
6. Update WebSocket binary parser to extract bid/ask

---

## Output

Write the complete modified files for both repos into `/tmp/bidask-fix/`. Include:
- `ratio-spread/` — modified files from repo 1
- `ubiquitous-algo/` — modified files from repo 2
- `README.md` — summary of changes and migration guide

Do NOT modify files not listed above. Preserve all existing code — only change the specific functions and interfaces described.
