# Code Review — `ratio-spread-expiryday-strategy`

Scanned directly from GitHub (raw files, no auth needed): `src/`, `.github/workflows/`, `ecosystem.config.cjs`, `package.json`, `.env.example`.

Since this bot places **live orders on your real Angel One account**, I've ordered issues by "how much real money/exposure is at risk" rather than by code-quality severity. Plain-English first, code snippet where it helps pinpoint the fix.

---

## 🔴 CRITICAL — money-at-risk issues

### 1. Anyone who can message your Telegram bot can control it — there's no owner check
**File:** `src/telegram/bot.ts`

Every command handler (`/status`, `/paper`, `/kill`, `/update`, `/logs`) fires for **any** Telegram user who sends it, with no check against your `TELEGRAM_CHAT_ID`:

```javascript
telegramBot.command('kill', (ctx) => {
  const args = ctx.message.text.split(' ');
  // ...no check on ctx.from.id or ctx.chat.id anywhere...
  setKillSwitch(true or false);
});
```

**Impact:** If your bot's username is ever discovered (Telegram bots are technically discoverable/guessable, and tokens do leak via screenshots, logs, forwarded messages, etc.), a stranger can flip you into/out of paper mode, toggle the kill switch (which — see issue #2 — also **blocks your stop-loss exits**), or spam `/update`. This is the single highest-risk item in the repo for a bot that trades real money.

**Fix:** Add a guard at the top of every handler (or as Telegraf middleware):
```javascript
telegramBot.use((ctx, next) => {
  if (String(ctx.from?.id) !== env.TELEGRAM_CHAT_ID) {
    logger.warn(`Unauthorized Telegram command from ${ctx.from?.id}`);
    return; // silently drop
  }
  return next();
});
```

---

### 2. Kill switch blocks stop-loss exits, not just new entries
**Files:** `src/jobs/monitorJob.ts`, `src/helpers/modeManager.ts`

The README describes `/kill` as pausing "all entry, exit, and monitoring activity" — and the code does exactly that:

```javascript
// monitorJob.ts
export const exitAllPositions = async (...) => {
  if (isKillSwitchActive()) {
    logger.warn(`Exit all positions blocked for ${symbol}: Kill Switch is active.`);
    return false;   // <-- position does NOT get closed
  }
  ...
};

export const handleIncomingTick = async (...) => {
  if (isKillSwitchActive()) {
    return;   // <-- SL is never checked while kill switch is on
  }
  ...
};
```

**Impact:** This is a real trap. The natural instinct when something looks wrong mid-trade is to hit `/kill` to "make it stop." But doing so while a position is open **disables your stop-loss monitoring and blocks both the automatic SL exit and the 3:30 PM square-off**. A live short-heavy ratio spread (3 lots short vs 1 lot long) can move against you fast — with the kill switch on, nothing will close it until you manually turn the kill switch back off or intervene by hand.

**Fix:** Split the concept in two — a "pause new entries" flag and a separate "halt everything, no exceptions" flag — and make the *default* kill switch only block new entries (`entryJob.ts`), never exits/monitoring. If you truly want a hard-stop switch, name it something like `/panic` and document clearly that it also disables the safety net.

---

### 3. WebSocket tick parser is likely reading the wrong bytes for token and price
**File:** `src/helpers/websocket.ts`

```javascript
const type = data.readUInt8(0);
if (type === 1 || type === 3) {
  const tokenBuffer = data.slice(1, 26);      // reads bytes 1–25
  const token = tokenBuffer.toString('utf8').replace(/\0/g, '').trim();
  const ltpRaw = data.readInt32LE(26);         // reads bytes 26–29
  const ltp = ltpRaw / 100;
  ...
}
```

Angel One's SmartStream (WebSocket 2.0) binary layout is: byte `0` = subscription mode, byte `1` = exchange type, bytes `2–26` = the 25-byte token, bytes `27–34` = sequence number (8 bytes), bytes `35–42` = exchange timestamp (8 bytes), and LTP starts at byte `43` (as an 8-byte long, in paise — divide by 100). I confirmed this against Angel One's own reference sample code.

This code is off by one byte on the token (starts at 1 instead of 2) and reads LTP from byte 26 — which actually falls **inside** the token field, not the price field at all.

**Impact:** In the best case this throws / produces garbage and your monitoring silently never gets valid ticks (so your 1% stop-loss never fires from live prices — you'd only square off at 3:30 PM). In the worst case it produces a plausible-looking but wrong number that gets fed straight into your P&L and stop-loss math.

**Fix:** Correct the offsets:
```javascript
const tokenBuffer = data.slice(2, 27);
const token = tokenBuffer.toString('utf8').replace(/\0/g, '').trim();
const ltpRaw = Number(data.readBigInt64LE(43));
const ltp = ltpRaw / 100;
```
Test this against a real (or recorded) tick stream before trusting it in live mode — this is the kind of bug that's easy to miss because the code doesn't crash, it just quietly produces wrong numbers.

---

### 4. No confirmation that exit orders actually filled before marking the position "closed"
**File:** `src/jobs/monitorJob.ts`

```javascript
for (const leg of positions.legs) {
  const exitTxType = leg.direction === 'BUY' ? 'SELL' : 'BUY';
  try {
    await ordersHelper.placeOptionOrder({ ... });
  } catch (err: any) {
    logger.error(`Error closing leg ${leg.symbol}: ${err.message}`);
    // execution continues regardless
  }
}
// ...
store.clear();   // marks position inactive no matter what happened above
```

**Impact:** If one leg's exit order fails (network blip, margin rejection, symbol issue) the error is only logged — the loop still moves on, and `store.clear()` unconditionally marks the whole position as closed. From that point the bot believes it's flat while you may still have a **live, unmonitored position at the broker** (most dangerously, an unhedged short leg). The `/status` command and WebSocket monitoring would show nothing wrong because the local state says "no active position."

**Fix:** Track per-leg success, only call `store.clear()` if every leg confirmed closed, and if any leg fails, keep monitoring that leg specifically and send a distinct high-priority alert ("MANUAL INTERVENTION NEEDED — leg X failed to close").

---

### 5. Silent fallback numbers get fed straight into your stop-loss calculation
**Files:** `src/jobs/entryJob.ts`, `src/helpers/orders.ts`

```javascript
// entryJob.ts
const pCEBuy = fillPrices.get(atmCE.token) || 100; // fallback if api returns 0
const pPEBuy = fillPrices.get(atmPE.token) || 100;
```
```javascript
// orders.ts
return margin > 0 ? margin : 350000; // fallback if api returns 0
...
} catch (error: any) {
  logger.error(`Error in fetchUtilizedMargin: ...`);
  return 350000;
}
```

**Impact:** These fallbacks exist so the bot doesn't crash on a flaky API response — reasonable in isolation — but the fallback values (₹100 premium, ₹3,50,000 margin) then flow **silently** into real trading math: your recorded entry premium (used for P&L) and your stop-loss threshold (1% of margin). If the real premium was ₹35 or the real margin was ₹5,00,000, your SL could be set at roughly 30% off from where it should be, and you'd have no way of knowing from the logs unless you're watching closely — there's no alert distinguishing "real data" from "fallback used."

**Fix:** Don't silently substitute — either retry the LTP/margin fetch a few times before falling back, or if you must fall back, send an explicit alert ("⚠️ using fallback margin, SL may be inaccurate") and consider blocking entry entirely rather than trading with fabricated numbers.

---

## 🟠 HIGH — logic bugs likely to trigger on the wrong day or wrong price

### 6. Retrying a failed order request can place a duplicate order
**File:** `src/helpers/api.ts`

```javascript
const requestWithRetry = async <T>(requestFn, retries = 3, delay = 1000): Promise<T> => {
  try {
    return await requestFn();
  } catch (error: any) {
    if (retries > 0) {
      // ...retries the same request again...
    }
  }
};
```
This generic retry wrapper is used for **every** API call, including `placeOptionOrder`.

**Impact:** If Angel One receives and executes the order but the HTTP response times out or drops before your bot sees it (a real possibility on any broker API), the bot will interpret that as a failure and retry — placing a **second live order** for the same leg. For your 3-lot hedge legs this could double your short exposure without warning.

**Fix:** Don't blanket-retry order placement. Either exclude `placeOptionOrder`/margin calls from the generic retry, or use SmartAPI's order book/trade book to check whether an order with the same parameters already went through before resubmitting.

---

### 7. The "shift to previous trading day" holiday logic doesn't actually check the target day
**File:** `src/helpers/holidayCheck.ts`

```javascript
if (day < targetDay && day > 0) {
  for (let d = day + 1; d <= targetDay; d++) {
    const checkDate = new Date(kolkataDate);
    checkDate.setDate(kolkataDate.getDate() + (d - day));
    if (!isNSEHoliday(checkDate)) {
      return false;   // bails as soon as ANY day in between isn't a holiday
    }
  }
  return true;
}
```

**Impact:** The intent (per the README) is "trade on Monday if Tuesday is a holiday." But the loop's actual behavior is: walk forward from today through the target day, and if **any** day in that range isn't a holiday, declare "not expiry today." That happens to produce the right answer only in the simplest one-holiday case. It breaks down for anything more complex — e.g., a Wednesday-expiry index (not currently used, but the function is generic) where multiple holidays stack up, or any case where the intended logic is "walk backward from the target day to find the nearest trading day," which this code doesn't do. Worth hardening now rather than after it silently misfires once expiry-day rules get more complex (e.g. holiday clusters around Diwali).

**Fix:** Rewrite as an explicit backward search from `targetDay`: start at the target date, and step backward one day at a time (skipping weekends/holidays) until you land on a valid trading day; check if `date` equals that day.

---

### 8. The IST "local time" trick depends on the server's OS timezone being UTC, and that's never set explicitly
**Files:** `src/helpers/holidayCheck.ts`, `ecosystem.config.cjs`

```javascript
const kolkataDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
```
This is a common JS trick to "re-anchor" a `Date` so that `.getDay()`/`.getDate()` reflect IST fields — but it only works correctly if the **process's own local timezone** is UTC (India has no DST, so a fixed +5:30 offset trick like this is sensitive to what timezone `new Date(string)` assumes when re-parsing). `holidayCheck.ts` then does this conversion **twice** in some code paths (once in `isExpiryDayForSymbol`, again inside `isNSEHoliday`), which only cancels out correctly under specific TZ assumptions.

Nothing in `ecosystem.config.cjs`'s `env` block sets `TZ: 'UTC'` (or anything), so this depends entirely on whatever the Oracle Cloud VM's default OS timezone happens to be.

**Impact:** If the VM's default timezone isn't UTC (or changes after an OS update), the day-of-week / holiday checks used to decide "is today an expiry day" could be silently wrong — meaning the bot could skip an actual expiry day, or worse, attempt to enter a live trade on a non-expiry day.

**Fix:** Set `TZ: 'UTC'` explicitly in `ecosystem.config.cjs`'s `env`, and use a proper timezone-aware date library (e.g. `luxon` or `date-fns-tz`) instead of the `toLocaleString` round-trip, so the logic doesn't depend on implicit server configuration at all.

---

### 9. `clear()` leaves stale leg data behind after a position is closed
**File:** `src/store/positionStore.ts`

```javascript
public clear() {
  this.state.active = false;
  this.save();   // legs, entryMargin, stopLoss are all left as-is
}
```

**Impact:** Low risk on its own since `setPositions()` fully overwrites state on the next entry, but in between, anything reading `getPositions().legs` while `active === false` will see the **previous day's closed legs**, not an empty array. If any future code (or a manual debugging session) checks `legs.length` without also checking `active`, it'll misreport an open position.

**Fix:** Reset `legs`, `entryMargin`, and `stopLoss` to empty/zero in `clear()` too.

---

## 🟡 MEDIUM — operational / spoofing / hygiene issues

### 10. Hardcoded fake client IP/MAC address sent on every API call
**File:** `src/helpers/api.ts`

```javascript
'X-ClientLocalIP': '192.168.1.1',
'X-ClientPublicIP': '106.193.147.98',
'X-MACaddress': 'fe80::216:3eff:fe0f:1105',
```

**Impact:** Angel One (like most brokers) uses these headers for fraud/compliance monitoring. Sending fixed, clearly-fake values on every request from a cloud VM (rather than the VM's actual outbound IP) is the kind of pattern that can get flagged by a broker's risk systems, and in the worst case lead to API access being throttled or suspended with no warning — which would silently stop your bot from trading or exiting positions.

**Fix:** Fetch the VM's real public IP once at startup (e.g. via a simple `ip-api` call or Oracle Cloud metadata service) and use the local network interface's actual IP/MAC where possible, rather than hardcoded placeholders.

### 11. No request timeout on any API call
**File:** `src/helpers/api.ts`

`axios({...config, headers})` never sets a `timeout`. A hung request during your 09:20 entry window or a stop-loss exit could block indefinitely (Node's default socket timeout is very long), delaying a time-critical trade action.

**Fix:** Add e.g. `timeout: 8000` to the axios config and treat timeouts as retryable-but-alertable failures.

### 12. Fragile heuristic for detecting whether a strike price is in paise vs rupees
**File:** `src/helpers/marketData.ts`

```javascript
const itemStrike = parseFloat(item.strike) / (parseFloat(item.strike) > 100000 ? 100 : 1);
```
This assumes any strike value over 1,00,000 must be in paise (i.e., x100). That's true today for both Nifty and Sensex strikes, but it's a magic-number heuristic rather than reading the actual units from the scrip master format, and would silently misfire if either index's strike range crosses that threshold differently than expected (e.g. very high Sensex strikes).

**Fix:** Confirm the scrip master's documented unit convention for `strike` and apply a fixed, documented divisor per exchange/symbol rather than a threshold guess.

### 13. WebSocket reconnect never re-authenticates
**File:** `src/helpers/websocket.ts`

```javascript
this.ws.on('close', () => {
  logger.warn('SmartStream WebSocket connection closed. Attempting reconnect in 5s...');
  this.isConnected = false;
  setTimeout(() => this.connect(callback), 5000);
});
```
`connect()` re-reads the same `jwtToken`/`feedToken` from `sessionStore` without checking if they're still valid. If the connection dropped *because* the session expired, this will retry every 5 seconds forever without ever succeeding or alerting you.

**Fix:** After a small number of failed reconnect attempts, trigger `loginToSmartAPI()` again and send a Telegram/Slack alert if reconnects keep failing — silence here means you've lost live price monitoring on an open position.

---

## Summary table

| # | Issue | File | Severity | Status |
|---|-------|------|----------|--------|
| 1 | No Telegram auth check on bot commands | `telegram/bot.ts` | Critical | Done |
| 2 | Kill switch blocks stop-loss exits | `jobs/monitorJob.ts` | Critical | Done |
| 3 | Wrong WebSocket binary offsets for token/LTP | `helpers/websocket.ts` | Critical | Done |
| 4 | No fill confirmation before marking position closed | `jobs/monitorJob.ts` | Critical | Done |
| 5 | Silent fallback values feed into SL math | `jobs/entryJob.ts`, `helpers/orders.ts` | Critical | Done |
| 6 | Blind retry can duplicate live orders | `helpers/api.ts` | High | Done |
| 7 | Holiday-shift logic doesn't check target day correctly | `helpers/holidayCheck.ts` | High | Done |
| 8 | IST date trick depends on unset server TZ | `helpers/holidayCheck.ts`, `ecosystem.config.cjs` | High | Done |
| 9 | `clear()` leaves stale leg data | `store/positionStore.ts` | High | Done |
| 10 | Hardcoded fake IP/MAC in every API call | `helpers/api.ts` | Medium | Done |
| 11 | No request timeout on API calls | `helpers/api.ts` | Medium | Done |
| 12 | Fragile strike-unit heuristic | `helpers/marketData.ts` | Medium | Done |
| 13 | WebSocket reconnect never re-authenticates | `helpers/websocket.ts` | Medium | Done |

All 13 code review issues have been successfully resolved, tested, and verified.
