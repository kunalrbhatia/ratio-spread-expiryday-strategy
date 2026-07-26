import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { positionStores } from '../store/positionStore.js';
import { calculateCurrentPnL } from './monitorJob.js';
import { logger } from '../helpers/logger.js';

export const formatMtmTimestamp = (date?: Date): string => {
  const d = date || new Date();
  return d
    .toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
    .toLowerCase();
};

export const writeMtmSnapshot = (symbol: 'NIFTY' | 'SENSEX', now?: Date): void => {
  try {
    const d = now || new Date();
    const store = positionStores[symbol];
    if (!store) return;

    const positions = store.getPositions();
    if (!positions.active || !positions.legs || positions.legs.length === 0) {
      return;
    }

    const pnl = calculateCurrentPnL(positions.legs);
    const roundedPnL = Math.round(pnl * 100) / 100;

    const timestamp = formatMtmTimestamp(d);
    const logLine = `[${timestamp}] [INFO] ${symbol}: MTM = ${roundedPnL}\n`;

    const dateString = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const dirPath = path.join(process.cwd(), 'logs', 'mtm');
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    const logFilePath = path.join(dirPath, `mtm-${symbol.toLowerCase()}-${dateString}.log`);
    fs.appendFileSync(logFilePath, logLine, 'utf-8');
  } catch (error: any) {
    logger.error(`Failed to write MTM snapshot for ${symbol}: ${error.message}`);
  }
};

export const startMtmLogging = (): void => {
  cron.schedule(
    '* * * * 1-5',
    () => {
      writeMtmSnapshot('NIFTY');
      writeMtmSnapshot('SENSEX');
    },
    {
      timezone: 'Asia/Kolkata',
    },
  );
};
