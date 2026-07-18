import { env } from '../config/env.js';

// Hardcoded list of NSE trading holidays for 2026 (Format: YYYY-MM-DD)
export const NSE_HOLIDAYS_2026 = [
  '2026-01-26', // Republic Day
  '2026-02-17', // Mahashivratri
  '2026-03-04', // Holi
  '2026-03-20', // Id-ul-Fitr (Ramadan Eid)
  '2026-04-03', // Good Friday
  '2026-04-14', // Dr. Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-05-27', // Id-ul-Zuha (Bakri Eid)
  '2026-06-25', // Muharram
  '2026-08-15', // Independence Day (Saturday, but listed)
  '2026-09-15', // Id-e-Milad (Eid-Milad)
  '2026-10-20', // Dussehra
  '2026-11-08', // Diwali (Sunday Laxmi Puja, Muhurat trading may run, but holiday)
  '2026-11-23', // Guru Nanak Jayanti
  '2026-12-25', // Christmas
];

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
  const formatted = kDate.toISOString().split('T')[0];
  return NSE_HOLIDAYS_2026.includes(formatted);
};

export const isExpiryDayForSymbol = (symbol: 'NIFTY' | 'SENSEX', date: Date): boolean => {
  if (symbol === 'SENSEX' && !env.ENABLE_SENSEX_EXPIRY) {
    return false;
  }

  if (isWeekend(date) || isNSEHoliday(date)) {
    return false;
  }

  const kDate = getKolkataDate(date);
  const day = kDate.getUTCDay();
  const targetDay = symbol === 'NIFTY' ? 2 : 4; // Tuesday = 2, Thursday = 4

  // Start at the target date of the week (same week)
  const targetDate = new Date(kDate);
  targetDate.setUTCDate(kDate.getUTCDate() + (targetDay - day));

  // Step backward one day at a time to find the first valid trading day
  const checkDate = new Date(targetDate);
  while (isWeekend(checkDate) || isNSEHoliday(checkDate)) {
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
    // 1. Try weekly format: e.g., SENSEX2671677400CE
    const weeklyMatch = symbolString.match(/^(NIFTY|SENSEX)(\d{2})([1-9OND])(\d{2})(\d+)(CE|PE)$/i);
    if (weeklyMatch) {
      const year = 2000 + parseInt(weeklyMatch[2], 10);
      const monthChar = weeklyMatch[3].toUpperCase();
      const month = MONTH_MAP_1_CHAR[monthChar];
      const day = parseInt(weeklyMatch[4], 10);

      if (month !== undefined) {
        return new Date(Date.UTC(year, month, day));
      }
    }

    // 2. Try monthly format: e.g., NIFTY26JUL24300CE
    const monthlyMatch = symbolString.match(/^(NIFTY|SENSEX)(\d{2})([A-Z]{3})(\d+)(CE|PE)$/i);
    if (monthlyMatch) {
      const year = 2000 + parseInt(monthlyMatch[2], 10);
      const monthStr = monthlyMatch[3].toUpperCase();
      const month = MONTH_MAP_3_LETTER[monthStr];

      if (month !== undefined) {
        const lastDay = new Date(Date.UTC(year, month + 1, 0));
        let day = lastDay.getUTCDate();
        const expiryDate = new Date(Date.UTC(year, month, day));
        while (expiryDate.getUTCDay() !== 4) {
          // 4 = Thursday
          day--;
          expiryDate.setUTCDate(day);
        }
        return expiryDate;
      }
    }
  } catch {
    // Silent catch to avoid breaking core flows
  }
  return null;
};

export const isExpiryDay = (date: Date): boolean => {
  return isExpiryDayForSymbol('NIFTY', date);
};
