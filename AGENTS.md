---
context-for: hermes-agent
model: deepseek-v4-flash
provider: deepseek
last-updated: 2026-07-19
project-version: 1.0.0
---

# Ratio Spread Expiry Strategy — Project Context

## Project Identity

Two related automated options trading systems using Angel One SmartAPI:

| Project | Repo | Strategy | Frequency |
|---------|------|----------|-----------|
| **Nifty Ratio Spread** | `ratio-spread-expiryday-strategy` | Short 3 / Long 1 ratio spread on weekly Nifty/SENSEX expiry | Every Tuesday (Nifty) & Thursday (SENSEX) |
| **Bank Nifty Calendar Spread** | `ubiquitous-algo` (`ratio-double-calendar-daemon`) | Sell near-month 0.15-delta options, buy next-month premium-matched hedge | Monthly — entry after previous month's last Tue, exit on last Tue |

**Broker:** Angel One via SmartAPI (`https://apiconnect.angelone.in`)
**Server:** GCP VM (`136.119.192.237`, Ubuntu, Node 22)
**Notification:** Disabled (Telegram/Slack off — Hermes delivers alerts via chat)

---

## Architecture

### Nifty App (`~/ratio-spread-expiryday-strategy`)
- **Daemon** — runs 24/7 under PM2
- **Crons registered at boot** via `node-cron` (IST timezone):
  - 08:30 — Scrip master download (expiry days only)
  - 09:20 — Strategy entry (expiry days)
  - 15:30 — Market close square-off
- **Monitoring** — SmartStream WebSocket (real-time tick stream), stop-loss at 1% of margin
- **Entry flow:** Login → Get spot LTP → Find ATM strikes → Buy 1 lot ATM CE + PE → Find hedge strikes at 1/3 premium → Sell 3 lots each → Save position

### Bank Nifty App (`~/ubiquitous-algo`)
- **Run-and-exit** — single tick, designed for system cron every 30 min
- **System crontab:**
  ```
  30 8 * * 1-5  → pnpm prep:prod (daily scrip refresh)
  */30 9-15 * * 1-5 → pnpm start (strategy tick)
  ```
- **Entry logic:** VIX filter (10–13.5), 0.15 delta targeting, liquidity screening (spread < 8%, depth ≥ 2x lotsize)
- **Exit:** SL at 1.5% margin, PT at 2.0% margin, natural exit at month's last Tue 15:15 IST

### File Structure — Nifty App

| Path | Purpose |
|------|---------|
| `src/main.ts` | Bootstrap — login, cron registration, graceful shutdown |
| `src/config/env.ts` | Environment variable loading & validation |
| `src/helpers/api.ts` | Axios wrapper with throttling (1s gap), retry, timeout (8s), real IP/MAC |
| `src/helpers/login.ts` | SmartAPI TOTP + password login |
| `src/helpers/marketData.ts` | Spot LTP, ATM strike calc, option LTP batch fetch, premium-matching |
| `src/helpers/orders.ts` | Place order, fetch margin, MarginLeg interface |
| `src/helpers/websocket.ts` | SmartStream V2 WebSocket — connect, subscribe, parse binary, reconnect with re-auth |
| `src/helpers/holidayCheck.ts` | NSE holiday list (2026), expiry day detection with holiday backward-shift |
| `src/helpers/modeManager.ts` | Paper/kill/panic filesystem flags |
| `src/helpers/scripMaster.ts` | Download & cache OpenAPI scrip master, filter by index/expiry |
| `src/helpers/constants.ts` | INDEX_CONFIGS (NIFTY, SENSEX), exchange/lot/step config |
| `src/jobs/entryJob.ts` | Full strategy entry — spot → ATM → hedge → orders → save |
| `src/jobs/monitorJob.ts` | WebSocket tick handler, P&L calc, SL check, exit execution |
| `src/store/positionStore.ts` | Per-index position files (`nifty_positions.json`, `sensex_positions.json`) |
| `src/store/sessionStore.ts` | In-memory JWT/feed/refresh tokens |
| `src/telegram/bot.ts` | Telegram commands (DISABLED — bot token conflicts with Hermes) |
| `src/notifier.ts` | Alert dispatcher (disabled when TELEGRAM & SLACK both off) |
| `src/server.ts` | Express health endpoint on port 3000 |
| `analysis/collect-snapshot.cjs` | P&L snapshot collector (15-min intervals on expiry days) |
| `analysis/generate-report.cjs` | Post-close markdown report generator |
| `issues.md` | 13 resolved code review findings |
| `ecosystem.config.cjs` | PM2 config with `TZ: 'UTC'` |

### File Structure — Bank Nifty App

| Path | Purpose |
|------|---------|
| `src/index.ts` | Single-tick bootstrap — login, instruments, margin update, trading tick |
| `src/auth/session.ts` | SmartAPI login with token caching to disk |
| `src/execution/brokerClient.ts` | REST client (native fetch), order placement, margin, market data, greeks |
| `src/execution/executionManager.ts` | Order sequencing, P&L monitoring, entry/exit execution |
| `src/strategy/strategyManager.ts` | VIX check, delta calculation, basket building, liquidity screening |
| `src/strategy/blackScholes.ts` | Delta calculation |
| `src/instruments/instrumentManager.ts` | Scrip master parser, expiry resolution, instrument cache |
| `src/positions/positionsStore.ts` | Monthly position files with Zod validation |
| `src/scheduler/cronScheduler.ts` | Schedule logic, entry/exit/monitoring windows, daily cleanup |
| `src/flags/flagWatcher.ts` | Paper/kill/done-for-this-month filesystem flags |
| `src/http/httpClient.ts` | fetch-based HTTP client with retry, timeout (10s) |
| `src/schemas/env.ts` | Zod env schema |
| `src/schemas/smartApi.ts` | Zod schemas for all API responses |
| `data/live/positions-banknifty-2026-07.json` | Current month's open position |

---

## Configuration

### Env Vars (`ratio-spread-expiryday-strategy/.env`)

| Var | Purpose |
|-----|---------|
| `API_KEY` | SmartAPI API key |
| `CLIENT_CODE` | Angel One client code (`AAAA705456`) |
| `CLIENT_PIN` | Angel One trading PIN |
| `CLIENT_TOTP_PIN` | TOTP secret seed |
| `TELEGRAM_BOT_TOKEN` | Bot token (shared with Hermes — app's bot is DISABLED) |
| `TELEGRAM_CHAT_ID` | `1113115008` |
| `USE_TELEGRAM` / `USE_SLACK` | Set to `false` — app uses Hermes for alerts |

### Env Vars (`ubiquitous-algo/.env`)
Same SmartAPI credentials + `LOTS=1`.

---

## SmartAPI Quirks & Fixes

| Issue | Fix | File(s) |
|-------|-----|---------|
| `getLastPointPrice` returns HTML 403 | Use `/market/v1/quote` with `{mode:'LTP', exchangeTokens:{NSE:[token]}}` | `marketData.ts` |
| WS URL `smartapisec.angelone.in` has no DNS | Use `wss://smartapisocket.angelone.in/smart-stream` | `websocket.ts` |
| WS auth with `Bearer ` prefix rejected | Send raw JWT token only | `websocket.ts` |
| WS SSL cert validation | `rejectUnauthorized: false` | `websocket.ts` |
| WS binary offsets were wrong | Token: bytes 2-27, LTP: bytes 43-50 (BigInt64LE / 100) | `websocket.ts` |
| `X-MACAddress` uppercase 'A' rejected | Use `X-MACaddress` (lowercase 'a') | `api.ts`, `brokerClient.ts` |
| Margin API 400 — missing `orderType` | Add `orderType: 'MARKET'` with camelCase | `orders.ts`, `entryJob.ts`, `brokerClient.ts` |
| Margin API wrong payload fields | Use `token`, `qty`, `tradeType`, `productType` (not `symboltoken`, `quantity`, etc.) | `brokerClient.ts` |
| Margin API response field wrong | Read `data.totalMarginRequired` (not `totalMargin` or `marginBlock`) | `orders.ts`, `brokerClient.ts` |
| Margin API returns `[]` via native `fetch` | Fallback to verified ₹1,30,000 for BankNifty | `brokerClient.ts` |
| Worthless option square-off | Skip exit order for options with LTP < ₹5.0 during market close square-off to save brokerage | `monitorJob.ts` |

---

## Schedules

| Event | Day | Time IST | Index |
|-------|-----|----------|-------|
| Entry | Tuesday | 09:20 | Nifty |
| Exit | Tuesday | 15:30 | Nifty |
| Entry | Thursday | 09:20 | SENSEX |
| Exit | Thursday | 15:30 | SENSEX |
| BankNifty Entry | First trading day after previous month's last Tue | 09:30+ | BankNifty |
| BankNifty Exit | Last Tuesday of month | 15:15 | BankNifty |

**NSE Holidays 2026:** Listed in `holidayCheck.ts` — expiry shifts to previous trading day if holiday.

---

## Hermes Cron Jobs

| Job ID | Name | Schedule | Purpose |
|--------|------|----------|---------|
| `fba5a6d72054` | pnl-checker | `*/30 9-15 * * 1-5` | Reports P&L every 30 min during market hours |
| `b9c149b29a94` | expiry-post-close-analysis | `35 15 * * 2,4` | Generates post-close report + PR after expiry close |

---

## Development Rules

- **NO pushes to master** — always use branches + PRs
- **`pnpm verify`** before every push (tsc → lint → prettier → test → build)
- **No pushes during market hours** (09:15–15:30 IST) — deploy pipeline resets PM2
- **`git pull origin master`** before creating any branch
- **Conventional commits:** `feat:`, `fix:`, `chore:`, `docs:`, `test:`
- **PR bodies:** Use backticks for all file paths (`src/file.ts`) and commands (`pnpm verify`)
- **PR workflow:** `.agents/skills/gh-pr-workflow/SKILL.md`

---

## Known Issues (Resolved)

All 13 issues from `issues.md` are fixed:

| # | Issue | Status |
|---|-------|--------|
| 1 | No Telegram auth check | ✅ `ctx.from.id` middleware added |
| 2 | Kill switch blocks SL exits | ✅ Split into kill (pause entries) + panic (halt all) |
| 3 | Wrong WS binary offsets | ✅ Fixed token/LTP offsets |
| 4 | No fill confirmation before clear | ✅ Per-leg exit tracking |
| 5 | Silent fallback into SL math | ✅ Alert on fallback usage |
| 6 | Blind retry duplicates orders | ✅ Order placement excluded from retry |
| 7 | Holiday shift doesn't check target day | ✅ Rewritten as backward search |
| 8 | TZ depends on server default | ✅ `TZ: 'UTC'` in ecosystem config |
| 9 | `clear()` leaves stale leg data | ✅ Resets all fields |
| 10 | Hardcoded fake IP/MAC | ✅ Real VM public IP fetched at startup |
| 11 | No request timeout | ✅ `timeout: 8000` on axios config |
| 12 | Fragile strike-unit heuristic | ✅ Per-exchange divisor |
| 13 | WS reconnect never re-auths | ✅ Re-login after reconnect failures |

---

## Roadmap / Feature Requests
<!-- Hermes: append feature requests here when mentioned by the user -->
- (none yet)

---

## Instructions for Hermes

When you detect any of the following, update this file using `patch` or `write_file`:

- A new file is added to `src/`, `analysis/`, or `.agents/`
- An environment variable is added or changed
- A cron job is created, modified, or removed
- A new SmartAPI quirk is discovered
- The user mentions a future feature (append to **Roadmap** section)
- The user corrects you about any fact in this file (fix it immediately)
- After merging a PR that changes core logic

Keep the format consistent. Max 300 lines. Every line must carry signal.
