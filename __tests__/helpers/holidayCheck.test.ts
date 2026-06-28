import { isWeekend, isNSEHoliday, isExpiryDay } from '../../src/helpers/holidayCheck.js';

describe('holidayCheck helper', () => {
  describe('isWeekend', () => {
    it('should return true for Saturday and Sunday', () => {
      expect(isWeekend(new Date('2026-06-27'))).toBe(true); // Saturday
      expect(isWeekend(new Date('2026-06-28'))).toBe(true); // Sunday
    });

    it('should return false for weekdays', () => {
      expect(isWeekend(new Date('2026-06-29'))).toBe(false); // Monday
    });
  });

  describe('isNSEHoliday', () => {
    it('should return true for Republic Day', () => {
      expect(isNSEHoliday(new Date('2026-01-26'))).toBe(true);
    });

    it('should return false for a regular trading day', () => {
      expect(isNSEHoliday(new Date('2026-06-29'))).toBe(false);
    });
  });

  describe('isExpiryDay', () => {
    it('should return true for normal Tuesday expiry', () => {
      expect(isExpiryDay(new Date('2026-06-30'))).toBe(true); // Tuesday, normal day
    });

    it('should return false for regular Wednesday', () => {
      expect(isExpiryDay(new Date('2026-07-01'))).toBe(false);
    });

    it('should return true for Monday if Tuesday is holiday', () => {
      // 2026-02-17 is Mahashivratri (Tuesday holiday)
      // So 2026-02-16 (Monday) should be the expiry day
      expect(isExpiryDay(new Date('2026-02-16'))).toBe(true);
    });

    it('should return false on Monday if Tuesday is NOT holiday', () => {
      expect(isExpiryDay(new Date('2026-06-29'))).toBe(false); // Tuesday is not holiday
    });

    it('should return false on weekend', () => {
      expect(isExpiryDay(new Date('2026-06-28'))).toBe(false);
    });
  });
});
