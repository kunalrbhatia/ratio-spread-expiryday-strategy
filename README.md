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

The repository is configured with GitHub Actions:
- **CI**: Triggers on PR/push to verify type safety, styling, lint rules, test coverage, and PR description formatting.
- **Deploy**: Runs automatically after a successful CI pass on `master` branch to deploy the built strategy onto Oracle Cloud.
