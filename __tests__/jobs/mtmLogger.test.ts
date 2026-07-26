import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const { formatMtmTimestamp, writeMtmSnapshot } = await import('../../src/jobs/mtmLogger.js');
const { positionStores } = await import('../../src/store/positionStore.js');
const { logger } = await import('../../src/helpers/logger.js');

describe('mtmLogger', () => {
  let existsSyncSpy: any;
  let mkdirSyncSpy: any;
  let appendFileSyncSpy: any;
  let getPositionsNiftySpy: any;
  let getPositionsSensexSpy: any;
  let loggerErrorSpy: any;

  beforeEach(() => {
    jest.clearAllMocks();
    existsSyncSpy = jest.spyOn(fs, 'existsSync');
    mkdirSyncSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => '');
    appendFileSyncSpy = jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
    getPositionsNiftySpy = jest.spyOn(positionStores.NIFTY, 'getPositions');
    getPositionsSensexSpy = jest.spyOn(positionStores.SENSEX, 'getPositions');
    loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  afterEach(() => {
    existsSyncSpy.mockRestore();
    mkdirSyncSpy.mockRestore();
    appendFileSyncSpy.mockRestore();
    getPositionsNiftySpy.mockRestore();
    getPositionsSensexSpy.mockRestore();
    loggerErrorSpy.mockRestore();
  });

  describe('formatMtmTimestamp', () => {
    it('produces exactly formatted string for a known Date input', () => {
      const date = new Date(Date.UTC(2026, 6, 21, 9, 2, 18));
      const formatted = formatMtmTimestamp(date);
      expect(formatted).toBe('21/7/2026, 2:32:18 pm');
    });
  });

  describe('writeMtmSnapshot', () => {
    it('is a no-op when the position is inactive', () => {
      getPositionsNiftySpy.mockReturnValue({
        active: false,
        legs: [],
        entryMargin: 0,
        stopLoss: 0,
      });

      writeMtmSnapshot('NIFTY');

      expect(appendFileSyncSpy).not.toHaveBeenCalled();
    });

    it('appends the correctly formatted line and writes to the correctly named file path for active position', () => {
      getPositionsNiftySpy.mockReturnValue({
        active: true,
        legs: [
          {
            symbol: 'NIFTY-LEG-1',
            token: 'T1',
            entryPremium: 100,
            qty: 50,
            type: 'CE',
            direction: 'BUY',
            currentPrice: 110.5,
          },
          {
            symbol: 'NIFTY-LEG-2',
            token: 'T2',
            entryPremium: 50,
            qty: 150,
            type: 'CE',
            direction: 'SELL',
            currentPrice: 40.25,
          },
        ],
        entryMargin: 100000,
        stopLoss: 1000,
      });

      existsSyncSpy.mockReturnValue(true);

      const date = new Date(Date.UTC(2026, 6, 21, 9, 2, 18));
      writeMtmSnapshot('NIFTY', date);

      expect(appendFileSyncSpy).toHaveBeenCalled();
      const args = appendFileSyncSpy.mock.calls[0];
      const normalizedPath = (args[0] as string).replace(/\\/g, '/');
      expect(normalizedPath).toContain('logs/mtm/mtm-nifty-2026-07-21.log');
      expect(args[1]).toBe('[21/7/2026, 2:32:18 pm] [INFO] NIFTY: MTM = 1987.5\n');
    });

    it('catches and logs a thrown fs.appendFileSync error without throwing', () => {
      getPositionsNiftySpy.mockReturnValue({
        active: true,
        legs: [
          {
            symbol: 'NIFTY-LEG-1',
            token: 'T1',
            entryPremium: 100,
            qty: 50,
            type: 'CE',
            direction: 'BUY',
            currentPrice: 110,
          },
        ],
        entryMargin: 100000,
        stopLoss: 1000,
      });

      existsSyncSpy.mockReturnValue(true);
      appendFileSyncSpy.mockImplementation(() => {
        throw new Error('Write permission denied');
      });

      expect(() => {
        writeMtmSnapshot('NIFTY');
      }).not.toThrow();

      expect(loggerErrorSpy).toHaveBeenCalled();
      expect(loggerErrorSpy.mock.calls[0][0]).toContain('Failed to write MTM snapshot for NIFTY');
    });
  });
});
