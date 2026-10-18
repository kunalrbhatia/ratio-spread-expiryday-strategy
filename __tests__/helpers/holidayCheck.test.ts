import { jest } from '@jest/globals';
import fs from 'fs';
import {
  isWeekend,
  isNSEHoliday,
  isExpiryDayForSymbol,
  extractExpiryFromSymbol,
  loadHolidays,
  resetHolidaysCache,
  isTradingDay,
} from '../../src/helpers/holidayCheck.js';

describe('holidayCheck helper', () => {
  beforeEach(() => {
    resetHolidaysCache();
    jest.clearAllMocks();
  });

  afterEach(() => {
    resetHolidaysCache();
    jest.restoreAllMocks();
  });

  describe('isWeekend', () => {
    it('should return true for Saturday and Sunday', () => {
      expect(isWeekend(new Date('2026-06-27'))).toBe(true); // Saturday
      expect(isWeekend(new Date('2026-06-28'))).toBe(true); // Sunday
    });

    it('should return false for weekdays', () => {
      expect(isWeekend(new Date('2026-06-29'))).toBe(false); // Monday
    });
  });

  describe('isNSEHoliday and loadHolidays', () => {
    it('should return true for Republic Day', () => {
      expect(isNSEHoliday(new Date('2026-01-26'))).toBe(true);
    });

    it('should return false for a regular trading day', () => {
      expect(isNSEHoliday(new Date('2026-06-29'))).toBe(false);
    });

    it('should alert and return true if year is missing from holidays', () => {
      // Date in year 2029 where holidays are missing
      const date2029 = new Date('2029-06-15');
      expect(isNSEHoliday(date2029)).toBe(true);
    });

    it('should handle file not existing gracefully', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      resetHolidaysCache();
      const holidays = loadHolidays();
      expect(holidays).toEqual({});
    });

    it('should handle readFileSync throwing error gracefully', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('Disk read error');
      });
      resetHolidaysCache();
      const holidays = loadHolidays();
      expect(holidays).toEqual({});
    });
  });

  describe('isTradingDay', () => {
    it('should return true for normal trading day and false for weekend/holiday', () => {
      expect(isTradingDay(new Date('2026-06-29'))).toBe(true);
      expect(isTradingDay(new Date('2026-06-28'))).toBe(false); // weekend
      expect(isTradingDay(new Date('2026-01-26'))).toBe(false); // holiday
    });
  });

  describe('isExpiryDayForSymbol - NIFTY', () => {
    it('should return true for normal Tuesday expiry', () => {
      expect(isExpiryDayForSymbol('NIFTY', new Date('2026-06-30'))).toBe(true); // Tuesday, normal day
    });

    it('should return false for regular Wednesday', () => {
      expect(isExpiryDayForSymbol('NIFTY', new Date('2026-07-01'))).toBe(false);
    });

    it('should return true for Monday if Tuesday is holiday', () => {
      // 2026-02-17 is Mahashivratri (Tuesday holiday)
      // So 2026-02-16 (Monday) should be the expiry day
      expect(isExpiryDayForSymbol('NIFTY', new Date('2026-02-16'))).toBe(true);
    });

    it('should return false on Monday if Tuesday is NOT holiday', () => {
      expect(isExpiryDayForSymbol('NIFTY', new Date('2026-06-29'))).toBe(false); // Tuesday is not holiday
    });

    it('should return false on weekend', () => {
      expect(isExpiryDayForSymbol('NIFTY', new Date('2026-06-28'))).toBe(false);
    });
  });

  describe('isExpiryDayForSymbol - SENSEX', () => {
    it('should return true for normal Thursday expiry', () => {
      expect(isExpiryDayForSymbol('SENSEX', new Date('2026-06-18'))).toBe(true); // Thursday
    });

    it('should return false for regular Wednesday', () => {
      expect(isExpiryDayForSymbol('SENSEX', new Date('2026-06-17'))).toBe(false);
    });

    it('should return true for Wednesday if Thursday is holiday', () => {
      // 2026-06-25 is Muharram (Thursday holiday)
      // So 2026-06-24 (Wednesday) should be SENSEX expiry
      expect(isExpiryDayForSymbol('SENSEX', new Date('2026-06-24'))).toBe(true);
    });

    it('should return false on Thursday if it is a holiday', () => {
      expect(isExpiryDayForSymbol('SENSEX', new Date('2026-06-25'))).toBe(false);
    });
  });

  describe('isExpiryDayForSymbol - BANKNIFTY', () => {
    it('should return true for normal Wednesday expiry', () => {
      expect(isExpiryDayForSymbol('BANKNIFTY', new Date('2026-07-01'))).toBe(true); // Wednesday
    });

    it('should return false for Tuesday', () => {
      expect(isExpiryDayForSymbol('BANKNIFTY', new Date('2026-06-30'))).toBe(false);
    });
  });

  describe('extractExpiryFromSymbol', () => {
    it('should extract correct date from weekly SENSEX options', () => {
      const date = extractExpiryFromSymbol('SENSEX2671677400CE');
      expect(date).not.toBeNull();
      expect(date?.getUTCFullYear()).toBe(2026);
      expect(date?.getUTCMonth()).toBe(6); // July is 6 (0-indexed)
      expect(date?.getUTCDate()).toBe(16);
    });

    it('should extract correct date from weekly NIFTY options', () => {
      const date = extractExpiryFromSymbol('NIFTY2672124300CE');
      expect(date).not.toBeNull();
      expect(date?.getUTCFullYear()).toBe(2026);
      expect(date?.getUTCMonth()).toBe(6); // July is 6 (0-indexed)
      expect(date?.getUTCDate()).toBe(21);
    });

    it('should extract correct date from monthly options (last Thursday)', () => {
      const date = extractExpiryFromSymbol('NIFTY26JUL24300CE');
      expect(date).not.toBeNull();
      expect(date?.getUTCFullYear()).toBe(2026);
      expect(date?.getUTCMonth()).toBe(6); // July
      expect(date?.getUTCDay()).toBe(4); // Thursday
      // Last Thursday of July 2026 is July 30th
      expect(date?.getUTCDate()).toBe(30);
    });

    it('should return null for invalid option symbols', () => {
      expect(extractExpiryFromSymbol('INVALID_SYMBOL')).toBeNull();
      expect(extractExpiryFromSymbol('NIFTY26JL24300CE')).toBeNull(); // invalid month code
    });

    it('should handle exceptions in regex matching gracefully', () => {
      expect(extractExpiryFromSymbol(null as any)).toBeNull();
    });
  });
});
