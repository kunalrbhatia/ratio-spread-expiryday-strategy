import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { CONSTANTS } from './constants.js';

export interface ScripItem {
  token: string;
  symbol: string;
  name: string;
  expiry: string;
  strike: string;
  lotsize: string;
  instrumenttype: string;
  exch_seg: string;
  tick_size: string;
}

import { INDEX_CONFIGS } from './constants.js';
import { isExpiryDayForSymbol } from './holidayCheck.js';

export const getNextWeeklyExpiryDate = (
  symbol: 'NIFTY' | 'SENSEX',
  fromDate: Date = new Date(),
): string => {
  const date = new Date(fromDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  // Iterate day by day up to 8 days to find the next expiry day
  for (let i = 0; i < 8; i++) {
    const checkDate = new Date(date);
    checkDate.setDate(date.getDate() + i);
    if (isExpiryDayForSymbol(symbol, checkDate)) {
      return formatScripExpiryDate(checkDate);
    }
  }
  return '';
};

// Formats date to DDMMMYYYY (e.g. 15JUL2026) matching Angel One format (all uppercase month)
const formatScripExpiryDate = (date: Date): string => {
  const day = String(date.getDate()).padStart(2, '0');
  const months = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day}${month}${year}`;
};

export const downloadAndCacheScripMaster = async (
  symbol: 'NIFTY' | 'SENSEX' = 'NIFTY',
): Promise<boolean> => {
  try {
    logger.info(`Downloading Angel One scrip master header for ${symbol}...`);
    const response = await axios({
      method: 'GET',
      url: CONSTANTS.SCRIP_MASTER_URL,
      responseType: 'json',
    });

    if (!Array.isArray(response.data)) {
      throw new Error('Scrip master response is not an array');
    }

    logger.info(
      `Downloaded ${response.data.length} total scrip headers. Filtering ${symbol} option contracts...`,
    );

    const nextExpiry = getNextWeeklyExpiryDate(symbol);
    logger.info(`Target weekly expiry date for ${symbol}: ${nextExpiry}`);

    const config = INDEX_CONFIGS[symbol];

    // Filter contracts
    const filtered: ScripItem[] = response.data.filter((item: ScripItem) => {
      return (
        item.name === config.symbol &&
        item.exch_seg === config.optionExchange &&
        item.instrumenttype === 'OPTIDX' &&
        item.expiry === nextExpiry
      );
    });

    const cachePath = path.join(process.cwd(), 'data', `scrip-master-${symbol.toLowerCase()}.json`);
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(cachePath, JSON.stringify(filtered, null, 2), 'utf-8');
    logger.info(
      `Successfully cached ${filtered.length} ${symbol} option contracts to data/scrip-master-${symbol.toLowerCase()}.json`,
    );
    return true;
  } catch (error: any) {
    logger.error(`Failed to download or cache scrip master for ${symbol}: ${error.message}`);
    return false;
  }
};

export const getCachedScrips = (symbol: 'NIFTY' | 'SENSEX' = 'NIFTY'): ScripItem[] => {
  const cachePath = path.join(process.cwd(), 'data', `scrip-master-${symbol.toLowerCase()}.json`);
  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  }
  return [];
};
