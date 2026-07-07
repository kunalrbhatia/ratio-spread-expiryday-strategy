#!/usr/bin/env node
/**
 * Post-Expiry Analysis Report Generator
 * Run after market close (3:30 PM IST) on expiry days
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

const NIFTY_SPOT_TOKEN=Buffer.from([57,57,57,50,54,48,48,48]).toString();
const BASE_URL = 'https://apiconnect.angelone.in';
const REPO_DIR = path.resolve(__dirname, '..');
const ANALYSIS_DIR = path.join(REPO_DIR, 'analysis');
const REPORTS_DIR = path.join(ANALYSIS_DIR, 'reports');


async function generateReport() {
  // 1. Determine expiry date
  const now = new Date();
  const expiryDate = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).replace(/\s/g, '-');
  const isoDate = now.toISOString().split('T')[0];
  const weekNum = Math.ceil(new Date().getDate() / 7);

  console.log(`📊 Generating post-expiry analysis for ${expiryDate}`);

  // 2. Load snapshot data
  const snapFile = path.join(ANALYSIS_DIR, 'snapshots', `${isoDate}.jsonl`);
  let snapshots = [];
  if (fs.existsSync(snapFile)) {
    snapshots = fs.readFileSync(snapFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  }

  // 3. Load final positions
  const posPath = path.join(REPO_DIR, 'data', 'positions.json');
  let finalState = null;
  if (fs.existsSync(posPath)) {
    finalState = JSON.parse(fs.readFileSync(posPath, 'utf8'));
  }

  // 4. Fetch final LTPs from API
  let finalPnL = 0;
  let finalLegs = [];
  let finalSpot = 0;

  if (finalState && finalState.active) {
    try {
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
      const { jwtToken } = loginRes.data.data;
      const headers = {
        'Content-Type': 'application/json', 'Accept': 'application/json',
        'X-UserType': 'USER', 'X-SourceID': 'WEB', 'X-ClientLocalIP': '192.168.1.1',
        'X-ClientPublicIP': '106.193.147.98', 'X-MACAddress': 'fe80::216:3eff:fe0f:1105',
        'Authorization': `Bearer ${jwtToken}`, 'X-PrivateKey': env.API_KEY,
      };

      const spotRes = await axios({
        method: 'POST', url: `${BASE_URL}/rest/secure/angelbroking/market/v1/quote`,
        headers, data: { mode: 'LTP', exchangeTokens: { NSE: [NIFTY_SPOT_TOKEN] } }
      });
      finalSpot = parseFloat(spotRes.data.data.fetched[0].ltp);

      const tokens = finalState.legs.map(l => l.token);
      const ltpRes = await axios({
        method: 'POST', url: `${BASE_URL}/rest/secure/angelbroking/market/v1/quote`,
        headers, data: { mode: 'LTP', exchangeTokens: { NFO: tokens } }
      });
      const ltpMap = new Map();
      for (const item of ltpRes.data.data.fetched) {
        ltpMap.set(item.symbolToken, parseFloat(item.ltp));
      }

      finalLegs = finalState.legs.map(leg => {
        const cp = ltpMap.get(leg.token) ?? leg.entryPremium;
        const pnl = leg.direction === 'BUY' ? (cp - leg.entryPremium) * leg.qty : (leg.entryPremium - cp) * leg.qty;
        finalPnL += pnl;
        return { symbol: leg.symbol, direction: leg.direction, qty: leg.qty, entry: leg.entryPremium, ltp: cp, pnl };
      });
    } catch (e) {
      console.error('API fetch failed, using last snapshot:', e.message);
      // Fallback to last snapshot
      if (snapshots.length > 0) {
        const last = snapshots[snapshots.length - 1];
        finalPnL = last.totalPnL;
        finalLegs = last.legs;
        finalSpot = last.niftySpot;
      }
    }
  }

  // 5. Calculate metrics
  const maxPnL = snapshots.length > 0 ? Math.max(...snapshots.map(s => s.totalPnL)) : finalPnL;
  const minPnL = snapshots.length > 0 ? Math.min(...snapshots.map(s => s.totalPnL)) : finalPnL;
  const entrySpot = snapshots.length > 0 ? snapshots[0].niftySpot : 0;
  const spotChange = finalSpot - entrySpot;

  // 6. Build report
  const report = [
    `# Expiry Day Analysis — ${expiryDate}`,
    ``,
    `## Summary`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| **Expiry Date** | ${expiryDate} |`,
    `| **Nifty Entry** | ₹${entrySpot.toFixed(2)} |`,
    `| **Nifty Close** | ₹${finalSpot.toFixed(2)} |`,
    `| **Spot Change** | ${spotChange >= 0 ? '+' : ''}${spotChange.toFixed(2)} pts |`,
    `| **Final P&L** | ${finalPnL >= 0 ? '🟢' : '🔴'} ₹${finalPnL.toFixed(2)} |`,
    `| **Max P&L** | ₹${maxPnL.toFixed(2)} |`,
    `| **Min P&L** | ₹${minPnL.toFixed(2)} |`,
    `| **Entry Margin** | ₹${(finalState?.entryMargin || 0).toLocaleString()} |`,
    `| **Return on Margin** | ${finalState?.entryMargin ? ((finalPnL / finalState.entryMargin) * 100).toFixed(2) : 'N/A'}% |`,
    ``,
  ];

  if (finalLegs.length > 0) {
    report.push(`## Positions at Close`, ``);
    report.push(`| Leg | Direction | Qty | Entry | LTP | P&L |`);
    report.push(`|-----|:---------:|:---:|:----:|:---:|:---:|`);
    for (const leg of finalLegs) {
      report.push(`| ${leg.symbol} | ${leg.direction === 'BUY' ? '🟢 Long' : '🔴 Short'} | ${leg.qty} | ₹${leg.entry} | ₹${leg.ltp} | ${leg.pnl >= 0 ? '🟢' : '🔴'} ₹${leg.pnl.toFixed(2)} |`);
    }
    report.push(``);
  }

  if (snapshots.length > 0) {
    report.push(`## P&L Timeline`, ``);
    report.push(`| Time (IST) | Nifty Spot | P&L |`);
    report.push(`|------------|:----------:|:---:|`);
    for (const snap of snapshots) {
      const time = snap.ist.split(',')[1]?.trim() || snap.ist;
      report.push(`| ${time} | ₹${snap.niftySpot.toFixed(2)} | ${snap.totalPnL >= 0 ? '🟢' : '🔴'} ₹${snap.totalPnL.toFixed(2)} |`);
    }
    report.push(``);
  }

  // Strategy notes
  report.push(`## Strategy Details`, ``);
  report.push(`**Type:** Nifty Weekly Ratio Spread (Short 3, Long 1 on each side)`);
  report.push(`**Entry Time:** ~9:20 AM IST (market open on expiry day)`);
  report.push(`**Exit Time:** ~3:30 PM IST (market close square-off)`);
  report.push(`**Stop Loss:** 1% of utilized margin`);
  report.push(``);
  report.push(`## Notes`, ``);
  report.push(`_Auto-generated post-expiry analysis by Hermes_`);

  const reportContent = report.join('\n');

  // 7. Save report
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const reportFile = path.join(REPORTS_DIR, `expiry-${isoDate}.md`);
  fs.writeFileSync(reportFile, reportContent);
  console.log(`✅ Report saved: ${reportFile}`);

  // 8. Commit & push to GitHub
  try {
    console.log('\n📤 Pushing to GitHub...');
    execSync('git add -A analysis/', { cwd: REPO_DIR, stdio: 'pipe' });
    execSync(`git commit -m "post-expiry: add analysis report for ${isoDate}"`, { cwd: REPO_DIR, stdio: 'pipe' });
    
    // Push via HTTPS with token if available, otherwise let user handle
    try {
      execSync('git push', { cwd: REPO_DIR, stdio: 'pipe' });
      console.log('✅ Pushed to GitHub successfully');
    } catch (pushErr) {
      // Try with token from env or gh CLI
      try {
        execSync('gh auth status', { cwd: REPO_DIR, stdio: 'pipe' });
        execSync('git push', { cwd: REPO_DIR, stdio: 'pipe' });
        console.log('✅ Pushed via gh auth');
      } catch (ghErr) {
        console.log('⚠️  Push failed — you may need to auth gh CLI manually:');
        console.log('   gh auth login');
        console.log('   Then this will auto-push next expiry.');
        console.log('   Commit is ready locally: git push');
      }
    }
  } catch (commitErr) {
    if (commitErr.message.includes('nothing to commit')) {
      console.log('ℹ️  Nothing new to commit');
    } else {
      console.log('⚠️  Git error (non-critical):', commitErr.message);
    }
  }

  console.log(`\n✅ Post-expiry analysis complete for ${expiryDate}`);
}

generateReport().catch(err => console.error('Report generation failed:', err.message));
