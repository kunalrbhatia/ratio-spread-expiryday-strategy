import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { sendAlert } from '../notifier.js';

let cachedHolidays: Record<string, string[]> | null = null;
const holidaysFilePath = path.join(process.cwd(), 'data', 'holidays.json');

// Load holidays configuration from data/holidays.json
export const loadHolidays = (): Record<string, string[]> => {
  if (cachedHolidays) return cachedHolidays;
  try {
    if (fs.existsSync(holidaysFilePath)) {
      const content = fs.readFileSync(holidaysFilePath, 'utf-8');
      cachedHolidays = JSON.parse(content);
    } else {
      logger.error(`Holidays file not found at ${holidaysFilePath}`);
      cachedHolidays = {};
    }
  } catch (error: any) {
    logger.error(`Failed to read holidays file: ${error.message}`);
    cachedHolidays = {};
  }
  return cachedHolidays || /* istanbul ignore next */ {};
};

// Reset cache for testing
export const resetHolidaysCache = (): void => {
  cachedHolidays = null;
};

// Helper to convert any Date object to a UTC Date reflecting Asia/Kolkata fields
export const getKolkataDate = (date: Date): Date => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  let monthStr = '';
  let dayStr = '';
  let yearStr = '';

  for (const part of parts) {
    if (part.type === 'year') yearStr = part.value;
    else if (part.type === 'month') monthStr = part.value;
    else if (part.type === 'day') dayStr = part.value;
  }

  return new Date(
    Date.UTC(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, parseInt(dayStr, 10)),
  );
};

export const isWeekend = (date: Date): boolean => {
  const kDate = getKolkataDate(date);
  const day = kDate.getUTCDay();
  return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
};

export const isNSEHoliday = (date: Date): boolean => {
  const kDate = getKolkataDate(date);
  const year = kDate.getUTCFullYear().toString();
  const holidays = loadHolidays();

  if (!holidays[year] || !Array.isArray(holidays[year])) {
    const warningMsg = `CRITICAL CONFIG WARNING: Missing trading holidays list for year ${year} in data/holidays.json! Do NOT assume this is a trading day.`;
    logger.error(warningMsg);
    // Asynchronously dispatch alert without blocking sync checks
    sendAlert(`🚨 <b>${warningMsg}</b>`).catch(() => {});
    return true; // Safe default: treat as non-trading day when holiday data is missing
  }

  const formatted = kDate.toISOString().split('T')[0];
  return holidays[year].includes(formatted);
};

export const isTradingDay = (date: Date): boolean => {
  return !isWeekend(date) && !isNSEHoliday(date);
};

export const isExpiryDayForSymbol = (
  symbol: 'NIFTY' | 'SENSEX' | 'BANKNIFTY',
  date: Date,
): boolean => {
  if (!isTradingDay(date)) {
    return false;
  }

  const kDate = getKolkataDate(date);
  const day = kDate.getUTCDay();

  // Standard expiry target day of week:
  // NIFTY: Tuesday (2) or Thursday depending on contract cycle; historically 2
  // SENSEX: Friday or Thursday; typically 4 (Thursday) or 5 (Friday)
  // BANKNIFTY: Wednesday (3)
  let targetDay = 2; // Default Tuesday
  if (symbol === 'NIFTY') {
    targetDay = 2; // Tuesday
  } else if (symbol === 'SENSEX') {
    targetDay = 4; // Thursday
  } else if (symbol === 'BANKNIFTY') {
    targetDay = 3; // Wednesday
  }

  // Start at the target date of the week (same week)
  const targetDate = new Date(kDate);
  targetDate.setUTCDate(kDate.getUTCDate() + (targetDay - day));

  // Step backward one day at a time to find the first valid trading day
  const checkDate = new Date(targetDate);
  while (!isTradingDay(checkDate)) {
    checkDate.setUTCDate(checkDate.getUTCDate() - 1);
  }

  // Compare checkDate with kDate (date only)
  const checkDateStr = checkDate.toISOString().split('T')[0];
  const kolkataDateStr = kDate.toISOString().split('T')[0];

  return checkDateStr === kolkataDateStr;
};

const MONTH_MAP_1_CHAR: Record<string, number> = {
  '1': 0,
  '2': 1,
  '3': 2,
  '4': 3,
  '5': 4,
  '6': 5,
  '7': 6,
  '8': 7,
  '9': 8,
  O: 9,
  N: 10,
  D: 11,
};

const MONTH_MAP_3_LETTER: Record<string, number> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

export const extractExpiryFromSymbol = (symbolString: string): Date | null => {
  try {
    // 1. Weekly format: e.g. NIFTY2671677400CE or BANKNIFTY2671677400CE
    const weeklyMatch = symbolString.match(
      /^(NIFTY|SENSEX|BANKNIFTY)(\d{2})([1-9OND])(\d{2})(\d+)(CE|PE)$/i,
    );
    if (weeklyMatch) {
      const year = 2000 + parseInt(weeklyMatch[2], 10);
      const monthChar = weeklyMatch[3].toUpperCase();
      const month = MONTH_MAP_1_CHAR[monthChar];
      const day = parseInt(weeklyMatch[4], 10);

      if (month !== undefined) {
        return new Date(Date.UTC(year, month, day));
      }
    }

    // 2. Monthly format: e.g. NIFTY26JUL24300CE
    const monthlyMatch = symbolString.match(
      /^(NIFTY|SENSEX|BANKNIFTY)(\d{2})([A-Z]{3})(\d+)(CE|PE)$/i,
    );
    if (monthlyMatch) {
      const year = 2000 + parseInt(monthlyMatch[2], 10);
      const monthStr = monthlyMatch[3].toUpperCase();
      const month = MONTH_MAP_3_LETTER[monthStr];

      if (month !== undefined) {
        const lastDay = new Date(Date.UTC(year, month + 1, 0));
        let day = lastDay.getUTCDate();
        const expiryDate = new Date(Date.UTC(year, month, day));
        while (expiryDate.getUTCDay() !== 4) {
          day--;
          expiryDate.setUTCDate(day);
        }
        return expiryDate;
      }
    }
  } catch {
    // Silent catch
  }
  return null;
};
