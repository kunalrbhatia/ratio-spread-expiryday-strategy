import { jest } from '@jest/globals';
import { sessionStore } from '../../src/store/sessionStore.js';
import { configStore } from '../../src/store/configStore.js';
import { positionStore, OptionLeg } from '../../src/store/positionStore.js';
import fs from 'fs';

jest.mock('../../src/helpers/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    writeFileSync: jest.fn(),
    readFileSync: jest.fn((filePath: string) => {
      if (filePath.endsWith('config.json')) {
        return '{"investmentAmount": 100000}';
      }
      return '{}';
    }),
    existsSync: jest.fn((filePath: string) => {
      if (filePath.endsWith('config.json') || filePath.endsWith('positions.json')) {
        return true;
      }
      return actualFs.existsSync(filePath);
    }),
    mkdirSync: jest.fn(),
  };
});

describe('Store Classes', () => {
  describe('sessionStore', () => {
    it('should set, get, and clear session details', () => {
      sessionStore.setSession('jwt', 'feed', 'refresh');
      expect(sessionStore.getSession()).toEqual({
        jwtToken: 'jwt',
        feedToken: 'feed',
        refreshToken: 'refresh',
      });

      sessionStore.clear();
      expect(sessionStore.getSession()).toEqual({
        jwtToken: null,
        feedToken: null,
        refreshToken: null,
      });
    });
  });

  describe('configStore', () => {
    it('should get and set investment amount', () => {
      configStore.setInvestmentAmount(100000);
      expect(configStore.getInvestmentAmount()).toBe(100000);
      configStore.setInvestmentAmount(50000);
      expect(configStore.getInvestmentAmount()).toBe(50000);
    });
  });

  describe('positionStore', () => {
    it('should manage positions state', () => {
      const legs: OptionLeg[] = [
        { symbol: 'NIFTY26FEB2625000CE', token: '35002', entryPremium: 100, qty: 65, type: 'CE', direction: 'BUY' }
      ];
      positionStore.setPositions(legs, 300000);
      const state = positionStore.getPositions();
      expect(state.active).toBe(true);
      expect(state.legs).toEqual(legs);
      expect(state.entryMargin).toBe(300000);
      expect(state.stopLoss).toBe(3000); // 1% of 300k

      positionStore.clear();
      expect(positionStore.getPositions().active).toBe(false);
    });
  });
});
