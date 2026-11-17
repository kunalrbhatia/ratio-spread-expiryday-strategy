import { jest } from '@jest/globals';

// This suite runs under native ESM, so modules are replaced with
// jest.unstable_mockModule and imported dynamically afterwards.

const loggerMock = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const isPaperModeMock = jest.fn(() => false);
const apiRequestMock = jest.fn();

jest.unstable_mockModule('../../src/helpers/logger.js', () => ({ logger: loggerMock }));
jest.unstable_mockModule('../../src/helpers/modeManager.js', () => ({
  isPaperMode: isPaperModeMock,
}));
jest.unstable_mockModule('../../src/helpers/api.js', () => ({ apiRequest: apiRequestMock }));

const { awaitOrderFill, placeOptionOrderVerified, normaliseOrderState, OrderNotFilledError } =
  await import('../../src/helpers/orders.js');

const params = {
  tradingsymbol: 'NIFTY17NOV2625450CE',
  symboltoken: '45408',
  transactiontype: 'SELL' as const,
  quantity: 195,
  exchange: 'NFO' as const,
};

const orderBook = (rows: any[]) => ({ status: true, data: rows });

describe('orders verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isPaperModeMock.mockReturnValue(false);
  });

  describe('normaliseOrderState', () => {
    it('maps the broker statuses onto terminal states', () => {
      expect(normaliseOrderState('complete')).toBe('complete');
      expect(normaliseOrderState('COMPLETE')).toBe('complete');
      expect(normaliseOrderState('rejected')).toBe('rejected');
      expect(normaliseOrderState('cancelled')).toBe('cancelled');
      expect(normaliseOrderState('open')).toBe('pending');
      expect(normaliseOrderState('trigger pending')).toBe('pending');
      expect(normaliseOrderState('something-else')).toBe('unknown');
      expect(normaliseOrderState(undefined)).toBe('unknown');
    });
  });

  describe('awaitOrderFill', () => {
    it('returns the fill price once the order completes', async () => {
      apiRequestMock.mockResolvedValueOnce(
        orderBook([{ orderid: 'O1', status: 'complete', averageprice: '25.40' }]),
      );

      const fill = await awaitOrderFill('O1', 1000, 1);
      expect(fill.state).toBe('complete');
      expect(fill.averagePrice).toBe(25.4);
    });

    it('returns the rejection text so the caller can explain it', async () => {
      apiRequestMock.mockResolvedValueOnce(
        orderBook([
          { orderid: 'O2', status: 'rejected', text: 'Insufficient Funds', averageprice: '0' },
        ]),
      );

      const fill = await awaitOrderFill('O2', 1000, 1);
      expect(fill.state).toBe('rejected');
      expect(fill.text).toBe('Insufficient Funds');
    });

    it('gives up as unknown when the order never appears in the book', async () => {
      apiRequestMock.mockResolvedValue(orderBook([]));

      const fill = await awaitOrderFill('O3', 20, 1);
      expect(fill.state).toBe('unknown');
    });

    it('does not call the API in paper mode', async () => {
      isPaperModeMock.mockReturnValue(true);

      const fill = await awaitOrderFill('O4', 1000, 1);
      expect(fill.state).toBe('complete');
      expect(apiRequestMock).not.toHaveBeenCalled();
    });
  });

  describe('placeOptionOrderVerified', () => {
    it('returns the fill when the order completes', async () => {
      apiRequestMock
        .mockResolvedValueOnce({ status: true, data: { orderid: 'O5' } })
        .mockResolvedValueOnce(
          orderBook([{ orderid: 'O5', status: 'complete', averageprice: '25.00' }]),
        );

      const fill = await placeOptionOrderVerified(params);
      expect(fill.orderId).toBe('O5');
      expect(fill.averagePrice).toBe(25);
    });

    it('throws OrderNotFilledError when the exchange rejects the order', async () => {
      apiRequestMock
        .mockResolvedValueOnce({ status: true, data: { orderid: 'O6' } })
        .mockResolvedValueOnce(
          orderBook([{ orderid: 'O6', status: 'rejected', text: 'Insufficient Funds' }]),
        );

      await expect(placeOptionOrderVerified(params)).rejects.toBeInstanceOf(OrderNotFilledError);

      apiRequestMock
        .mockResolvedValueOnce({ status: true, data: { orderid: 'O7' } })
        .mockResolvedValueOnce(
          orderBook([{ orderid: 'O7', status: 'rejected', text: 'Insufficient Funds' }]),
        );

      await expect(placeOptionOrderVerified(params)).rejects.toThrow(/Insufficient Funds/);
    });

    it('does not report success just because the API accepted the order', async () => {
      // The bug behind the 17-Nov incident: placeOrder returns an id, the
      // exchange rejects seconds later. This must not resolve.
      apiRequestMock
        .mockResolvedValueOnce({ status: true, data: { orderid: 'O8' } })
        .mockResolvedValue({ status: true, data: [] });

      await expect(placeOptionOrderVerified(params, 20)).rejects.toThrow(/ended unknown/);
    });
  });
});
