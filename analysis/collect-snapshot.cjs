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

const BASE_URL = 'https://apiconnect.angelone.in';
const DATA_DIR = path.join(__dirname, '..', 'analysis', 'snapshots');

const INDEX_CONFIGS = {
  NIFTY: {
    spotToken: '99926000',
    exchange: 'NSE',
    optionExchange: 'NFO'
  },
  SENSEX: {
    spotToken: '99919000',
    exchange: 'BSE',
    optionExchange: 'BFO'
  }
};

async function collectSnapshot() {
  // Ensure data dir exists
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const symbols = ['NIFTY', 'SENSEX'];
  let loggedIn = false;
  let headers = null;

  for (const symbol of symbols) {
    // Check if there are active positions
    const posPath = path.join(__dirname, '..', 'data', `${symbol.toLowerCase()}_positions.json`);
    if (!fs.existsSync(posPath)) continue;
    const positions = JSON.parse(fs.readFileSync(posPath, 'utf8'));
    if (!positions.active) continue;

    const config = INDEX_CONFIGS[symbol];

    // Login once if needed
    if (!loggedIn) {
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

      headers = {
        'Content-Type': 'application/json', 'Accept': 'application/json',
        'X-UserType': 'USER', 'X-SourceID': 'WEB', 'X-ClientLocalIP': '192.168.1.1',
        'X-ClientPublicIP': '106.193.147.98', 'X-MACAddress': 'fe80::216:3eff:fe0f:1105',
        'Authorization': `Bearer ${jwtToken}`, 'X-PrivateKey': env.API_KEY,
      };
      loggedIn = true;
    }

    // Get spot LTP
    const spotRes = await axios({
      method: 'POST', url: `${BASE_URL}/rest/secure/angelbroking/market/v1/quote`,
      headers, data: { mode: 'LTP', exchangeTokens: { [config.exchange]: [config.spotToken] } }
    });
    const spot = parseFloat(spotRes.data.data.fetched[0].ltp);

    // Get leg LTPs
    const tokens = positions.legs.map(l => l.token);
    const ltpRes = await axios({
      method: 'POST', url: `${BASE_URL}/rest/secure/angelbroking/market/v1/quote`,
      headers, data: { mode: 'LTP', exchangeTokens: { [config.optionExchange]: tokens } }
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
      index: symbol,
      timestamp,
      ist,
      niftySpot: spot, // maintain backward compatibility
      spot,
      totalPnL,
      legs,
      entryMargin: positions.entryMargin,
      stopLoss: positions.stopLoss,
    };

    // Append to today's snapshot file
    const todayDate = now.toISOString().split('T')[0];
    const snapFile = path.join(DATA_DIR, `${todayDate}.jsonl`);
    fs.appendFileSync(snapFile, JSON.stringify(snapshot) + '\n');

    console.log(`[${ist}] ${symbol} Snapshot captured — P&L: ₹${totalPnL.toFixed(2)}`);
  }
}

collectSnapshot().catch(err => console.error('Snapshot error:', err.message));
