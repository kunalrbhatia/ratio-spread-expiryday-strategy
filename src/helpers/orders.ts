import { apiRequest } from './api.js';
import { isPaperMode } from './modeManager.js';
import { logger } from './logger.js';
import { CONSTANTS } from './constants.js';

export interface OrderParams {
  tradingsymbol: string;
  symboltoken: string;
  transactiontype: 'BUY' | 'SELL';
  quantity: number; // raw quantity (lots * lotSize)
  exchange: 'NFO' | 'BFO';
}

export interface MarginLeg {
  exchange: 'NFO' | 'BFO';
  qty: number;
  price: number;
  productType: 'CARRYFORWARD';
  token: string;
  tradeType: 'BUY' | 'SELL';
  orderType: 'MARKET';
}

export const placeOptionOrder = async (params: OrderParams): Promise<string> => {
  const paper = isPaperMode();
  logger.info(
    `Placing Order: [${paper ? 'PAPER' : 'LIVE'}] ${params.transactiontype} ${params.quantity} qty of ${params.tradingsymbol} (${params.symboltoken}) on ${params.exchange}`,
  );

  if (paper) {
    // Generate mock order ID
    const mockId = `MOCK-ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    logger.info(`Mock Order placed successfully: ${mockId}`);
    return mockId;
  }

  try {
    const response = await apiRequest(
      {
        method: 'POST',
        url: `${CONSTANTS.ANGEL_ONE_BASE_URL}/rest/secure/angelbroking/order/v1/placeOrder`,
        data: {
          variety: 'NORMAL',
          tradingsymbol: params.tradingsymbol,
          symboltoken: params.symboltoken,
          transactiontype: params.transactiontype,
          exchange: params.exchange,
          ordertype: 'MARKET',
          producttype: 'CARRYFORWARD',
          duration: 'DAY',
          price: '0',
          squareoff: '0',
          stoploss: '0',
          trailingstoploss: '0',
          quantity: params.quantity.toString(),
        },
      },
      true, // skipRetry
    );

    if (response.status === true && response.data) {
      const orderId = response.data.orderid;
      logger.info(`Order executed successfully. ID: ${orderId}`);
      return orderId;
    }
    throw new Error(response.message || 'Order placement rejected by SmartAPI');
  } catch (error: any) {
    logger.error(`Failed to place order for ${params.tradingsymbol}: ${error.message}`);
    throw error;
  }
};

export type OrderState = 'complete' | 'rejected' | 'cancelled' | 'pending' | 'unknown';

export interface OrderFill {
  orderId: string;
  state: OrderState;
  averagePrice?: number;
  text?: string;
}

/**
 * Raised when an order the broker accepted was never filled. The API returns
 * status:true with an order id as soon as the order is queued, so acceptance is
 * not a fill - the exchange can still reject it seconds later (insufficient
 * funds, price band, freeze quantity).
 */
export class OrderNotFilledError extends Error {
  constructor(
    public readonly orderId: string,
    public readonly fill: OrderFill,
    public readonly params: OrderParams,
  ) {
    super(
      `Order ${orderId} for ${params.transactiontype} ${params.quantity} ${params.tradingsymbol} ended ${fill.state}${fill.text ? `: ${fill.text}` : ''}`,
    );
    this.name = 'OrderNotFilledError';
  }
}

const TERMINAL_STATES: OrderState[] = ['complete', 'rejected', 'cancelled'];

export const normaliseOrderState = (raw: unknown): OrderState => {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'complete' || s === 'completed' || s === 'filled') return 'complete';
  if (s === 'rejected') return 'rejected';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (
    s === 'open' ||
    s === 'pending' ||
    s === 'trigger pending' ||
    s === 'put order req received' ||
    s === 'validation pending' ||
    s === 'open pending' ||
    s === 'modified'
  ) {
    return 'pending';
  }
  return 'unknown';
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls the order book until the order reaches a terminal state or the timeout
 * expires. Returns the last observed state so a caller can tell a rejection
 * apart from a slow fill.
 */
export const awaitOrderFill = async (
  orderId: string,
  timeoutMs = 15000,
  intervalMs = 1000,
): Promise<OrderFill> => {
  if (isPaperMode()) {
    return { orderId, state: 'complete' };
  }

  const deadline = Date.now() + timeoutMs;
  let last: OrderFill = { orderId, state: 'unknown' };

  while (Date.now() < deadline) {
    try {
      const book = await apiRequest(
        {
          method: 'GET',
          url: `${CONSTANTS.ANGEL_ONE_BASE_URL}/rest/secure/angelbroking/order/v1/getOrderBook`,
        },
        true,
      );
      const row = (book?.data ?? []).find((o: any) => String(o.orderid) === String(orderId));
      if (row) {
        const state = normaliseOrderState(row.status);
        last = {
          orderId,
          state,
          averagePrice: Number(row.averageprice) || undefined,
          text: row.text ? String(row.text) : undefined,
        };
        if (TERMINAL_STATES.includes(state)) return last;
      }
    } catch (error: any) {
      logger.warn(`Order book poll for ${orderId} failed: ${error.message}`);
    }
    await sleep(intervalMs);
  }

  return last;
};

/** Places an order and does not return until it is confirmed filled. */
export const placeOptionOrderVerified = async (
  params: OrderParams,
  timeoutMs = 15000,
): Promise<OrderFill> => {
  const orderId = await placeOptionOrder(params);
  const fill = await awaitOrderFill(orderId, timeoutMs);
  if (fill.state !== 'complete') {
    throw new OrderNotFilledError(orderId, fill, params);
  }
  logger.info(
    `Order ${orderId} confirmed filled: ${params.transactiontype} ${params.quantity} ${params.tradingsymbol}` +
      (fill.averagePrice ? ` @ ${fill.averagePrice}` : ''),
  );
  return fill;
};

export const fetchUtilizedMargin = async (legs: MarginLeg[]): Promise<number> => {
  const paper = isPaperMode();
  if (paper) {
    // Paper mode mock margin calculation:
    // Long positions utilize very little (only premium paid)
    // Short positions require margin (~1,20,000 per lot on Nifty)
    // For 2 long lots + 6 short lots, mock around ₹3,50,000 margin
    const mockMargin = 350000;
    logger.info(`Mocking margin for positions: ₹${mockMargin}`);
    return mockMargin;
  }

  let attempt = 1;
  while (attempt <= 3) {
    try {
      const response = await apiRequest(
        {
          method: 'POST',
          url: `${CONSTANTS.ANGEL_ONE_BASE_URL}/rest/secure/angelbroking/margin/v1/batch`,
          data: {
            positions: legs,
          },
        },
        true, // skipRetry
      );

      if (response.status === true && response.data) {
        const margin = parseFloat(response.data.totalMarginRequired || '0');
        if (margin > 0) {
          logger.info(`Fetched utilized margin from SmartAPI: ₹${margin}`);
          return margin;
        }
      }
      throw new Error(response?.message || 'Failed to fetch batch margin');
    } catch (error: any) {
      logger.warn(`Attempt ${attempt} to fetch utilized margin failed: ${error.message}`);
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      attempt++;
    }
  }

  logger.error(`Error in fetchUtilizedMargin after retries. Using fallback ₹3,50,000.`);
  try {
    const { sendAlert } = await import('../notifier.js');
    await sendAlert(
      `⚠️ <b>Utilized Margin Fetch Failed!</b> Using fallback margin of ₹3,50,000. Stop-loss threshold may be inaccurate.`,
    );
  } catch (alertError: any) {
    logger.error(`Failed to send fallback margin alert: ${alertError.message}`);
  }
  return 350000;
};

export const ordersHelper = {
  placeOptionOrder,
  placeOptionOrderVerified,
  awaitOrderFill,
  fetchUtilizedMargin,
};
