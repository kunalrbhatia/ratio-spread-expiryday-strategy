# Nifty Expiry Day Analysis — 21-Jul-2026

## Summary

| Metric | Value |
|--------|-------|
| **Index** | Nifty |
| **Expiry Date** | 21-Jul-2026 |
| **Spot Entry** | ₹24,256.30 |
| **Final P&L** | 🟢 +₹3,419.00 |
| **Utilized Margin** | ₹6,55,118.04 |
| **Return on Margin** | 🟢 +0.52% |
| **Exit Reason** | Market close square-off (03:30 PM IST) |

## Positions at Entry & Exit

| Leg | Contract | Direction | Qty | Entry Price | Exit Price / Settled | P&L |
|-----|----------|:---------:|:---:|:-----------:|:--------------------:|:---:|
| Long ATM CE | `NIFTY21JUL2624250CE` (57350) | 🟢 Long | 65 (1 Lot) | ₹52.20 | ₹0.00 | 🔴 -₹3,393.00 |
| Long ATM PE | `NIFTY21JUL2624250PE` (57351) | 🟢 Long | 65 (1 Lot) | ₹44.40 | ₹6.40 | 🔴 -₹2,470.00 |
| Short Hedge CE | `NIFTY21JUL2624350CE` (57354) | 🔴 Short | 195 (3 Lots) | ₹15.20 | ₹0.00 | 🟢 +₹2,964.00 |
| Short Hedge PE | `NIFTY21JUL2624150PE` (57347) | 🔴 Short | 195 (3 Lots) | ₹13.90 | ₹0.00 | 🟢 +₹6,318.00 |
| **Total Net P&L** | | | | | | **🟢 +₹3,419.00** |

## Trade Execution Timeline (IST)

| Time | Event / Action | Details |
|------|----------------|---------|
| **08:20 AM** | App Boot & Authentication | Authenticated with SmartAPI, verified public IP `136.119.192.237`, scheduled crons. |
| **08:30 AM** | Scrip Master Download | Downloaded 165,996 scrip headers, filtered & cached 186 NIFTY option contracts (`21JUL2026` expiry). |
| **09:20 AM** | Strategy Entry | Nifty Spot: **24256.3**, ATM Strike: **24250**. Placed market orders: |
| | | • **BUY** 65 qty `24250CE` @ ₹52.20 (Order ID: `260721000047118`) |
| | | • **BUY** 65 qty `24250PE` @ ₹44.40 (Order ID: `260721000047185`) |
| | | • **SELL** 195 qty `24350CE` @ ₹15.20 (Order ID: `260721000047796`) |
| | | • **SELL** 195 qty `24150PE` @ ₹13.90 (Order ID: `260721000047881`) |
| | Margin & Monitoring | **Utilized Margin:** ₹655,118.04 \| **SL (1%):** ₹6,551.18. Connected SmartStream WebSocket (Tokens: 57350, 57351, 57354, 57347). |
| **15:30 PM** | Market Close Square-Off | Initiated scheduled market close exit: |
| | | • **SELL** 65 qty `24250CE` (Order ID: `260721000789388`) |
| | | • **SELL** 65 qty `24250PE` (Order ID: `260721000789410`) |
| | | • **BUY** 195 qty `24350CE` (Order ID: `260721000789425`) |
| | | • **BUY** 195 qty `24150PE` (Order ID: `260721000789444`) |
| | Trade Closed | **Final Realized P&L: 🟢 +₹3,419.00** |

## Logs & Technical Diagnostics

1. **Successful Expiry Trade:**
   - Strategy entry executed smoothly at 09:20 AM.
   - Market close square-off executed cleanly at 15:30 PM with net profit of **+₹3,419.00** (+0.52% return on margin).
2. **Post-Market Error Log Notice (`app.log` at 10:37 AM / 15:39 PM):**
   - Logs show `AB4046: Symbol token not found in scrip master cache for the given exchange` when querying `getLtpData` via REST with incorrect symbol/token field assignments (e.g. passing `'tradingsymbol': '57350'` and `'symboltoken': 'NIFTY24250CE'`).
   - *Note:* This did not affect the primary live trade execution which relied on SmartStream WebSocket and standard market orders.

---
_Auto-generated post-expiry analysis report_