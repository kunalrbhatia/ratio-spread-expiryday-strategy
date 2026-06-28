# Nifty Option Ratio Spread Expiry Strategy — Blueprint

## Strategy Overview

**Weekly Nifty Option Ratio Spread Strategy** — A weekly options trading strategy executed on expiry days to capture premium decay while managing risk with a strict margin-based stop-loss.

The strategy enters positions at **09:20 AM IST** on the weekly expiry day (normally Tuesday, or Monday if Tuesday is a market holiday), and holds until market close (**03:30 PM IST**) or until a strict **1% margin-based stop-loss** is hit.

---

## Strategy Steps & Logic

### 1. Frequency & Expiry Day Identification
* The strategy runs only on weekly expiry days for Nifty options.
* **Regular Expiry**: Tuesday.
* **Holiday Expiry**: If Tuesday is a market holiday, the strategy runs on the previous trading day (Monday).

### 2. Entry (09:20 AM IST)
* **Underlying**: Nifty 50 Index.
* **Lot Size**: 65 shares per lot.
* **Positions**:
  * Buy **1 lot** of At-The-Money (ATM) Call (CE) option.
  * Buy **1 lot** of At-The-Money (ATM) Put (PE) option.
  * *Example*: If Nifty Spot is at 25,000, buy the 25,000 CE and 25,000 PE.
* **Premium Tracking**: Record the exact execution premium paid for both the Call ($P_{CE\_Buy}$) and the Put ($P_{PE\_Buy}$).

### 3. Hedging / Adjustment (Sell Side)
Immediately after entry, execute the sell-side hedges:
* **Call Side**:
  * Target premium: $P_{CE\_Sell} = \frac{P_{CE\_Buy}}{3}$
  * Scan the CE option chain for the strike price with a premium closest to $P_{CE\_Sell}$.
  * Sell **3 lots** of that CE strike.
* **Put Side**:
  * Target premium: $P_{PE\_Sell} = \frac{P_{PE\_Buy}}{3}$
  * Scan the PE option chain for the strike price with a premium closest to $P_{PE\_Sell}$.
  * Sell **3 lots** of that PE strike.

### 4. Position Management
* **Margin Tracking**: Retrieve the total margin utilized for entering the complete position (2 long lots + 6 short lots).
* **Stop-Loss (SL)**: Set at **1% of the total margin** used for the trade.
* **Monitoring**:
  * Monitor the combined net P&L of the entire position continuously.
  * If the net loss reaches or exceeds the 1% margin threshold at any point during the day, **exit all positions immediately** and take no further action for the day.
* **Target Exit**: If the stop-loss is not triggered, hold all positions until **03:30 PM IST** (market close) and square off.

### 5. API Rate Limiting, Throttling & Retries
* **Throttling Constraint**: To prevent API rate limit issues (HTTP 429) and network bottlenecks with Angel One SmartAPI, all outgoing API requests must be throttled to ensure a **minimum gap of 1000 ms** between consecutive API calls.
* **Retry Policy**: Failed requests (due to rate limits or transient network errors) must be retried with **exponential backoff** (e.g., backing off starting at 1s, then 2s, 4s...) up to a **maximum of 3 retries** before failing.
* **Implementation**: The HTTP client wrapper (`src/helpers/api.ts`) should queue/delay requests and implement the retry/backoff mechanism dynamically.

### 6. Daily Log Rotation
* **Logging Requirement**: Logs must be written to separate files for each day.
* **Implementation**: The logger (`src/helpers/logger.ts`) will use Winston with a daily file rotator (e.g., `winston-daily-rotate-file`) to generate clean, date-stamped log files (e.g., `logs/app-YYYY-MM-DD.log`).
* **Format**: Timestamps must be in the `Asia/Kolkata` (IST) timezone.

### 7. Notification Fallback (Slack)
* **Goal**: Guarantee delivery of key alerts (position entry, stop-loss trigger, end-of-day exit) even if Telegram service is down or blocked.
* **Mechanism**: The notification helper (`src/notifier.ts`) will attempt to send messages via the Telegram Bot first. If the Telegram API call fails (throws an error or times out), the helper will catch the error, log it, and fallback to posting the message to a configured Slack channel via an **Incoming Webhook** URL.

---

## Project Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js >= 22 LTS |
| Language | TypeScript (strict), ES modules (`import`/`export`) |
| Package manager | pnpm |
| Framework | Express (Health check endpoint only) |
| Broker | Angel One SmartAPI |
| TOTP | `otplib@^13.x` — TypeScript-first, async-native |
| Scheduling | `node-cron` |
| Telegram Bot | `telegraf` — Polling mode for interactive commands |
| Slack Backup | Incoming Webhook (used as fallback for critical alerts) |
| Logging | Winston (daily files, IST timestamps, `Asia/Kolkata`) |
| Persistence | Local JSON files (`data/positions.json`, `data/config.json`) |
| State Management | `.paper` file (exists = Paper Mode, deleted = Live Mode) |
| Kill Switch | `.kill` file (exists = Algo Paused, deleted = Algo Running) |
| Testing | Jest + ts-jest, 100% coverage enforced |
| Linting | ESLint + Prettier |
| Pre-commit | Husky + lint-staged |
| Env | `.env` via `dotenv` (must include Slack webhook token) |

---

## Project Structure

```
ratiospread-expiry-strategy/
├── src/
│   ├── server.ts                       # Express app + health route + graceful shutdown
│   ├── config/
│   │   └── env.ts                      # dotenv validation + typed config export
│   ├── store/
│   │   ├── sessionStore.ts             # Singleton: jwtToken, feedToken, refreshToken
│   │   ├── configStore.ts              # Singleton: Config details (data/config.json)
│   │   └── positionStore.ts            # Singleton: Track current trade details, entry margin, and premiums
│   ├── helpers/
│   │   ├── constants.ts                # Lot size (65), Angel One URLs, timing constants
│   │   ├── api.ts                      # Generic axios wrappers with auth headers & 1000ms throttling
│   │   ├── login.ts                    # TOTP generation + SmartAPI session login
│   │   ├── holidayCheck.ts             # NSE holiday API check + expiry day identification
│   │   ├── scripMaster.ts              # Download + parse Angel One option scrip master JSON
│   │   ├── marketData.ts               # getLtp, getOptionChain
│   │   ├── websocket.ts                # Angel One SmartStream WebSocket client for real-time ticks
│   │   ├── orders.ts                   # placeOrder (handles paper/live)
│   │   ├── modeManager.ts              # .paper file existence check
│   │   └── logger.ts                   # Winston: console + daily file
│   ├── jobs/
│   │   ├── entryJob.ts                 # Scheduled entry scanner (runs at 09:20 AM IST on expiry days)
│   │   └── monitorJob.ts               # Continuous monitor (subscribes to live WebSocket ticks for 1% margin SL)
│   ├── telegram/
│   │   ├── bot.ts                      # Telegram Bot setup + command registration
│   │   └── commands/                   # Command handlers: /status, /logs, /paper, /update
│   ├── notifier.ts                     # Multi-channel notifier (Telegram primary + Slack fallback)
│   └── main.ts                         # Entry point: startup sequence + cron setup
├── data/
│   ├── positions.json                  # Current active position + entry margin
│   ├── config.json                     # Persistent dynamic config
│   └── scrip-master.json               # Cached option scrips
```

---

## Environment Variables

```env
PORT=3000
NODE_ENV=development

# Angel One SmartAPI Credentials
API_KEY=
CLIENT_CODE=
CLIENT_PIN=
CLIENT_TOTP_PIN=

# Telegram Configurations
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Slack Configurations
SLACK_ENABLED=false
SLACK_WEBHOOK_URL=
SLACK_SIGNING_SECRET=
```

---

## Complete Expiry Day Flow (Runtime)

```
[On Expiry Day (Tuesday, or Monday if Tuesday is holiday)]

08:30 AM IST
  └─ Standalone cron: Download + Cache options scrip-master

09:20 AM IST (Entry Execution)
  ├─ Get Nifty 50 Spot LTP
  ├─ Find ATM Call & Put contracts
  ├─ Buy 1 lot ATM Call + Buy 1 lot ATM Put
  ├─ Note actual premiums paid: P_CE, P_PE
  │
  ├─ Calculate Sell Targets: CE_Target = P_CE / 3, PE_Target = P_PE / 3
  ├─ Find strike closest to CE_Target (Call) & PE_Target (Put)
  ├─ Sell 3 lots of Target Call + Sell 3 lots of Target Put
  │
  ├─ Fetch total margin utilized for these 4 positions from Angel One
  ├─ Save positions & initial margin to data/positions.json
  ├─ Set SL = 1% of entry margin
  └─ Notify Telegram: "🟢 Strategy Entry complete. SL set at ₹SL_Amount"

09:21 AM - 03:30 PM IST (Continuous Monitoring via WebSocket)
  ├─ Initialize WebSocket connection (SmartStream SDK)
  ├─ Subscribe to token tokens for all 4 positions (Call long/short, Put long/short)
  ├─ On each live tick (LTP update):
  │    ├─ Calculate combined unrealized P&L based on current ticks
  │    ├─ If combined loss >= 1% of entry margin:
  │    │    ├─ Immediately execute Market Order to exit all 4 positions
  │    │    ├─ Disconnect WebSocket
  │    │    ├─ Clear data/positions.json
  │    │    └─ Notify Telegram: "🚨 STOP LOSS TRIGGERED! Exited all positions."
  │
  └─ At 03:30 PM IST (Market Close):
       ├─ If positions are still active:
       ├─ Execute Market Order to exit all 4 positions
       ├─ Clear data/positions.json
       └─ Notify Telegram: "🏁 Expiry day close. Exited all positions."
```

---

## GEMINI.md

```markdown
# RatioSpread Expiry Algo — AI Assistant Instructions

## README Update Rule (MANDATORY)
Before finalising any commit, check if changes affect strategy, env, commands, or setup. Update README.md first.

## Project Conventions
- Language: TypeScript strict, ES modules.
- Verification: Code must pass `pnpm verify` (typecheck, lint, test, build).
- Testing: 100% coverage enforced for all modules.
- Timezone: All timestamps must use Asia/Kolkata.
- Config: No process.env outside `src/config/env.ts`.
- State: Positions in `data/positions.json`, config in `data/config.json`, paper mode via `.paper` file, kill switch via `.kill` file.
```
