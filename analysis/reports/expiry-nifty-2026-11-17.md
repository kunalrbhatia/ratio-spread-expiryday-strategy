# Nifty Expiry Day Analysis — 17-Nov-2026

## Summary

| Metric | Value |
|--------|-------|
| **Index** | Nifty |
| **Expiry Date** | 17-Nov-2026 |
| **Spot Entry** | ₹25,345.00 |
| **Spot Close** | ₹25,387.40 |
| **Spot Change** | +42.40 pts |
| **Final P&L** | 🔴 -₹874.25 |
| **Max P&L** | 🟢 +₹1,335.75 (at 9:39:00 am) |
| **Min P&L** | 🔴 -₹1,267.50 (at 10:19:00 am) |
| **Entry Margin** | ₹5,33,715.943 |
| **Return on Margin** | -0.16% |

## Positions at Close

| Leg | Direction | Qty | Entry | Close | P&L |
|-----|:---------:|:---:|:----:|:----:|:---:|
| NIFTY17NOV2625350CE | 🟢 Long | 65 | ₹64.30 | ₹79.40 | 🟢 +₹981.50 |
| NIFTY17NOV2625350PE | 🟢 Long | 65 | ₹61.50 | ₹32.95 | 🔴 -₹1,855.75 |
| NIFTY17NOV2625450CE | 🔴 Short | 195 | — | — | ⚪ Rejected at entry |
| NIFTY17NOV2625200PE | 🔴 Short | 195 | — | — | ⚪ Rejected at entry |

Both long legs were bought at 09:20 and squared off at 10:37:47 IST (stop loss / test exit). The two short legs never filled — the broker rejected both 195-qty SELL orders at 09:20, so the day ran as a long-only straddle.

## P&L Timeline

| Time (IST) | Nifty Spot | P&L |
|------------|:----------:|:---:|
| 9:21:00 am | — | 🟢 ₹32.50 |
| 9:36:00 am | — | 🟢 ₹1179.75 |
| 9:51:00 am | — | 🟢 ₹617.50 |
| 10:06:00 am | — | 🟢 ₹403.00 |
| 10:21:00 am | — | 🔴 ₹-737.75 |
| 10:36:00 am | — | 🟢 ₹367.25 |
| 10:40:00 am | — | 🟢 ₹198.25 |

## Strategy Details

**Type:** Nifty Weekly Ratio Spread (Short 3, Long 1 on each side)
**Entry Time:** ~9:20 AM IST (market open on expiry day)
**Exit Time:** ~3:20 PM IST (market close square-off)
**Stop Loss:** 1% of utilized margin

## Notes

Nifty moved from ₹25,345 to ₹25,387.4 on the expiry day.
Final P&L is the sum of the two filled (and closed) NIFTY17NOV26 legs, marked at broker average fill prices; intraday timeline sourced from the minute-level MTM log (no 15-min snapshots were captured today).
The broker position book also carries nine open NIFTY23NOV26 legs with no fills today — standing positions from a separate book, not this strategy. Their mark-to-market (~₹-3.73 L) is excluded from this report.

_Auto-generated post-expiry analysis by Hermes_
