#!/usr/bin/env node
/**
 * Expiry Day Data Collector
 * Captures P&L snapshots throughout the day for post-analysis
 * Runs via cron every 15 minutes during market hours
 */

const { authenticator } = require('otplib');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const env = {};
envContent.split('\n').filter(l => l.trim() && !l.startsWith('#')).forEach(line => {
  const [k, ...v] = line.split('=');
  env[k.trim()] = v.join('=').trim();
});

const NIFTY_SPOT_TOKEN=Buffer.from([57,57,57,50,54,48,48,48]).toString();
const BASE_URL = 'https://apiconnect.angelone.in';
const DATA_DIR = path.join(__dirname, '..', 'analysis', 'snapshots');


async function collectSnapshot() {
  // Ensure data dir exists
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // Check if there are active positions
  const posPath = path.join(__dirname, '..', 'data', 'positions.json');
  if (!fs.existsSync(posPath)) return;
  const positions = JSON.parse(fs.readFileSync(posPath, 'utf8'));
  if (!positions.active) return;

  // Login
  const totp = authenticator.generate(env.CLIENT_TOTP_PIN);
  const loginRes = await axios({
    method: 'POST', url: `${BASE_URL}/rest/auth/angelbroking/user/v1/loginByPassword`,
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json',
      'X-UserType': 'USER', 'X-SourceID': 'WEB', 'X-ClientLocalIP': '192.168.1.1',
      'X-ClientPublicIP': '106.193.147.98', 'X-MACAddress': 'fe80::216:3eff:fe0f:1105',
      'X-PrivateKey': env.API_KEY,
    },
    data: { clientcode: env.CLIENT_CODE, password: env.CLIENT_PIN, totp }
  });
  if (!loginRes.data.status) return;
  const { jwtToken } = loginRes.data.data;

  const headers = {
    'Content-Type': 'application/json', 'Accept': 'application/json',
    'X-UserType': 'USER', 'X-SourceID': 'WEB', 'X-ClientLocalIP': '192.168.1.1',
    'X-ClientPublicIP': '106.193.147.98', 'X-MACAddress': 'fe80::216:3eff:fe0f:1105',
    'Authorization': `Bearer ${jwtToken}`, 'X-PrivateKey': env.API_KEY,
  };

  // Get Nifty spot
  const spotRes = await axios({
    method: 'POST', url: `${BASE_URL}/rest/secure/angelbroking/market/v1/quote`,
    headers, data: { mode: 'LTP', exchangeTokens: { NSE: [NIFTY_SPOT_TOKEN] } }
  });
  const spot = parseFloat(spotRes.data.data.fetched[0].ltp);

  // Get leg LTPs
  const tokens = positions.legs.map(l => l.token);
  const ltpRes = await axios({
    method: 'POST', url: `${BASE_URL}/rest/secure/angelbroking/market/v1/quote`,
    headers, data: { mode: 'LTP', exchangeTokens: { NFO: tokens } }
  });
  const ltpMap = new Map();
  for (const item of ltpRes.data.data.fetched) {
    ltpMap.set(item.symbolToken, parseFloat(item.ltp));
  }

  // Calculate P&L
  let totalPnL = 0;
  const legs = positions.legs.map(leg => {
    const cp = ltpMap.get(leg.token) ?? leg.entryPremium;
    const pnl = leg.direction === 'BUY' ? (cp - leg.entryPremium) * leg.qty : (leg.entryPremium - cp) * leg.qty;
    totalPnL += pnl;
    return { symbol: leg.symbol, direction: leg.direction, qty: leg.qty, entry: leg.entryPremium, ltp: cp, pnl };
  });

  const now = new Date();
  const timestamp = now.toISOString();
  const ist = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  const snapshot = {
    timestamp,
    ist,
    niftySpot: spot,
    totalPnL,
    legs,
    entryMargin: positions.entryMargin,
    stopLoss: positions.stopLoss,
  };

  // Append to today's snapshot file
  const today = now.toISOString().split('T')[0];
  const snapFile = path.join(DATA_DIR, `${today}.jsonl`);
  fs.appendFileSync(snapFile, JSON.stringify(snapshot) + '\n');

  console.log(`[${ist}] Snapshot captured — P&L: ₹${totalPnL.toFixed(2)}`);
}

collectSnapshot().catch(err => console.error('Snapshot error:', err.message));
