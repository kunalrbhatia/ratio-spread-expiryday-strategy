import { jest } from '@jest/globals';
import { calculateCurrentPnL, handleIncomingTick, exitAllPositions, startContinuousMonitoring } from '../../src/jobs/monitorJob.js';
import { positionStore, OptionLeg } from '../../src/store/positionStore.js';
import { ordersHelper } from '../../src/helpers/orders.js';
import { notifierHelper } from '../../src/notifier.js';
import { smartStream } from '../../src/helpers/websocket.js';

describe('monitorJob', () => {
  let legs: OptionLeg[];
  let placeOrderSpy: any;
  let sendAlertSpy: any;
  let wsConnectSpy: any;
  let wsSubSpy: any;
  let wsDisconnectSpy: any;

  beforeEach(() => {
    jest.clearAllMocks();
    legs = [
      { symbol: 'CE_BUY', token: 'T1', entryPremium: 100, qty: 65, type: 'CE', direction: 'BUY', currentPrice: 110 },
      { symbol: 'PE_BUY', token: 'T2', entryPremium: 80, qty: 65, type: 'PE', direction: 'BUY', currentPrice: 75 },
      { symbol: 'CE_SELL', token: 'T3', entryPremium: 30, qty: 195, type: 'CE', direction: 'SELL', currentPrice: 25 },
      { symbol: 'PE_SELL', token: 'T4', entryPremium: 25, qty: 195, type: 'PE', direction: 'SELL', currentPrice: 28 },
    ];

    placeOrderSpy = jest.spyOn(ordersHelper, 'placeOptionOrder').mockResolvedValue('MOCK-ORD-123');
    sendAlertSpy = jest.spyOn(notifierHelper, 'sendAlert').mockResolvedValue();
    wsConnectSpy = jest.spyOn(smartStream, 'connect').mockImplementation(() => {});
    wsSubSpy = jest.spyOn(smartStream, 'subscribe').mockImplementation(() => {});
    wsDisconnectSpy = jest.spyOn(smartStream, 'disconnect').mockImplementation(() => {});
  });

  afterEach(() => {
    placeOrderSpy.mockRestore();
    sendAlertSpy.mockRestore();
    wsConnectSpy.mockRestore();
    wsSubSpy.mockRestore();
    wsDisconnectSpy.mockRestore();
  });

  describe('calculateCurrentPnL', () => {
    it('should calculate combined P&L correctly', () => {
      const pnl = calculateCurrentPnL(legs);
      expect(pnl).toBe(715);
    });

    it('should use entryPremium as fallback if currentPrice is undefined', () => {
      const legWithoutLtp: OptionLeg[] = [{ symbol: 'CE_BUY', token: 'T1', entryPremium: 100, qty: 65, type: 'CE', direction: 'BUY' }];
      expect(calculateCurrentPnL(legWithoutLtp)).toBe(0);
    });
  });

  describe('exitAllPositions', () => {
    it('should execute exit orders and clear state', async () => {
      jest.spyOn(positionStore, 'getPositions').mockReturnValue({
        active: true,
        legs,
        entryMargin: 350000,
        stopLoss: 3500,
      });
      const clearSpy = jest.spyOn(positionStore, 'clear').mockImplementation(() => {});

      const success = await exitAllPositions('Test exit');
      expect(success).toBe(true);
      expect(placeOrderSpy).toHaveBeenCalledTimes(4);
      expect(clearSpy).toHaveBeenCalled();
      expect(sendAlertSpy).toHaveBeenCalled();
    });
  });

  describe('handleIncomingTick', () => {
    it('should update leg price and trigger SL if loss exceeds limit', async () => {
      jest.spyOn(positionStore, 'getPositions').mockReturnValue({
        active: true,
        legs,
        entryMargin: 350000,
        stopLoss: 3500,
      });

      legs[0].currentPrice = 10; // (10-100)*65 = -5850
      legs[1].currentPrice = 80;
      legs[2].currentPrice = 30;
      legs[3].currentPrice = 25;

      await handleIncomingTick({ token: 'T1', ltp: 10 });
      expect(placeOrderSpy).toHaveBeenCalled();
    });
  });

  describe('startContinuousMonitoring', () => {
    it('should connect and subscribe to WebSocket tokens if positions are active', () => {
      jest.spyOn(positionStore, 'getPositions').mockReturnValue({
        active: true,
        legs,
        entryMargin: 350000,
        stopLoss: 3500,
      });

      startContinuousMonitoring();
      expect(wsConnectSpy).toHaveBeenCalled();
      expect(wsSubSpy).toHaveBeenCalledWith(['T1', 'T2', 'T3', 'T4']);
    });
  });
});
