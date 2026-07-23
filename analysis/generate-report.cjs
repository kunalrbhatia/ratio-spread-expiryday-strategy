#!/usr/bin/env node
/**
 * Post-Expiry Analysis Report Generator
 * Run after market close (3:20 PM IST) on expiry days
 * Generates a markdown report and pushes to GitHub
 */

const { authenticator } = require('otplib');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const env = {};
envContent.split('\n').filter(l => l.trim() && !l.startsWith('#')).forEach(line => {
  const [k, ...v] = line.split('=');
  env[k.trim()] = v.join('=').trim();
});

const BASE_URL = 'https://apiconnect.angelone.in';
const REPO_DIR = path.resolve(__dirname, '..');
const ANALYSIS_DIR = path.join(REPO_DIR, 'analysis');
const REPORTS_DIR = path.join(ANALYSIS_DIR, 'reports');

const INDEX_CONFIGS = {
  NIFTY: {
    symbol: 'NIFTY',
    spotToken: '99926000',
    exchange: 'NSE',
    optionExchange: 'NFO',
    titleName: 'Nifty',
    strategyType: 'Nifty Weekly Ratio Spread (Short 3, Long 1 on each side)'
  },
  SENSEX: {
    symbol: 'SENSEX',
    spotToken: '99919000',
    exchange: 'BSE',
    optionExchange: 'BFO',
    titleName: 'Sensex',
    strategyType: 'Sensex Weekly Ratio Spread (Short 3, Long 1 on each side)'
  }
};

async function generateReport() {
  // 1. Determine index symbol
  let symbol = process.argv[2]?.toUpperCase();
  if (symbol !== 'NIFTY' && symbol !== 'SENSEX') {
    // Autodetect based on active positions
    const niftyPath = path.join(REPO_DIR, 'data', 'nifty_positions.json');
    const sensexPath = path.join(REPO_DIR, 'data', 'sensex_positions.json');
    const niftyActive = fs.existsSync(niftyPath) && JSON.parse(fs.readFileSync(niftyPath, 'utf8')).active;
    const sensexActive = fs.existsSync(sensexPath) && JSON.parse(fs.readFileSync(sensexPath, 'utf8')).active;

    if (niftyActive && !sensexActive) {
      symbol = 'NIFTY';
    } else if (sensexActive && !niftyActive) {
      symbol = 'SENSEX';
    } else {
      // Look at which one has legs populated
      const niftyLegs = fs.existsSync(niftyPath) && (JSON.parse(fs.readFileSync(niftyPath, 'utf8')).legs?.length > 0);
      const sensexLegs = fs.existsSync(sensexPath) && (JSON.parse(fs.readFileSync(sensexPath, 'utf8')).legs?.length > 0);
      if (niftyLegs && !sensexLegs) {
        symbol = 'NIFTY';
      } else if (sensexLegs && !niftyLegs) {
        symbol = 'SENSEX';
      } else {
        // Fallback to current expiry day
        const today = new Date();
        const kolkataDate = new Date(today.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const day = kolkataDate.getDay();
        if (day === 4) { // Thursday is Sensex
          symbol = 'SENSEX';
        } else {
          symbol = 'NIFTY'; // Default
        }
      }
    }
  }

  const config = INDEX_CONFIGS[symbol];
  const now = new Date();
  const expiryDate = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).replace(/\s/g, '-');
  const isoDate = now.toISOString().split('T')[0];

  console.log(`📊 Generating post-expiry analysis for ${symbol} on ${expiryDate}`);

  // 2. Load snapshot data
  const snapshotsDir = path.join(ANALYSIS_DIR, 'snapshots');
  const snapFile = path.join(snapshotsDir, `${isoDate}.jsonl`);
  let snapshots = [];
  let loadedSnapFile = snapFile;

  if (fs.existsSync(snapFile)) {
    const allSnaps = fs.readFileSync(snapFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    snapshots = allSnaps.filter(s => s.index === symbol || (!s.index && symbol === 'NIFTY'));
  } else if (fs.existsSync(snapshotsDir)) {
    // Fallback: look for the most recent snapshot file containing data for this index
    const files = fs.readdirSync(snapshotsDir)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .reverse();

    for (const f of files) {
      const filePath = path.join(snapshotsDir, f);
      const allSnaps = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
      const filtered = allSnaps.filter(s => s.index === symbol || (!s.index && symbol === 'NIFTY'));
      if (filtered.length > 0) {
        snapshots = filtered;
        loadedSnapFile = filePath;
        console.log(`ℹ️  No snapshot file for ${isoDate}. Using latest available snapshot file: ${f}`);
        break;
      }
    }
  }

  // 3. Load positions
  const posPath = path.join(REPO_DIR, 'data', `${symbol.toLowerCase()}_positions.json`);
  let finalState = null;
  if (fs.existsSync(posPath)) {
    finalState = JSON.parse(fs.readFileSync(posPath, 'utf8'));
  }

  // 4. Fetch final data — try broker position book first for accuracy, then LTPs, then snapshots
  let finalPnL = 0;
  let finalLegs = [];
  let finalSpot = 0;

  // Always attempt broker position book for actual P&L (works even after positions cleared)
  try {
    const totp = authenticator.generate(env.CLIENT_TOTP_PIN);
    const loginRes = await axios({
      method: 'POST', url: `${BASE_URL}/rest/auth/angelbroking/user/v1/loginByPassword`,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json',
        'X-UserType': 'USER', 'X-SourceID': 'WEB', 'X-ClientLocalIP': '192.168.1.1',
        'X-ClientPublicIP': '106.193.147.98', 'X-MACaddress': 'fe80::216:3eff:fe0f:1105',
        'X-PrivateKey': env.API_KEY,
      },
      data: { clientcode: env.CLIENT_CODE, password: env.CLIENT_PIN, totp }
    });
    const { jwtToken } = loginRes.data.data;
    const headers = {
      'Content-Type': 'application/json', 'Accept': 'application/json',
      'X-UserType': 'USER', 'X-SourceID': 'WEB', 'X-ClientLocalIP': '192.168.1.1',
      'X-ClientPublicIP': '106.193.147.98', 'X-MACaddress': 'fe80::216:3eff:fe0f:1105',
      'Authorization': `Bearer ${jwtToken}`, 'X-PrivateKey': env.API_KEY,
    };

    // Fetch spot price
    try {
      const spotRes = await axios({
        method: 'POST', url: `${BASE_URL}/rest/secure/angelbroking/market/v1/quote`,
        headers, data: { mode: 'LTP', exchangeTokens: { [config.exchange]: [config.spotToken] } }
      });
      finalSpot = parseFloat(spotRes.data.data.fetched[0].ltp);
    } catch (spotErr) {}

    // Fetch broker position book for actual P&L
    try {
      const posRes = await axios({
        method: 'GET', url: `${BASE_URL}/rest/secure/angelbroking/order/v1/getPosition`,
        headers,
      });
      const posData = posRes.data.data || [];
      const idxPos = posData.filter(p => p.symbolname === symbol.toUpperCase());
      const brokerPnl = idxPos.reduce((s, p) => s + parseFloat(p.pnl || 0), 0);
      if (brokerPnl !== 0) {
        finalPnL = brokerPnl;
        console.log(`📊 Using broker position book P&L: ₹${brokerPnl}`);
      }
      // Also get leg details from broker if available
      if (idxPos.length > 0) {
        finalLegs = idxPos.map(p => ({
          symbol: p.tradingsymbol, direction: p.netqty > 0 ? 'BUY' : 'SELL',
          qty: Math.abs(parseInt(p.netqty || 0)), entry: parseFloat(p.totalbuyavgprice || p.totalsellavgprice || 0),
          ltp: parseFloat(p.ltp || 0), pnl: parseFloat(p.pnl || 0)
        }));
      }
    } catch (posErr) {
      console.warn('⚠️  Could not fetch broker position book');
    }

    // If broker data missing legs, try position file or LTPs
    if (finalLegs.length === 0 && finalState && finalState.legs && finalState.legs.length > 0) {
      try {
        const tokens = finalState.legs.map(l => l.token);
        const ltpRes = await axios({
          method: 'POST', url: `${BASE_URL}/rest/secure/angelbroking/market/v1/quote`,
          headers, data: { mode: 'LTP', exchangeTokens: { [config.optionExchange]: tokens } }
        });
        const ltpMap = new Map();
        for (const item of ltpRes.data.data.fetched) ltpMap.set(item.symbolToken, parseFloat(item.ltp));
        finalLegs = finalState.legs.map(leg => {
          const cp = ltpMap.get(leg.token) ?? leg.entryPremium;
          const pnl = leg.direction === 'BUY' ? (cp - leg.entryPremium) * leg.qty : (leg.entryPremium - cp) * leg.qty;
          return { symbol: leg.symbol, direction: leg.direction, qty: leg.qty, entry: leg.entryPremium, ltp: cp, pnl };
        });
      } catch (ltpErr) {}
    }
  } catch (err) {
    console.error('API fetch failed:', err.message);
    // Fallback to snapshot history
    if (snapshots.length > 0) {
      const last = snapshots[snapshots.length - 1];
      finalPnL = last.totalPnL;
      finalLegs = last.legs || [];
      finalSpot = last.spot || last.niftySpot;
    }
  }

  // 5. Calculate metrics
  let maxPnL = finalPnL;
  let maxPnLTime = '';
  let minPnL = finalPnL;
  let minPnLTime = '';

  if (snapshots.length > 0) {
    let maxSnap = snapshots[0];
    let minSnap = snapshots[0];
    for (const s of snapshots) {
      if (s.totalPnL > maxSnap.totalPnL) maxSnap = s;
      if (s.totalPnL < minSnap.totalPnL) minSnap = s;
    }
    maxPnL = maxSnap.totalPnL;
    maxPnLTime = maxSnap.ist?.split(',')[1]?.trim() || '';
    minPnL = minSnap.totalPnL;
    minPnLTime = minSnap.ist?.split(',')[1]?.trim() || '';
  }

  const entrySpot = snapshots.length > 0 ? (snapshots[0].spot || snapshots[0].niftySpot) : finalSpot;
  const spotChange = finalSpot - entrySpot;

  // Format P&L helper
  const formatPnL = (val) => {
    const sign = val >= 0 ? '+' : '-';
    return `${val >= 0 ? '🟢' : '🔴'} ${sign}₹${Math.abs(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // 6. Build report
  const report = [
    `# ${config.titleName} Expiry Day Analysis — ${expiryDate}`,
    ``,
    `## Summary`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| **Index** | ${config.titleName} |`,
    `| **Expiry Date** | ${expiryDate} |`,
    `| **Spot Entry** | ₹${entrySpot.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} |`,
    `| **Spot Close** | ₹${finalSpot.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} |`,
    `| **Spot Change** | ${spotChange >= 0 ? '+' : ''}${spotChange.toFixed(2)} pts |`,
    `| **Final P&L** | ${formatPnL(finalPnL)} |`,
    `| **Max P&L** | ${formatPnL(maxPnL)}${maxPnLTime ? ` (at ${maxPnLTime})` : ''} |`,
    `| **Min P&L** | ${formatPnL(minPnL)}${minPnLTime ? ` (at ${minPnLTime})` : ''} |`,
    `| **Entry Margin** | ₹${(finalState?.entryMargin || 350000).toLocaleString('en-IN')} |`,
    `| **Return on Margin** | ${finalState?.entryMargin ? ((finalPnL / finalState.entryMargin) * 100).toFixed(2) : '0.00'}% |`,
    ``,
  ];

  if (finalLegs.length > 0) {
    report.push(`## Positions at Close`, ``);
    report.push(`| Leg | Direction | Qty | Entry | Close | P&L |`);
    report.push(`|-----|:---------:|:---:|:----:|:----:|:---:|`);
    for (const leg of finalLegs) {
      const pnlSign = leg.pnl >= 0 ? '🟢 +' : '🔴 -';
      report.push(`| ${leg.symbol} | ${leg.direction === 'BUY' ? '🟢 Long' : '🔴 Short'} | ${leg.qty} | ₹${leg.entry.toFixed(2)} | ₹${leg.ltp.toFixed(2)} | ${pnlSign}₹${Math.abs(leg.pnl).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} |`);
    }
    report.push(``);
  }

  if (snapshots.length > 0) {
    report.push(`## P&L Timeline`, ``);
    report.push(`| Time (IST) | ${config.titleName} Spot | P&L |`);
    report.push(`|------------|:----------:|:---:|`);
    for (const snap of snapshots) {
      const time = snap.ist.split(',')[1]?.trim() || snap.ist;
      const snapSpot = snap.spot || snap.niftySpot;
      report.push(`| ${time} | ₹${snapSpot.toLocaleString('en-IN', { minimumFractionDigits: 2 })} | ${snap.totalPnL >= 0 ? '🟢' : '🔴'} ₹${snap.totalPnL.toFixed(2)} |`);
    }
    report.push(``);
  }

  // Strategy notes
  report.push(`## Strategy Details`, ``);
  report.push(`**Type:** ${config.strategyType}`);
  report.push(`**Entry Time:** ~9:20 AM IST (market open on expiry day)`);
  report.push(`**Exit Time:** ~3:20 PM IST (market close square-off)`);
  report.push(`**Stop Loss:** 1% of utilized margin`);
  report.push(``);
  report.push(`## Notes`, ``);
  
  if (symbol === 'SENSEX') {
    const changePct = ((spotChange / entrySpot) * 100).toFixed(2);
    report.push(`Sensex moved from ₹${entrySpot.toLocaleString('en-IN', { maximumFractionDigits: 2 })} to ₹${finalSpot.toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${changePct}% change) on the expiry day.`);
  } else {
    report.push(`Nifty moved from ₹${entrySpot.toLocaleString('en-IN', { maximumFractionDigits: 2 })} to ₹${finalSpot.toLocaleString('en-IN', { maximumFractionDigits: 2 })} on the expiry day.`);
  }
  
  report.push(``);
  report.push(`_Auto-generated post-expiry analysis by Hermes_`);

  const reportContent = report.join('\n');

  // 7. Save report
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  
  const prefixReportFile = path.join(REPORTS_DIR, `expiry-${symbol.toLowerCase()}-${isoDate}.md`);
  
  fs.writeFileSync(prefixReportFile, reportContent);
  
  console.log(`✅ Report saved: ${prefixReportFile}`);

  // 8. Commit & push to GitHub
  try {
    console.log('\n📤 Pushing to GitHub...');
    execSync('git add -A analysis/', { cwd: REPO_DIR, stdio: 'pipe' });
    execSync(`git commit -m "post-expiry: add analysis report for ${isoDate}"`, { cwd: REPO_DIR, stdio: 'pipe' });
    
    try {
      execSync('git push', { cwd: REPO_DIR, stdio: 'pipe' });
      console.log('✅ Pushed to GitHub successfully');
    } catch (pushErr) {
      try {
        execSync('gh auth status', { cwd: REPO_DIR, stdio: 'pipe' });
        execSync('git push', { cwd: REPO_DIR, stdio: 'pipe' });
        console.log('✅ Pushed via gh auth');
      } catch (ghErr) {
        console.log('⚠️  Push failed — commit is ready locally.');
      }
    }
  } catch (commitErr) {
    if (commitErr.message.includes('nothing to commit')) {
      console.log('ℹ️  Nothing new to commit');
    } else {
      console.log('⚠️  Git error:', commitErr.message);
    }
  }

  console.log(`\n✅ Post-expiry analysis complete for ${expiryDate}`);
}

generateReport().catch(err => console.error('Report generation failed:', err.message));
