import { spawn } from 'child_process';
import readline from 'readline';
import fs from 'fs';
import dotenv from 'dotenv';
import { logger } from '../helpers/logger.js';
import { INDEX_CONFIGS } from '../helpers/constants.js';
import { getATMStrike } from '../helpers/marketData.js';

dotenv.config();

/**
 * Single minute tick data structure parsed from CSV / JSON data streams.
 */
export interface BacktestConfig {
  sshHost?: string;
  sshUser?: string;
  sshPort?: number;
  sshKeyPath?: string;
  remoteDataPath?: string;
  localDataPath?: string;
  symbol: 'NIFTY' | 'SENSEX';
  startDate?: string;
  endDate?: string;
}

export interface ActiveTrade {
  entryTime: string;
  spot: number;
  atmStrike: number;
  longCE: { strike: number; entryPrice: number; currentPrice: number; qty: number };
  longPE: { strike: number; entryPrice: number; currentPrice: number; qty: number };
  shortCE: { strike: number; entryPrice: number; currentPrice: number; qty: number };
  shortPE: { strike: number; entryPrice: number; currentPrice: number; qty: number };
  margin: number;
  stopLoss: number;
  status: 'OPEN' | 'CLOSED';
  exitTime?: string;
  exitReason?: string;
  pnl?: number;
}

/**
 * Execute SSH command or local stream with low memory footprint (< 50MB RAM).
 * Reads line by line without storing full datasets in memory.
 */
export async function runBacktest(config: BacktestConfig) {
  logger.info('==================================================');
  logger.info(`Starting Low-Memory SSH Backtest for ${config.symbol}...`);
  logger.info('==================================================');

  const sshUser = config.sshUser || process.env.DATA_SSH_USER || 'ubuntu';
  const sshHost = config.sshHost || process.env.DATA_SSH_HOST;
  const remotePath =
    config.remoteDataPath || process.env.DATA_REMOTE_PATH || '/data/nifty-optionchain';
  const localPath = config.localDataPath || process.env.LOCAL_DATA_PATH;

  let stream: NodeJS.ReadableStream;

  if (sshHost) {
    logger.info(`Connecting via SSH stream to ${sshUser}@${sshHost}:${remotePath}`);
    const sshArgs = ['-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes'];
    if (config.sshPort || process.env.DATA_SSH_PORT) {
      sshArgs.push('-p', String(config.sshPort || process.env.DATA_SSH_PORT));
    }
    if (config.sshKeyPath || process.env.DATA_SSH_KEY) {
      sshArgs.push('-i', String(config.sshKeyPath || process.env.DATA_SSH_KEY));
    }

    const passphrase = process.env.KEY_PASSPHRASE;
    const remoteCmd = `find ${remotePath} -type f \\( -name "*.csv" -o -name "*.csv.gz" \\) | sort | xargs -r zcat -f`;
    sshArgs.push(`${sshUser}@${sshHost}`, remoteCmd);

    let sshProcess;
    if (passphrase) {
      // Use sshpass to pass key passphrase non-interactively in automated low-memory execution
      sshProcess = spawn('sshpass', ['-p', passphrase, 'ssh', ...sshArgs]);
    } else {
      sshProcess = spawn('ssh', sshArgs);
    }

    sshProcess.stderr.on('data', (data) => {
      logger.debug(`SSH Stderr: ${data.toString().trim()}`);
    });
    stream = sshProcess.stdout;
  } else if (localPath && fs.existsSync(localPath)) {
    logger.info(`Reading local dataset stream from ${localPath}...`);
    stream = fs.createReadStream(localPath);
  } else {
    throw new Error(
      'Neither SSH remote credentials nor local data path provided. Set DATA_SSH_HOST in .env or provide localDataPath.',
    );
  }

  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  const indexConfig = INDEX_CONFIGS[config.symbol];
  let activeTrade: ActiveTrade | null = null;
  const completedTrades: ActiveTrade[] = [];

  let lineCount = 0;
  for await (const line of rl) {
    lineCount++;
    if (!line || line.startsWith('timestamp') || line.startsWith('datetime')) continue;

    const parts = line.split(',');
    if (parts.length < 5) continue;

    // Standard expected format: timestamp, spot, strike, type, ltp
    const timestamp = parts[0].trim();
    const spot = parseFloat(parts[1]);
    const strike = parseFloat(parts[2]);
    const type = parts[3].trim().toUpperCase() as 'CE' | 'PE';
    const ltp = parseFloat(parts[4]);

    if (isNaN(spot) || isNaN(strike) || isNaN(ltp)) continue;

    const timePart = timestamp.includes('T') ? timestamp.split('T')[1] : timestamp.split(' ')[1];
    if (!timePart) continue;

    const timeClean = timePart.substring(0, 5); // HH:MM

    // 1. Entry Trigger at 09:20 AM
    if (timeClean === '09:20' && !activeTrade) {
      const atmStrike = getATMStrike(spot, indexConfig.strikeStep);
      const estMargin = 130000; // Standard estimated margin per ratio spread lot

      activeTrade = {
        entryTime: timestamp,
        spot,
        atmStrike,
        longCE: { strike: atmStrike, entryPrice: ltp, currentPrice: ltp, qty: indexConfig.lotSize },
        longPE: { strike: atmStrike, entryPrice: ltp, currentPrice: ltp, qty: indexConfig.lotSize },
        shortCE: {
          strike: atmStrike + 300,
          entryPrice: ltp / 3,
          currentPrice: ltp / 3,
          qty: indexConfig.lotSize * 3,
        },
        shortPE: {
          strike: atmStrike - 300,
          entryPrice: ltp / 3,
          currentPrice: ltp / 3,
          qty: indexConfig.lotSize * 3,
        },
        margin: estMargin,
        stopLoss: estMargin * 0.01, // 1% stop loss
        status: 'OPEN',
      };
      logger.info(`Opened Trade at ${timestamp} | Spot: ${spot} | ATM: ${atmStrike}`);
    }

    // 2. Mark-to-Market Monitoring & Stop-loss check
    if (activeTrade && activeTrade.status === 'OPEN') {
      if (strike === activeTrade.longCE.strike && type === 'CE')
        activeTrade.longCE.currentPrice = ltp;
      if (strike === activeTrade.longPE.strike && type === 'PE')
        activeTrade.longPE.currentPrice = ltp;
      if (strike === activeTrade.shortCE.strike && type === 'CE')
        activeTrade.shortCE.currentPrice = ltp;
      if (strike === activeTrade.shortPE.strike && type === 'PE')
        activeTrade.shortPE.currentPrice = ltp;

      const longPnl =
        (activeTrade.longCE.currentPrice - activeTrade.longCE.entryPrice) * activeTrade.longCE.qty +
        (activeTrade.longPE.currentPrice - activeTrade.longPE.entryPrice) * activeTrade.longPE.qty;

      const shortPnl =
        (activeTrade.shortCE.entryPrice - activeTrade.shortCE.currentPrice) *
          activeTrade.shortCE.qty +
        (activeTrade.shortPE.entryPrice - activeTrade.shortPE.currentPrice) *
          activeTrade.shortPE.qty;

      const currentPnl = longPnl + shortPnl;

      // Check Stop-Loss
      if (currentPnl <= -activeTrade.stopLoss) {
        activeTrade.status = 'CLOSED';
        activeTrade.exitTime = timestamp;
        activeTrade.exitReason = '1% Margin Stop-Loss Hit';
        activeTrade.pnl = currentPnl;
        completedTrades.push({ ...activeTrade });
        logger.info(`Closed Trade (SL) at ${timestamp} | PnL: ₹${currentPnl.toFixed(2)}`);
        activeTrade = null;
      }
      // Check 03:20 PM Expiry Market Close Exit
      else if (timeClean === '15:20') {
        activeTrade.status = 'CLOSED';
        activeTrade.exitTime = timestamp;
        activeTrade.exitReason = 'Market Close Square-Off (15:20)';
        activeTrade.pnl = currentPnl;
        completedTrades.push({ ...activeTrade });
        logger.info(
          `Closed Trade (Target/Expiry) at ${timestamp} | PnL: ₹${currentPnl.toFixed(2)}`,
        );
        activeTrade = null;
      }
    }
  }

  logger.info(
    `Processed ${lineCount} rows of data stream. Total trades executed: ${completedTrades.length}`,
  );
  return completedTrades;
}
