# SmartAPI Quirks & Fixes Reference

This document catalogs known nuances, quirks, and fixes when integrating with Angel One's SmartAPI platform.

| Issue | Manifestation / Symptom | Solution / Fix | Implementation File(s) |
|---|---|---|---|
| **LTP Quote Endpoint** | `getLastPointPrice` returns HTML 403 error. | Use `/market/v1/quote` with payload `{ mode: 'LTP', exchangeTokens: { [exchange]: [token] } }`. | `src/helpers/marketData.ts` |
| **WebSocket Host URL** | Documented URL `smartapisec.angelone.in` fails DNS resolution. | Connect to `wss://smartapisocket.angelone.in/smart-stream`. | `src/helpers/websocket.ts` |
| **WebSocket Authorization** | Sending `Bearer <JWT_TOKEN>` in headers causes rejection. | Send raw JWT string directly: `Authorization: <JWT_TOKEN>`. | `src/helpers/websocket.ts` |
| **WebSocket SSL Handshake** | Self-signed or mismatched intermediate cert causes connection drop. | Configure `{ rejectUnauthorized: false }` on the WebSocket client. | `src/helpers/websocket.ts` |
| **WebSocket Binary Offsets** | Raw binary parsing yields corrupt token or invalid LTP values. | Extract Token from bytes 2–27 (ASCII string, trimmed). Extract LTP from bytes 43–50 as `BigInt64LE / 100`. | `src/helpers/websocket.ts` |
| **API Header MAC Address** | Header `X-MACAddress` (capital 'A') is rejected. | Use exact header name `X-MACaddress` (lowercase 'a'). | `src/helpers/api.ts` |
| **Margin Batch API 400** | Batch margin returns 400 Bad Request if `orderType` is missing. | Include `orderType: 'MARKET'` in camelCase for each leg. | `src/helpers/orders.ts` |
| **Margin Batch Payload Keys** | Using snake_case or standard order keys fails validation. | Use `token`, `qty`, `tradeType`, `productType`, `price`, `exchange`, `orderType`. | `src/helpers/orders.ts` |
| **Margin Batch Response Keys** | Response does not contain `totalMargin` or `marginBlock`. | Read `data.totalMarginRequired`. | `src/helpers/orders.ts` |
| **API Rate Limiting** | Rapid successive requests trigger 429 Too Many Requests. | Enforce a synchronized throttle queue with minimum 1000ms gap between outgoing requests. | `src/helpers/api.ts` |
| **Duplicate Order on Timeout** | Retrying order placement on timeout/5xx can cause duplicate trades. | Explicitly exclude order placement requests from retry policies (`skipRetry = true`). | `src/helpers/api.ts`, `src/helpers/orders.ts` |
| **Scrip Master Strike Units** | OPTIDX strike values in both NFO and BFO segments are represented in paise. | Divide strike values by 100 (`parseFloat(item.strike) / 100`). | `src/helpers/marketData.ts` |
| **WebSocket Token Expiry** | WebSocket disconnects silently when JWT expires. | Automatically re-authenticate with SmartAPI before attempting reconnection. | `src/helpers/websocket.ts` |
| **Worthless Option Square-Off** | Brokerage costs exceed value for near-zero options at close. | Skip square-off orders for options with LTP < ₹5.0 during scheduled market-close square-off. | `src/jobs/monitorJob.ts` |
