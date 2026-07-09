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
    const response = await apiRequest({
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
    });

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

  try {
    const response = await apiRequest({
      method: 'POST',
      url: `${CONSTANTS.ANGEL_ONE_BASE_URL}/rest/secure/angelbroking/margin/v1/batch`,
      data: {
        positions: legs,
      },
    });

    if (response.status === true && response.data) {
      // Access total margin requirement from the response structure
      // Typically response contains totalMargin / marginBlock or similar
      const margin = parseFloat(response.data.totalMargin || response.data.marginBlock || '0');
      logger.info(`Fetched utilized margin from SmartAPI: ₹${margin}`);
      return margin > 0 ? margin : 350000; // fallback if api returns 0
    }
    throw new Error(response.message || 'Failed to fetch batch margin');
  } catch (error: any) {
    logger.error(`Error in fetchUtilizedMargin: ${error.message}. Using fallback ₹3,50,000.`);
    return 350000;
  }
};

export const ordersHelper = {
  placeOptionOrder,
  fetchUtilizedMargin,
};
