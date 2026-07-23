import { positionStores, OptionLeg } from '../store/positionStore.js';
import { ordersHelper } from '../helpers/orders.js';
import { smartStream, TickData } from '../helpers/websocket.js';
import { notifierHelper } from '../notifier.js';
import { logger } from '../helpers/logger.js';
import { INDEX_CONFIGS } from '../helpers/constants.js';
import { isPanicSwitchActive } from '../helpers/modeManager.js';
import { getOptionLtps } from '../helpers/marketData.js';

const isExiting: Record<'NIFTY' | 'SENSEX', boolean> = {
  NIFTY: false,
  SENSEX: false,
};

export const exitAllPositions = async (
  symbolOrReason: 'NIFTY' | 'SENSEX' | string,
  maybeReason?: string,
): Promise<boolean> => {
  let symbol: 'NIFTY' | 'SENSEX' = 'NIFTY';
  let reason = symbolOrReason;

  if (symbolOrReason === 'NIFTY' || symbolOrReason === 'SENSEX') {
    symbol = symbolOrReason;
    reason = maybeReason || '';
  } else {
    symbol = 'NIFTY';
    reason = symbolOrReason;
  }

  if (isPanicSwitchActive()) {
    logger.warn(
      `Exit all positions blocked for ${symbol}: Panic Switch is active. (Reason: ${reason})`,
    );
    return false;
  }

  if (isExiting[symbol]) return false;
  isExiting[symbol] = true;

  try {
    logger.info(`Initiating Exit for all ${symbol} positions. Reason: ${reason}`);

    const store = positionStores[symbol];
    const positions = store.getPositions();
    if (!positions.active || positions.legs.length === 0) {
      logger.warn(`No active ${symbol} positions to exit.`);
      isExiting[symbol] = false;
      return false;
    }

    const config = INDEX_CONFIGS[symbol];
    const succeededLegs: OptionLeg[] = [];
    const failedLegs: OptionLeg[] = [];

    // Fetch latest LTPs to ensure we have the most accurate prices for our filter
    let ltpMap = new Map<string, number>();
    try {
      ltpMap = await getOptionLtps(
        positions.legs.map((l) => l.token),
        symbol,
      );
    } catch (err: any) {
      logger.error(`Failed to fetch latest LTPs before exit for ${symbol}: ${err.message}`);
    }

    // Execute exit orders for each leg
    for (const leg of positions.legs) {
      const currentPrice = ltpMap.get(leg.token) ?? leg.currentPrice ?? leg.entryPremium;
      leg.currentPrice = currentPrice; // Ensure the P&L calculation has the latest price

      // Only check the < 5 condition during scheduled market close square-off
      const isMarketClose = reason.includes('Market close square-off');
      if (isMarketClose && currentPrice < 5) {
        logger.info(
          `[${symbol}] Skipping exit for worthless leg ${leg.symbol} (${leg.token}) as LTP is ₹${currentPrice} (< ₹5.0)`,
        );
        succeededLegs.push(leg);
        smartStream.unsubscribe([leg.token], symbol);
        continue;
      }

      const exitTxType = leg.direction === 'BUY' ? 'SELL' : 'BUY';
      try {
        await ordersHelper.placeOptionOrder({
          tradingsymbol: leg.symbol,
          symboltoken: leg.token,
          transactiontype: exitTxType,
          quantity: leg.qty,
          exchange: config.optionExchange,
        });
        succeededLegs.push(leg);
        smartStream.unsubscribe([leg.token], symbol);
      } catch (err: any) {
        logger.error(`Error closing leg ${leg.symbol}: ${err.message}`);
        failedLegs.push(leg);

        const emergencyMsg = `
⚠️ <b>MANUAL INTERVENTION NEEDED</b>
---------------------------------
<b>Failed to close ${symbol} leg:</b> ${leg.symbol} (${leg.token})
<b>Direction:</b> ${leg.direction} -> ${exitTxType}
<b>Error:</b> ${err.message}
Please close this position manually at the broker immediately!
`;
        await notifierHelper.sendAlert(emergencyMsg);
      }
    }

    // Calculate final P&L
    const finalPnL = calculateCurrentPnL(positions.legs);

    // Clear state or update with failed legs
    if (failedLegs.length === 0) {
      store.clear();
    } else {
      store.updateLegs(failedLegs);
    }

    const alertMessage = `
🚨 <b>${symbol} Position Exit Triggered</b>
---------------------------------
<b>Reason:</b> ${reason}
<b>Final Trade P&L:</b> ₹${finalPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}
`;

    await notifierHelper.sendAlert(alertMessage);
    isExiting[symbol] = false;
    return true;
  } catch (error: any) {
    logger.error(`Failed to exit all ${symbol} positions: ${error.message}`);
    await notifierHelper.sendAlert(
      `⚠️ <b>Emergency Exit Failed for ${symbol}!</b>\nError: ${error.message}`,
    );
    isExiting[symbol] = false;
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

export const handleIncomingTick = async (
  symbolOrTick: 'NIFTY' | 'SENSEX' | TickData,
  maybeTick?: TickData,
) => {
  if (isPanicSwitchActive()) {
    return;
  }

  let symbol: 'NIFTY' | 'SENSEX' = 'NIFTY';
  let tick: TickData;

  if (symbolOrTick === 'NIFTY' || symbolOrTick === 'SENSEX') {
    symbol = symbolOrTick;
    tick = maybeTick!;
  } else {
    symbol = 'NIFTY';
    tick = symbolOrTick;
  }

  const store = positionStores[symbol];
  const positions = store.getPositions();
  if (!positions.active || positions.legs.length === 0) {
    return;
  }

  // Update leg current price in memory
  let legFound = false;
  for (const leg of positions.legs) {
    if (leg.token === tick.token) {
      leg.currentPrice = tick.ltp;
      legFound = true;
      // Mutate private state inside the store directly
      store.updateLegPrice(tick.token, tick.ltp);
    }
  }

  if (!legFound) return;

  // Calculate current P&L using the updated legs
  const currentPnL = calculateCurrentPnL(positions.legs);

  // Stop Loss is 1% of entry margin
  if (currentPnL <= -positions.stopLoss) {
    logger.warn(
      `[${symbol}] Stop loss hit! Current P&L: ₹${currentPnL} <= SL threshold: -₹${positions.stopLoss}`,
    );
    await exitAllPositions(symbol, `Stop Loss hit of 1% (P&L: ₹${currentPnL.toFixed(2)})`);
  }
};

// Route incoming ticks to NIFTY or SENSEX depending on active positions
export const routeTick = (tick: TickData) => {
  for (const symbol of ['NIFTY', 'SENSEX'] as const) {
    const store = positionStores[symbol];
    const positions = store.getPositions();
    if (positions.active && positions.legs.some((leg) => leg.token === tick.token)) {
      handleIncomingTick(symbol, tick);
    }
  }
};

export const startContinuousMonitoring = (symbol: 'NIFTY' | 'SENSEX' = 'NIFTY') => {
  if (isPanicSwitchActive()) {
    logger.warn(`Skipping continuous monitoring startup for ${symbol}: Panic Switch is active.`);
    return;
  }

  const store = positionStores[symbol];
  const positions = store.getPositions();
  if (!positions.active || positions.legs.length === 0) {
    logger.info(`No active positions for ${symbol}. Skipping WebSocket stream monitoring.`);
    return;
  }

  logger.info(`Starting SmartStream WebSocket monitoring for ${symbol} options legs...`);
  const tokens = positions.legs.map((leg) => leg.token);

  smartStream.connect(routeTick);
  smartStream.subscribe(tokens, symbol);
};
