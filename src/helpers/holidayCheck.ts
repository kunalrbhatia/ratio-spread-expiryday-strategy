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

export const isWeekend = (date: Date): boolean => {
  const day = date.getDay();
  return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
};

export const isNSEHoliday = (date: Date): boolean => {
  const tzOffsetDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const formatted = tzOffsetDate.toISOString().split('T')[0];
  return NSE_HOLIDAYS_2026.includes(formatted);
};

export const isExpiryDayForSymbol = (symbol: 'NIFTY' | 'SENSEX', date: Date): boolean => {
  if (symbol === 'SENSEX' && !env.ENABLE_SENSEX_EXPIRY) {
    return false;
  }

  // Get date in Asia/Kolkata timezone
  const kolkataDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = kolkataDate.getDay();

  if (isWeekend(kolkataDate) || isNSEHoliday(kolkataDate)) {
    return false;
  }

  const targetDay = symbol === 'NIFTY' ? 2 : 4; // Tuesday = 2, Thursday = 4

  if (day === targetDay) {
    return true;
  }

  if (day < targetDay && day > 0) {
    // Shifts to previous trading day if target day is a holiday
    for (let d = day + 1; d <= targetDay; d++) {
      const checkDate = new Date(kolkataDate);
      checkDate.setDate(kolkataDate.getDate() + (d - day));
      if (!isNSEHoliday(checkDate)) {
        return false;
      }
    }
    return true;
  }

  return false;
};

export const isExpiryDay = (date: Date): boolean => {
  return isExpiryDayForSymbol('NIFTY', date);
};
