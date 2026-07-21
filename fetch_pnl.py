#!/usr/bin/env python3
"""Fetch Nifty spot + leg LTPs via SmartAPI and compute P&L."""

import json, time, os, sys

CLIENT_CODE = "AAAA705456"
CLIENT_PIN = "1524"
CLIENT_TOTP_PIN = "WQ4TCTGCHEWSMUS3KEZJH3WKVY"
API_KEY = "a6UdUfYt"

from SmartApi import SmartConnect
import pyotp

obj = SmartConnect(api_key=API_KEY)
totp = pyotp.TOTP(CLIENT_TOTP_PIN).now()

data = obj.generateSession(CLIENT_CODE, CLIENT_PIN, totp)
if not data.get("status"):
    print(f"Login failed: {data}")
    sys.exit(1)

print(f"Login OK. Token: {data.get('data',{}).get('jwtToken','')[:30]}...")

feed_token = obj.getfeedToken()

# Nifty spot: token 99926000 on NSE
spot_req = {
    "exchangeTokens": {
        "NSE": ["99926000"]
    }
}
spot_resp = obj.getMarketData("LTP", spot_req)
print(f"\nSpot response type: {type(spot_resp)}")
print(f"Spot keys: {list(spot_resp.keys()) if isinstance(spot_resp, dict) else 'N/A'}")
spot_str = json.dumps(spot_resp, indent=2, default=str)
print(f"Spot data:\n{spot_str[:2000]}")

# Parse Nifty spot
nifty_spot = None
if isinstance(spot_resp, dict):
    fetched = spot_resp.get("data", {})
    # smartapi-python returns {data: {fetched: [{token, ltp, ...}]}}
    if isinstance(fetched, dict):
        ff = fetched.get("fetched", [])
        if not ff:
            # Try flat format
            for k, v in fetched.items():
                if isinstance(v, dict) and v.get("ltp"):
                    if str(k) == "99926000" or str(v.get("token")) == "99926000":
                        nifty_spot = v["ltp"]
        else:
            for f in ff:
                if str(f.get("token")) == "99926000":
                    nifty_spot = f.get("ltp") or f.get("LTP")

print(f"\nNifty spot parsed: {nifty_spot}")

# Leg tokens on NFO
nifty_legs = [
    {"token": "57350", "symbol": "NIFTY21JUL2624250CE", "direction": "BUY", "qty": 65, "entry": 52.2},
    {"token": "57351", "symbol": "NIFTY21JUL2624250PE", "direction": "BUY", "qty": 65, "entry": 44.4},
    {"token": "57354", "symbol": "NIFTY21JUL2624350CE", "direction": "SELL", "qty": 195, "entry": 15.2},
    {"token": "57347", "symbol": "NIFTY21JUL2624150PE", "direction": "SELL", "qty": 195, "entry": 13.9},
]

leg_req = {
    "exchangeTokens": {
        "NFO": [l["token"] for l in nifty_legs]
    }
}
leg_resp = obj.getMarketData("LTP", leg_req)
print(f"\nLeg response type: {type(leg_resp)}")
leg_str = json.dumps(leg_resp, indent=2, default=str)
print(f"Leg data:\n{leg_str[:3000]}")

# Parse leg LTPs
fetched_ltps = {}
if isinstance(leg_resp, dict):
    fetched = leg_resp.get("data", {})
    if isinstance(fetched, dict):
        ff = fetched.get("fetched", [])
        if ff:
            for f in ff:
                tok = str(f.get("token"))
                ltp = f.get("ltp") or f.get("LTP")
                if tok and ltp:
                    fetched_ltps[tok] = ltp
        else:
            for k, v in fetched.items():
                if isinstance(v, dict) and v.get("ltp"):
                    fetched_ltps[str(k)] = v["ltp"]

print(f"\nLeg LTPs parsed: {fetched_ltps}")

# Compute P&L
total_pnl = 0.0
leg_details = []
for leg in nifty_legs:
    tok = leg["token"]
    ltp = fetched_ltps.get(tok, 0)
    if leg["direction"] == "BUY":
        pl = (ltp - leg["entry"]) * leg["qty"]
    else:
        pl = (leg["entry"] - ltp) * leg["qty"]
    total_pnl += pl
    direction_emoji = "📗" if pl >= 0 else "📕"
    pl_str = f"+{pl:.2f}" if pl >= 0 else f"{pl:.2f}"
    print(f"  {direction_emoji} {leg['symbol']}: {leg['direction']} qty={leg['qty']} entry={leg['entry']} ltp={ltp} -> P&L={pl_str}")
    leg_details.append({"token": tok, "symbol": leg["symbol"], "pl": round(pl, 2)})

print(f"\n{'='*50}")
pnl_emoji = "🟢" if total_pnl >= 0 else "🔴"
total_str = f"+{total_pnl:.2f}" if total_pnl >= 0 else f"{total_pnl:.2f}"
print(f"  TOTAL P&L: {pnl_emoji} ₹{total_str}")
print(f"{'='*50}")

# Save result
result = {
    "nifty_spot": nifty_spot,
    "total_pnl": round(total_pnl, 2),
    "legs": leg_details,
    "entryMargin": 655118.03,
    "stopLoss": 6551.18
}
with open("/tmp/pnl_result.json", "w") as f:
    json.dump(result, f)
print(f"\nSaved to /tmp/pnl_result.json")
