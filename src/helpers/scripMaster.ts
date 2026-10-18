import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { CONSTANTS, INDEX_CONFIGS, SupportedIndex } from './constants.js';
import { requestWithRetry } from './api.js';
import { isExpiryDayForSymbol } from './holidayCheck.js';

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

export const getNextWeeklyExpiryDate = (
  symbol: SupportedIndex | string,
  fromDate: Date = new Date(),
): string => {
  const date = new Date(fromDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  // Iterate day by day up to 8 days to find the next expiry day
  for (let i = 0; i < 8; i++) {
    const checkDate = new Date(date);
    checkDate.setDate(date.getDate() + i);
    if (isExpiryDayForSymbol(symbol as any, checkDate)) {
      return formatScripExpiryDate(checkDate);
    }
  }
  return '';
};

// Formats date to DDMMMYYYY (e.g. 15JUL2026) matching Angel One format (all uppercase month)
export const formatScripExpiryDate = (date: Date): string => {
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
  symbol: SupportedIndex | string = 'NIFTY',
): Promise<boolean> => {
  try {
    logger.info(`Downloading Angel One scrip master headers for ${symbol}...`);
    const response = await requestWithRetry(() =>
      axios({
        method: 'GET',
        url: CONSTANTS.SCRIP_MASTER_URL,
        responseType: 'json',
      }),
    );

    if (!Array.isArray(response.data)) {
      throw new Error('Scrip master response is not an array');
    }

    logger.info(
      `Downloaded ${response.data.length} total scrip headers. Filtering ${symbol} option contracts...`,
    );

    const nextExpiry = getNextWeeklyExpiryDate(symbol);
    logger.info(`Target weekly expiry date for ${symbol}: ${nextExpiry}`);

    const config = INDEX_CONFIGS[symbol as SupportedIndex];
    if (!config) {
      throw new Error(`Unsupported instrument config for ${symbol}`);
    }

    // Filter contracts
    const filtered: ScripItem[] = response.data.filter((item: ScripItem) => {
      const matchesSymbol = item.name === config.symbol;
      const matchesExchange = item.exch_seg === config.optionExchange;
      const matchesType = item.instrumenttype === 'OPTIDX';
      const matchesExpiry = nextExpiry ? item.expiry === nextExpiry : true;
      return matchesSymbol && matchesExchange && matchesType && matchesExpiry;
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

export const getCachedScrips = (symbol: SupportedIndex | string = 'NIFTY'): ScripItem[] => {
  const cachePath = path.join(process.cwd(), 'data', `scrip-master-${symbol.toLowerCase()}.json`);
  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  }
  return [];
};
