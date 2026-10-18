import { positionStores, OptionLeg } from '../store/positionStore.js';
import { ordersHelper } from '../helpers/orders.js';
import { smartStream, TickData } from '../helpers/websocket.js';
import { notifierHelper } from '../notifier.js';
import { logger } from '../helpers/logger.js';
import { INDEX_CONFIGS, SupportedIndex } from '../helpers/constants.js';
import { isPanicSwitchActive, isPaperMode } from '../helpers/modeManager.js';
import { getOptionLtps } from '../helpers/marketData.js';
import { getActiveStrategy } from '../strategy/index.js';

const isExiting: Record<string, boolean> = {};

export const exitAllPositions = async (
  symbolOrReason: string,
  maybeReason?: string,
): Promise<boolean> => {
  let symbol = 'NIFTY';
  let reason = symbolOrReason;

  if (maybeReason !== undefined) {
    symbol = symbolOrReason;
    reason = maybeReason;
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

    const config = INDEX_CONFIGS[symbol as SupportedIndex];
    const optionExchange = config ? config.optionExchange : 'NFO';
    const succeededLegs: OptionLeg[] = [];
    const failedLegs: OptionLeg[] = [];

    // Fetch latest LTPs to ensure we have the most accurate prices
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
      leg.currentPrice = currentPrice;

      // Skip worthless options (< ₹5.0) during scheduled market close square-off to save brokerage
      const isMarketClose = reason.toLowerCase().includes('market close square-off');
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
          exchange: optionExchange,
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

export const handleIncomingTick = async (symbolOrTick: string | TickData, maybeTick?: TickData) => {
  if (isPanicSwitchActive()) {
    return;
  }

  let symbol = 'NIFTY';
  let tick: TickData;

  if (typeof symbolOrTick === 'string') {
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
      store.updateLegPrice(tick.token, tick.ltp);
    }
  }

  if (!legFound) return;

  const currentPnL = calculateCurrentPnL(positions.legs);

  // 1. Core Stop Loss check
  if (currentPnL <= -positions.stopLoss) {
    logger.warn(
      `[${symbol}] Stop loss hit! Current P&L: ₹${currentPnL} <= SL threshold: -₹${positions.stopLoss}`,
    );
    await exitAllPositions(
      symbol,
      `Stop Loss threshold hit (P&L: ₹${currentPnL.toFixed(2)} <= -₹${positions.stopLoss.toFixed(2)})`,
    );
    return;
  }

  // 2. Delegate to active Strategy for custom onTick decision (take profit, trailing SL, etc.)
  try {
    const strategy = getActiveStrategy();
    if (strategy.onTick) {
      const decision = await strategy.onTick(
        { symbol, isPaper: isPaperMode() },
        tick,
        currentPnL,
        positions.legs,
      );

      if (decision && decision.shouldExit) {
        logger.info(`[${symbol}] Strategy requested exit: ${decision.reason}`);
        await exitAllPositions(symbol, `Strategy Signal: ${decision.reason}`);
      }
    }
  } catch (err: any) {
    logger.error(`Error in strategy onTick for ${symbol}: ${err.message}`);
  }
};

export const routeTick = (tick: TickData) => {
  const strategy = getActiveStrategy();
  const instruments = strategy.instruments || ['NIFTY'];

  for (const symbol of instruments) {
    const store = positionStores[symbol];
    const positions = store.getPositions();
    if (positions.active && positions.legs.some((leg) => leg.token === tick.token)) {
      handleIncomingTick(symbol, tick);
    }
  }
};

export const startContinuousMonitoring = (symbol = 'NIFTY') => {
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
