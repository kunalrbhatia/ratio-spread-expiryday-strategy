import { fetchUtilizedMargin, MarginLeg } from '../helpers/orders.js';
import { positionStores, OptionLeg } from '../store/positionStore.js';
import { sendAlert } from '../notifier.js';
import { logger } from '../helpers/logger.js';
import { INDEX_CONFIGS, SupportedIndex } from '../helpers/constants.js';
import { isKillSwitchActive, isPanicSwitchActive, isPaperMode } from '../helpers/modeManager.js';
import { getActiveStrategy } from '../strategy/index.js';

export const executeStrategyEntry = async (symbol: string): Promise<boolean> => {
  if (isKillSwitchActive() || isPanicSwitchActive()) {
    logger.warn(`Strategy entry blocked for ${symbol}: Kill Switch or Panic Switch is active.`);
    return false;
  }

  const strategy = getActiveStrategy();
  const paper = isPaperMode();

  try {
    logger.info(
      `--- Starting Strategy Entry: [${strategy.name}] on ${symbol} (Paper: ${paper}) ---`,
    );

    // Delegate trade creation to the active Strategy
    const legs: OptionLeg[] | null = await strategy.entry({
      symbol,
      isPaper: paper,
    });

    if (!legs || legs.length === 0) {
      logger.info(
        `Strategy '${strategy.name}' produced no entry legs for ${symbol}. Entry skipped.`,
      );
      return false;
    }

    const config = INDEX_CONFIGS[symbol as SupportedIndex];
    const optionExchange = config ? config.optionExchange : 'NFO';

    // Construct margin legs to determine required margin
    const marginLegs: MarginLeg[] = legs.map((leg) => ({
      exchange: optionExchange,
      qty: leg.qty,
      price: leg.entryPremium,
      productType: 'CARRYFORWARD',
      token: leg.token,
      tradeType: leg.direction,
      orderType: 'MARKET',
    }));

    const totalMargin = await fetchUtilizedMargin(marginLegs);
    const stopLossAmount = strategy.computeStopLoss(totalMargin);

    const store = positionStores[symbol];
    store.setPositions(legs, totalMargin, stopLossAmount);

    const legsSummary = legs
      .map((l) => `• ${l.direction} ${l.qty} qty ${l.symbol} @ ₹${l.entryPremium}`)
      .join('\n');

    const alertMessage = `
🟢 <b>Strategy Entry Complete: ${strategy.name.toUpperCase()}</b>
---------------------------------
<b>Instrument:</b> ${symbol}
<b>Mode:</b> ${paper ? '🧪 PAPER' : '⚡ LIVE'}
---------------------------------
<b>Positions:</b>
${legsSummary}
---------------------------------
<b>Utilized Margin:</b> ₹${totalMargin.toLocaleString()}
<b>Stop Loss:</b> ₹${stopLossAmount.toLocaleString()}
`;

    await sendAlert(alertMessage);
    return true;
  } catch (error: any) {
    logger.error(`Strategy entry execution failed for ${symbol}: ${error.message}`);
    await sendAlert(`🚨 <b>Strategy Entry Failed for ${symbol}!</b>\nError: ${error.message}`);
    return false;
  }
};

// Backwards compatibility alias
export const executeExpiryStrategyEntry = executeStrategyEntry;
