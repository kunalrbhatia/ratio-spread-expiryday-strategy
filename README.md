# Nifty Option Ratio Spread Expiry Strategy

An automated weekly options trading strategy for Nifty 50 options. The strategy runs exclusively on expiry days (normally Tuesdays, or Mondays if Tuesday is an NSE trading holiday), entering positions at 09:20 AM IST and managing risk dynamically using real-time WebSocket pricing.

## Strategy Logic

### 1. Entry (09:20 AM IST)
* Spot LTP is retrieved using the modern Angel One quote API (`/rest/secure/angelbroking/market/v1/quote`).
* Buy **1 Lot** of ATM Call (CE) option.
* Buy **1 Lot** of ATM Put (PE) option.
* Record the exact premium paid for each: $P_{CE\_Buy}$ and $P_{PE\_Buy}$.

### 2. Hedge Adjustment (Sell Side)
Immediately after entry, execute:
* **Call side**: Scan CE chain for strike closest to $\frac{P_{CE\_Buy}}{3}$ and sell **3 Lots**.
* **Put side**: Scan PE chain for strike closest to $\frac{P_{PE\_Buy}}{3}$ and sell **3 Lots**.

### 3. Position Management
* Retreive utilized margin block from Angel One.
* Set Stop-Loss at **1% of entry margin**.
* Stream option prices in real-time over the updated Angel One SmartStream WebSocket protocol (`wss://smartapisocket.angelone.in/smart-stream`). If combined loss hits 1% of margin at any point, exit all positions immediately.
* If SL is not hit, hold and square off at **03:30 PM IST** (market close).

---

## Environment Setup

Create a `.env` file in the root directory (refer to `.env.example`):

```env
PORT=3000
NODE_ENV=production

# Angel One SmartAPI Credentials
API_KEY=your_api_key
CLIENT_CODE=your_client_code
CLIENT_PIN=your_client_pin
CLIENT_TOTP_PIN=your_totp_seed_secret

# Telegram Bot (Primary)
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Slack Webhook (Fallback Alerting)
SLACK_ENABLED=true
SLACK_WEBHOOK_URL=your_incoming_webhook_url

# Strategy Options
ENABLE_SENSEX_EXPIRY=true
```


---

## PM2 Deployment

We use PM2 to manage this strategy on Oracle Cloud Free Tier. Start the app using the provided CJS configuration:

```bash
pm2 start ecosystem.config.cjs
```

---

## Commands

Control and inspect the strategy via Telegram Bot commands:
* `/status` — Displays current position detail, margin, SL level, live LTPs, and net trade P&L.
* `/paper [on|off]` — Toggles paper trading mode.
* `/kill [on|off]` — Toggles emergency kill switch (pauses all entry, exit, and monitoring activity).
* `/update` — Forces manual download and cache update of the option scrip master list.
* `/logs` — Returns the last 20 lines of the daily log.

---

## Testing & CI/CD

Run format, lint, and test validation checks locally:
```bash
pnpm verify
```

Note: To support modern package managers like `pnpm` v11 and prevent deprecation warnings, all package lifecycle and script permissions are configured in `pnpm-workspace.yaml` instead of the legacy `pnpm` field in `package.json`.


The repository is configured with GitHub Actions:
- **CI**: Triggers on PR/push to verify type safety, styling, lint rules, test coverage, PR description, and README accuracy.
- **Deploy**: Runs automatically after a successful CI pass on `master` branch to deploy the built strategy onto Oracle Cloud.

## Known SmartAPI Fixes

The following endpoint patches are applied in `src/helpers/`:

| Issue | Fix | Files |
|-------|-----|-------|
| `getLastPointPrice` returns HTML rejection | Use `/market/v1/quote` endpoint instead | `marketData.ts` |
| WebSocket URL `smartapisec.angelone.in` has no DNS | Use `smartapisocket.angelone.in/smart-stream` | `websocket.ts` |
| WS auth: `Bearer` prefix rejected | Send raw JWT token in `Authorization` header | `websocket.ts` |
| WS SSL cert validation | Set `rejectUnauthorized: false` | `websocket.ts` |
| Margin API returns 400 `"Order type is required"` | Add `orderType: 'MARKET'` to each margin leg; read `totalMarginRequired` from response | `orders.ts`, `entryJob.ts` |

## Post-Expiry Analysis

On each expiry day (Tuesday), the strategy runs an automated analysis pipeline:

1. **Snapshot Collector** — every 15 min (9:15 AM–3:30 PM IST) captures P&L snapshots to `analysis/snapshots/`
2. **Post-Close Report** — at 3:35 PM IST, generates a markdown report in `analysis/reports/` and opens a PR

Reports include: entry/exit Nifty spot, leg-wise P&L, P&L timeline, and return metrics.

## Development Rules

- **No pushes to `master` during market hours** (9:15 AM – 3:30 PM IST) — triggers the deploy pipeline which resets PM2
- **Always use branches + PRs** — never push directly to `master`
- **Run `pnpm verify` before every push** — runs typecheck, lint, prettier, tests, and build
- **Update `README.md`** when changing core application files (checked by CI)
