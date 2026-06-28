import { positionStore, OptionLeg } from '../store/positionStore.js';
import { ordersHelper } from '../helpers/orders.js';
import { smartStream, TickData } from '../helpers/websocket.js';
import { notifierHelper } from '../notifier.js';
import { logger } from '../helpers/logger.js';

let isExiting = false;

export const exitAllPositions = async (reason: string): Promise<boolean> => {
  if (isExiting) return false;
  isExiting = true;

  try {
    logger.info(`Initiating Exit for all positions. Reason: ${reason}`);

    // Disconnect websocket first to avoid processing incoming ticks
    smartStream.disconnect();

    const positions = positionStore.getPositions();
    if (!positions.active || positions.legs.length === 0) {
      logger.warn('No active positions to exit.');
      isExiting = false;
      return false;
    }

    // Execute exit orders for each leg
    for (const leg of positions.legs) {
      // Exit order parameters:
      // If we bought (BUY) it, we must SELL it to close.
      // If we sold (SELL) it, we must BUY it to close.
      const exitTxType = leg.direction === 'BUY' ? 'SELL' : 'BUY';
      try {
        await ordersHelper.placeOptionOrder({
          tradingsymbol: leg.symbol,
          symboltoken: leg.token,
          transactiontype: exitTxType,
          quantity: leg.qty,
        });
      } catch (err: any) {
        logger.error(`Error closing leg ${leg.symbol}: ${err.message}`);
      }
    }

    // Calculate final P&L
    const finalPnL = calculateCurrentPnL(positions.legs);

    // Clear state
    positionStore.clear();

    const alertMessage = `
🚨 <b>Position Exit Triggered</b>
---------------------------------
<b>Reason:</b> ${reason}
<b>Final Trade P&L:</b> ₹${finalPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}
`;

    await notifierHelper.sendAlert(alertMessage);
    isExiting = false;
    return true;
  } catch (error: any) {
    logger.error(`Failed to exit all positions: ${error.message}`);
    await notifierHelper.sendAlert(`⚠️ <b>Emergency Exit Failed!</b>\nError: ${error.message}`);
    isExiting = false;
    return false;
  }
};

export const calculateCurrentPnL = (legs: OptionLeg[]): number => {
  let totalPnL = 0;
  for (const leg of legs) {
    const currentPrice = leg.currentPrice !== undefined ? leg.currentPrice : leg.entryPremium;
    if (leg.direction === 'BUY') {
      totalPnL += (currentPrice - leg.entryPremium) * leg.qty;
    } else {
      totalPnL += (leg.entryPremium - currentPrice) * leg.qty;
    }
  }
  return totalPnL;
};

export const handleIncomingTick = async (tick: TickData) => {
  const positions = positionStore.getPositions();
  if (!positions.active || positions.legs.length === 0) {
    return;
  }

  // Update leg current price
  let legFound = false;
  for (const leg of positions.legs) {
    if (leg.token === tick.token) {
      leg.currentPrice = tick.ltp;
      legFound = true;
    }
  }

  if (!legFound) return;

  // Calculate current P&L
  const currentPnL = calculateCurrentPnL(positions.legs);

  // Stop Loss is 1% of entry margin (SL is positive value representing absolute loss threshold)
  // E.g. if SL is ₹3500, we trigger exit if P&L <= -3500
  if (currentPnL <= -positions.stopLoss) {
    logger.warn(
      `Stop loss hit! Current P&L: ₹${currentPnL} <= SL threshold: -₹${positions.stopLoss}`,
    );
    await exitAllPositions(`Stop Loss hit of 1% (P&L: ₹${currentPnL.toFixed(2)})`);
  }
};

export const startContinuousMonitoring = () => {
  const positions = positionStore.getPositions();
  if (!positions.active || positions.legs.length === 0) {
    logger.info('No active positions. Skipping WebSocket stream monitoring.');
    return;
  }

  logger.info('Starting SmartStream WebSocket monitoring for options legs...');
  const tokens = positions.legs.map((leg) => leg.token);

  smartStream.connect(handleIncomingTick);
  smartStream.subscribe(tokens);
};
