# Nifty Expiry Day Analysis — 03-Nov-2026

## Summary

| Metric | Value |
|--------|-------|
| **Index** | Nifty |
| **Expiry Date** | 03-Nov-2026 |
| **Spot Entry** | ₹23,578.15 |
| **Spot Close** | ₹23,810.85 |
| **Spot Change** | +232.70 pts |
| **Final P&L** | 🟢 **+₹2,242.50** |
| — intended spread (closed manually 15:10:58) | 🟢 +₹234.00 |
| — carry legs opened by the 15:27 square-off | 🟢 +₹2,008.50 |
| **Entry Margin** | ₹6,58,258.32 |
| **Return on Margin** | +0.34% |

*Corrected against the broker trade book. The previously published −₹5,989.75 came from the app log, which assumed the spread was still open at 15:27 and valued it at settlement prices.*

## Executed fills (broker trade book)

| Time (IST) | Leg | Side | Qty | Price |
|------------|-----|:----:|:---:|------:|
| 09:20:02 | NIFTY03NOV2623600CE | Buy | 65 | ₹46.95 |
| 09:20:03 | NIFTY03NOV2623600PE | Buy | 65 | ₹88.45 |
| 09:20:11 | NIFTY03NOV2623700CE | Sell | 195 | ₹17.70 |
| 09:20:12 | NIFTY03NOV2623450PE | Sell | 195 | ₹26.50 |
| 15:10:58 | NIFTY03NOV2623700CE | Buy | 195 | ₹39.30 |
| 15:10:58 | NIFTY03NOV2623450PE | Buy | 195 | ₹0.45 |
| 15:10:58 | NIFTY03NOV2623600CE | Sell | 65 | ₹124.15 |
| 15:10:58 | NIFTY03NOV2623600PE | Sell | 65 | ₹1.50 |
| 15:27:03 | NIFTY03NOV2623700CE | Buy | 195 | ₹95.00 |
| 15:27:03 | NIFTY03NOV2623600CE | Sell | 65 | ₹194.20 |

## Realised P&L

**Intended spread — closed manually at 15:10:58**

| Leg | Entry | Exit | P&L |
|-----|------:|-----:|----:|
| 23600CE (long 65) | ₹46.95 | ₹124.15 | 🟢 +₹5,018.00 |
| 23600PE (long 65) | ₹88.45 | ₹1.50 | 🔴 −₹5,651.75 |
| 23700CE (short 195) | ₹17.70 | ₹39.30 | 🔴 −₹4,212.00 |
| 23450PE (short 195) | ₹26.50 | ₹0.45 | 🟢 +₹5,079.75 |
| **Net** | | | 🟢 **+₹234.00** |

**Carry legs — opened by the scheduled 15:27 square-off against an already-flat book, valued at the 23,810.85 settlement**

| Leg | Entry | Settlement | P&L |
|-----|------:|-----------:|----:|
| 23700CE (long 195) | ₹95.00 | ₹110.85 | 🟢 +₹3,090.75 |
| 23600CE (short 65) | ₹194.20 | ₹210.85 | 🔴 −₹1,082.25 |
| **Net** | | | 🟢 **+₹2,008.50** |

## What happened

1. Entry at 09:20 with the standard 3:1 ratio spread on the 03-Nov expiry.
2. **15:10:58 — position closed manually**, all four legs, before the scheduled square-off.
3. **15:27:03 — the square-off cron fired anyway.** Its ledger still believed the spread was open, so its closing orders were new fills rather than closes: it bought 195 of 23700CE and sold 65 of 23600CE, opening opposite positions.
4. Those two legs ran to settlement at 23,810.85 and netted +₹2,008.50.

The square-off time has since moved to **15:10**, so the scheduled exit and the operator's exit now coincide instead of stacking.

## P&L timeline (app MTM log, before reconciliation)

| Time (IST) | P&L |
|------------|:---:|
| 9:21 am | 🟢 ₹143.00 |
| 9:36 am | 🔴 −₹640.25 |
| 9:51 am | 🔴 −₹448.50 |
| 10:06 am | 🔴 −₹29.25 |
| 10:21 am | 🔴 −₹130.00 |
| 10:36 am | 🔴 −₹981.50 |
| 10:51 am | 🔴 −₹406.25 |
| 11:06 am | 🟢 ₹435.50 |
| 11:21 am | 🔴 −₹26.00 |
| 11:36 am | 🟢 ₹487.50 |
| 11:51 am | 🔴 −₹159.25 |
| 12:06 pm | 🔴 −₹1,644.50 |
| 12:21 pm | 🟢 ₹640.25 |
| 12:36 pm | 🟢 ₹318.50 |
| 12:51 pm | 🟢 ₹682.50 |
| 1:06 pm | 🔴 −₹13.00 |
| 1:21 pm | 🔴 −₹1,712.75 |
| 1:36 pm | 🔴 −₹2,905.50 |
| 1:51 pm | 🔴 −₹2,184.00 |
| 2:06 pm | 🔴 −₹500.50 |
| 2:21 pm | 🟢 ₹425.75 |
| 2:36 pm | 🟢 ₹432.25 |
| 2:51 pm | 🟢 ₹1,033.50 |
| 3:06 pm | 🟢 ₹1,605.50 |
| 3:21 pm | 🔴 −₹2,463.50 |
| 3:27 pm | 🔴 −₹5,014.75 |

The series tracks the intended spread as the app saw it, and stops when that book was closed at 15:10. It is kept as the intraday record, not as the day's result.

## Strategy Details

**Type:** Nifty Weekly Ratio Spread (Short 3, Long 1 on each side)
**Entry Time:** ~9:20 AM IST (market open on expiry day)
**Exit Time:** 15:10 IST (square-off)
**Stop Loss:** 1% of utilized margin

## Notes

Nifty moved from ₹23,578.15 to ₹23,810.85 on the expiry day; the rally cost the short 23700CE leg, which the long 23600CE did not fully cover.

Figures here come from the broker trade book, not the app log. `getPosition` returns an empty body on this account, so fills are the only dependable source.

_Auto-generated post-expiry analysis by Hermes_
