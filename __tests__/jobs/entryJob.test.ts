import { jest } from '@jest/globals';

// Native ESM: replace modules with jest.unstable_mockModule, then import the
// unit under test dynamically.

const loggerMock = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const isKillSwitchActiveMock = jest.fn(() => false);
const isPanicSwitchActiveMock = jest.fn(() => false);
const isPaperModeMock = jest.fn(() => false);
const sendAlertMock = jest.fn(async () => undefined);
const getSpotLtpMock = jest.fn();
const getATMStrikeMock = jest.fn();
const findATMContractsMock = jest.fn();
const findClosestPremiumStrikeMock = jest.fn();
const getOptionLtpsMock = jest.fn();
const placeOptionOrderVerifiedMock = jest.fn();
const fetchUtilizedMarginMock = jest.fn();
const setPositionsMock = jest.fn();
const getPositionsMock = jest.fn(() => ({ stopLoss: 0 }));

jest.unstable_mockModule('../../src/helpers/logger.js', () => ({ logger: loggerMock }));
jest.unstable_mockModule('../../src/helpers/modeManager.js', () => ({
  isKillSwitchActive: isKillSwitchActiveMock,
  isPanicSwitchActive: isPanicSwitchActiveMock,
  isPaperMode: isPaperModeMock,
}));
jest.unstable_mockModule('../../src/notifier.js', () => ({
  sendAlert: sendAlertMock,
  notifierHelper: { sendAlert: sendAlertMock },
}));
jest.unstable_mockModule('../../src/helpers/marketData.js', () => ({
  getSpotLtp: getSpotLtpMock,
  getATMStrike: getATMStrikeMock,
  findATMContracts: findATMContractsMock,
  findClosestPremiumStrike: findClosestPremiumStrikeMock,
  getOptionLtps: getOptionLtpsMock,
}));
jest.unstable_mockModule('../../src/helpers/orders.js', () => ({
  placeOptionOrderVerified: placeOptionOrderVerifiedMock,
  fetchUtilizedMargin: fetchUtilizedMarginMock,
}));
jest.unstable_mockModule('../../src/store/positionStore.js', () => ({
  positionStores: {
    NIFTY: { setPositions: setPositionsMock, getPositions: getPositionsMock },
    SENSEX: { setPositions: jest.fn(), getPositions: jest.fn(() => ({ stopLoss: 0 })) },
  },
}));

const { executeExpiryStrategyEntry } = await import('../../src/jobs/entryJob.js');

const fill = (orderId: string) => ({ orderId, state: 'complete' as const, averagePrice: 10 });

describe('entryJob fill verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSpotLtpMock.mockResolvedValue(23900);
    getATMStrikeMock.mockReturnValue(23900);
    findATMContractsMock.mockReturnValue({
      ce: { symbol: 'NIFTY17NOV2623900CE', token: 'T-CE' },
      pe: { symbol: 'NIFTY17NOV2623900PE', token: 'T-PE' },
    });
    findClosestPremiumStrikeMock.mockImplementation(async (_s: any, type: string) => ({
      contract:
        type === 'CE'
          ? { symbol: 'NIFTY17NOV2624100CE', token: 'S-CE' }
          : { symbol: 'NIFTY17NOV2623700PE', token: 'S-PE' },
      premium: 25,
    }));
    getOptionLtpsMock.mockResolvedValue(
      new Map([
        ['T-CE', 64.3],
        ['T-PE', 61.5],
      ]),
    );
    fetchUtilizedMarginMock.mockResolvedValue(350000);
  });

  it('records the position when every leg fills', async () => {
    placeOptionOrderVerifiedMock
      .mockResolvedValueOnce(fill('1'))
      .mockResolvedValueOnce(fill('2'))
      .mockResolvedValueOnce(fill('3'))
      .mockResolvedValueOnce(fill('4'));

    const ok = await executeExpiryStrategyEntry('NIFTY');

    expect(ok).toBe(true);
    expect(placeOptionOrderVerifiedMock).toHaveBeenCalledTimes(4);
    expect(setPositionsMock).toHaveBeenCalledTimes(1);
  });

  it('unwinds the filled longs and records nothing when a short leg is rejected', async () => {
    // The 17-Nov case: both ATM longs fill, then the 3-lot shorts are rejected
    // for insufficient funds.
    placeOptionOrderVerifiedMock
      .mockResolvedValueOnce(fill('1'))
      .mockResolvedValueOnce(fill('2'))
      .mockRejectedValueOnce(new Error('Order O3 ended rejected: Insufficient Funds'))
      .mockResolvedValueOnce(fill('4'))
      .mockResolvedValueOnce(fill('5'));

    const ok = await executeExpiryStrategyEntry('NIFTY');

    expect(ok).toBe(false);
    expect(setPositionsMock).not.toHaveBeenCalled();

    // The legs that had filled are sold back: same symbol, opposite side.
    const unwindCalls = placeOptionOrderVerifiedMock.mock.calls.slice(3).map((c: any) => c[0]);
    expect(unwindCalls).toHaveLength(2);
    expect(unwindCalls[0]).toMatchObject({
      tradingsymbol: 'NIFTY17NOV2623900CE',
      transactiontype: 'SELL',
      quantity: 65,
    });
    expect(unwindCalls[1]).toMatchObject({
      tradingsymbol: 'NIFTY17NOV2623900PE',
      transactiontype: 'SELL',
      quantity: 65,
    });

    expect(sendAlertMock).toHaveBeenCalledWith(expect.stringContaining('Entry Failed'));
  });

  it('alerts for manual action when the unwind itself keeps failing', async () => {
    placeOptionOrderVerifiedMock
      .mockResolvedValueOnce(fill('1'))
      .mockResolvedValueOnce(fill('2'))
      .mockRejectedValueOnce(new Error('Order O3 ended rejected: Insufficient Funds'))
      .mockRejectedValue(new Error('unwind rejected'));

    const ok = await executeExpiryStrategyEntry('NIFTY');

    expect(ok).toBe(false);
    expect(setPositionsMock).not.toHaveBeenCalled();
    expect(sendAlertMock).toHaveBeenCalledWith(expect.stringContaining('MANUAL ACTION REQUIRED'));
  });
});
