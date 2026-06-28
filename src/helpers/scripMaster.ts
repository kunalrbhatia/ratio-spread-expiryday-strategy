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

export const getNextWeeklyExpiryDate = (fromDate: Date = new Date()): string => {
  const date = new Date(fromDate.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  // Find next Tuesday (or Monday if Tuesday is holiday, but here we just find closest Tuesday/Monday expiry day)
  // Let's iterate day by day up to 7 days
  for (let i = 0; i < 8; i++) {
    const checkDate = new Date(date);
    checkDate.setDate(date.getDate() + i);
    const day = checkDate.getDay();

    // In options, weekly contracts expire on Tuesday (or previous trading day if Tuesday is holiday)
    // We can check if today is Tuesday, or if it is Monday and Tuesday is a holiday
    if (day === 2) {
      // Tuesday
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

export const downloadAndCacheScripMaster = async (): Promise<boolean> => {
  try {
    logger.info('Downloading Angel One scrip master header...');
    const response = await axios({
      method: 'GET',
      url: CONSTANTS.SCRIP_MASTER_URL,
      responseType: 'json',
    });

    if (!Array.isArray(response.data)) {
      throw new Error('Scrip master response is not an array');
    }

    logger.info(
      `Downloaded ${response.data.length} total scrip headers. Filtering Nifty option contracts...`,
    );

    const nextExpiry = getNextWeeklyExpiryDate();
    logger.info(`Target weekly expiry date: ${nextExpiry}`);

    // Filter contracts
    const filtered: ScripItem[] = response.data.filter((item: ScripItem) => {
      return (
        item.name === CONSTANTS.NIFTY_SYMBOL &&
        item.exch_seg === 'NFO' &&
        item.instrumenttype === 'OPTIDX' &&
        item.expiry === nextExpiry
      );
    });

    const cachePath = path.join(process.cwd(), 'data', 'scrip-master.json');
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(cachePath, JSON.stringify(filtered, null, 2), 'utf-8');
    logger.info(
      `Successfully cached ${filtered.length} Nifty option contracts to data/scrip-master.json`,
    );
    return true;
  } catch (error: any) {
    logger.error(`Failed to download or cache scrip master: ${error.message}`);
    return false;
  }
};

export const getCachedScrips = (): ScripItem[] => {
  const cachePath = path.join(process.cwd(), 'data', 'scrip-master.json');
  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  }
  return [];
};
