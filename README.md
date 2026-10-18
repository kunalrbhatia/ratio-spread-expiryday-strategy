# Algo-Trading Skeleton (Angel One SmartAPI)

A modular, production-ready algo-trading skeleton built for Angel One SmartAPI using TypeScript, Node 22, and PM2.

This repository provides all execution infrastructure (authentication, throttling, WebSocket feeds, position persistence, real-time stop-loss monitoring, multi-leg emergency exits, MTM logging, health endpoints, and Telegram alerts) while keeping strategies completely decoupled through a clean seam in `src/strategy/`.

---

## Features & Infrastructure

- **SmartAPI Authentication**: Automated login with TOTP (`src/helpers/login.ts`).
- **Synchronized API Queue**: 1000ms rate-limit throttle, backoff retries, 8s timeout, order placement excluded from blind retries, dynamic public/local IP and MAC headers (`src/helpers/api.ts`).
- **SmartStream V2 WebSocket**: Correct binary packet parsing (token bytes 2–27, LTP bytes 43–50), raw JWT headers, auto-reconnect with session refresh, and paper-mode mock tick generator (`src/helpers/websocket.ts`).
- **Configurable Holidays & Schedules**: Trading calendar loaded from `data/holidays.json` with backward holiday shift detection and loud missing-year alerts (`src/helpers/holidayCheck.ts`).
- **Position Tracking & Monitoring**: Individual position files per symbol, per-leg fill confirmations, `isExiting` re-entrancy lock, manual intervention emergency alerts (`src/jobs/monitorJob.ts`).
- **Configurable Stop-Loss**: Configurable SL percentage (`STOP_LOSS_PERCENT`, default: 1% of entry margin) with custom strategy overrides.
- **Safety Flags**: Non-blocking Paper Mode (`.paper`), Entry Kill Switch (`.kill`), and All-Halt Panic Switch (`.panic`) (`src/helpers/modeManager.ts`).
- **Telegram Bot & Alerts**: Authorized Telegram bot (`/status`, `/paper`, `/kill`, `/panic`, `/update`, `/logs`), Slack webhook support, and Express `/health` monitoring route.
- **SmartAPI Quirks Cataloged**: See [docs/smartapi-quirks.md](docs/smartapi-quirks.md).

---

## Project Structure

```text
├── src/
│   ├── config/env.ts              # Strongly typed environment configuration
│   ├── helpers/
│   │   ├── api.ts                 # Axios wrapper, 1s throttle, retries, headers
│   │   ├── constants.ts           # INDEX_CONFIGS (NIFTY, SENSEX, BANKNIFTY)
│   │   ├── holidayCheck.ts        # Trading calendar and holiday verification
│   │   ├── logger.ts              # Winston daily-rotate log manager
│   │   ├── login.ts               # SmartAPI password & TOTP login
│   │   ├── marketData.ts          # Spot quotes, ATM strike, batch option LTPs
│   │   ├── modeManager.ts         # Paper / Kill / Panic flag managers
│   │   ├── orders.ts              # SmartAPI order placement & batch margin API
│   │   ├── scripMaster.ts         # Scrip master downloader & contract cache
│   │   └── websocket.ts           # SmartStream client (real & mock ticks)
│   ├── jobs/
│   │   ├── entryJob.ts            # Entry orchestrator (delegates to Strategy)
│   │   ├── monitorJob.ts          # Tick router, P&L, SL check, exit executor
│   │   └── mtmLogger.ts           # 1-minute MTM snapshot logger
│   ├── store/
│   │   ├── positionStore.ts       # Position persistence per instrument
│   │   └── sessionStore.ts        # SmartAPI JWT and feed token memory store
│   ├── strategy/
│   │   ├── Strategy.ts            # Strategy interface definition
│   │   ├── ExampleStrategy.ts     # Reference stub with clear TODOs
│   │   └── index.ts               # Strategy registry & active loader
│   ├── main.ts                    # Bootstrap and cron scheduler
│   ├── notifier.ts                # Telegram & Slack notification dispatcher
│   └── server.ts                  # Express health endpoint
├── data/
│   └── holidays.json              # Configurable NSE trading holidays by year
├── docs/
│   ├── smartapi-quirks.md         # Reference of known Angel One SmartAPI nuances
│   └── using-this-template.md     # GitHub template setup and upstream sync guide
└── __tests__/                     # Unit & integration tests
```

---

## Quick Start

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```
Fill in your Angel One credentials in `.env`:
```ini
API_KEY=your_smartapi_key
CLIENT_CODE=your_client_code
CLIENT_PIN=your_client_pin
CLIENT_TOTP_PIN=your_totp_seed
STRATEGY=example
PAPER_MODE=true
```

### 3. Run in Paper Mode
The repository ships with `.paper` mode enabled by default. No real orders are placed.
```bash
pnpm dev
```

Check system status at `http://localhost:3000/health`.

---

## Environment Variables Reference

| Variable | Description | Default | Required |
|---|---|---|---|
| `STRATEGY` | Active strategy name from `src/strategy/` | `example` | Yes |
| `PAPER_MODE` | Default to mock paper trading | `true` | Yes |
| `PORT` | Express health route port | `3000` | No |
| `NODE_ENV` | Environment (`development` / `production`) | `development` | No |
| `STOP_LOSS_PERCENT` | Default stop loss percentage of margin | `1.0` | No |
| `API_KEY` | Angel One SmartAPI API key | - | Yes (Live) |
| `CLIENT_CODE` | Angel One client code | - | Yes (Live) |
| `CLIENT_PIN` | Angel One account PIN | - | Yes (Live) |
| `CLIENT_TOTP_PIN` | TOTP secret key for login generation | - | Yes (Live) |
| `USE_TELEGRAM` | Enable Telegram alert notifications | `false` | No |
| `TELEGRAM_BOT_TOKEN`| Telegram Bot Token | - | If Telegram on |
| `TELEGRAM_CHAT_ID` | Telegram authorized user ID | - | If Telegram on |
| `USE_SLACK` | Enable Slack notifications | `false` | No |
| `SLACK_WEBHOOK_URL` | Incoming webhook URL for Slack | - | If Slack on |

---

## Writing a New Strategy

All strategy logic is isolated inside `src/strategy/`. To add a strategy:

### Step 1: Create `src/strategy/MyStrategy.ts`
Implement the `Strategy` interface from `src/strategy/Strategy.ts`:

```typescript
import {
  Strategy,
  StrategyContext,
  StrategyExitDecision,
  StrategySchedule,
} from './Strategy.js';
import { OptionLeg } from '../store/positionStore.js';
import { TickData } from '../helpers/websocket.js';
import { getSpotLtp, getATMStrike, findATMContracts } from '../helpers/marketData.js';
import { INDEX_CONFIGS, SupportedIndex } from '../helpers/constants.js';

export class MyStrategy implements Strategy {
  public readonly name = 'my-strategy';
  public readonly instruments = ['NIFTY'];

  public readonly schedule: StrategySchedule = {
    entryTime: '09:20',
    exitTime: '15:27',
    scripMasterTime: '08:30',
    weekdays: [1, 2, 3, 4, 5],
  };

  public async shouldRunToday(symbol: string, date: Date): Promise<boolean> {
    return true; // or your custom indicator/expiry logic
  }

  public async entry(ctx: StrategyContext): Promise<OptionLeg[] | null> {
    const config = INDEX_CONFIGS[ctx.symbol as SupportedIndex];
    const spot = await getSpotLtp(ctx.symbol);
    const atmStrike = getATMStrike(spot, config.strikeStep);
    const { ce } = findATMContracts(ctx.symbol, atmStrike);

    // Return the legs created
    return [
      {
        symbol: ce.symbol,
        token: ce.token,
        entryPremium: 150,
        qty: config.lotSize,
        type: 'CE',
        direction: 'BUY',
      },
    ];
  }

  public async onTick(
    ctx: StrategyContext,
    tick: TickData,
    currentPnL: number,
  ): Promise<StrategyExitDecision | null> {
    if (currentPnL >= 2500) {
      return { shouldExit: true, reason: 'Take Profit of ₹2,500 hit' };
    }
    return null;
  }

  public computeStopLoss(entryMargin: number): number {
    return entryMargin * 0.01; // 1% stop loss
  }
}
```

### Step 2: Register in `src/strategy/index.ts`
```typescript
import { MyStrategy } from './MyStrategy.js';

registerStrategy(new MyStrategy());
```

### Step 3: Run Strategy
Set `STRATEGY=my-strategy` in your `.env`.

---

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Run daemon in local development with `tsx` |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run compiled daemon with Node |
| `pnpm test` | Run all Jest unit and integration tests |
| `pnpm verify` | Run full pre-commit pipeline (typecheck, lint, format check, tests, build) |
| `pnpm lint` | Run ESLint across TypeScript source files |
| `pnpm format` | Auto-format files with Prettier |

---

## Template Workflow & Maintenance

Refer to [docs/using-this-template.md](docs/using-this-template.md) for instructions on creating new strategy repositories from this template and pulling subsequent core engine updates.
