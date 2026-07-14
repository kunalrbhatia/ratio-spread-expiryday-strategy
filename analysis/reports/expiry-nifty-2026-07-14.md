# Nifty Expiry Day Analysis — 14-Jul-2026

## Summary

| Metric | Value |
|--------|-------|
| **Index** | Nifty |
| **Expiry Date** | 14-Jul-2026 |
| **Spot Entry** | ₹24,106.95 |
| **Spot Close** | ₹24,052.05 |
| **Spot Change** | -54.90 pts |
| **Final P&L** | 🟢 +₹4,813.25 |
| **Max P&L** | +₹4,813.25 |
| **Min P&L** | +₹3,649.75 (at 1:51 PM) |
| **Entry Margin** | ₹3,50,000 (fallback) |
| **Return on Margin** | +1.38% |

## Positions at Close

| Leg | Direction | Qty | Entry | Close | P&L |
|-----|:---------:|:---:|:----:|:----:|:---:|
| NIFTY14JUL26**24100CE** | 🟢 Long | 65 | ₹59.90 | ₹0.05 | 🔴 -₹3,890 |
| NIFTY14JUL26**24100PE** | 🟢 Long | 65 | ₹62.65 | ₹47.90 | 🔴 -₹959 |
| NIFTY14JUL26**24200CE** | 🔴 Short | 195 | ₹24.25 | ₹0.05 | 🟢 +₹4,719 |
| NIFTY14JUL26**24000PE** | 🔴 Short | 195 | ₹25.40 | ₹0.05 | 🟢 +₹4,943 |

## P&L Timeline

| Time (IST) | Nifty Spot | P&L |
|------------|:----------:|:---:|
| 09:20 AM | ₹24,107 | Entry |
| 01:51 PM | ₹24,061 | 🟢 +₹3,650 |
| 03:30 PM | ₹24,052 | 🟢 +₹4,813 |

## Strategy Details

**Type:** Nifty Weekly Ratio Spread (Short 3, Long 1 on each side)
**Entry Time:** ~9:20 AM IST (market open on expiry day)
**Exit Time:** ~3:30 PM IST (market close square-off)
**Stop Loss:** 1% of utilized margin

## Notes

Nifty dropped ~55 pts during the day. Short legs carried the trade as both 24200 CE and 24000 PE expired near worthless (₹0.05). Long 24100 CE lost nearly all premium (-₹3,890) while long 24100 PE partially retained value (-₹959) due to the market decline.

_Auto-generated post-expiry analysis by Hermes_
