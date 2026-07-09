import {
  getSpotLtp,
  getATMStrike,
  findATMContracts,
  findClosestPremiumStrike,
  getOptionLtps,
} from '../helpers/marketData.js';
import { placeOptionOrder, fetchUtilizedMargin, MarginLeg } from '../helpers/orders.js';
import { positionStores, OptionLeg } from '../store/positionStore.js';
import { sendAlert } from '../notifier.js';
import { logger } from '../helpers/logger.js';
import { INDEX_CONFIGS } from '../helpers/constants.js';
import { isKillSwitchActive } from '../helpers/modeManager.js';

export const executeExpiryStrategyEntry = async (
  symbol: 'NIFTY' | 'SENSEX' = 'NIFTY',
): Promise<boolean> => {
  if (isKillSwitchActive()) {
    logger.warn(`Strategy entry blocked for ${symbol}: Kill Switch is active.`);
    return false;
  }

  try {
    logger.info(`--- Starting ${symbol} Expiry Strategy Entry Job (09:20 AM) ---`);

    const config = INDEX_CONFIGS[symbol];

    // 1. Get spot and calculate ATM
    const spot = await getSpotLtp(symbol);
    const atmStrike = getATMStrike(spot, config.strikeStep);
    logger.info(`${symbol} Calculated ATM Strike: ${atmStrike}`);

    // 2. Find CE and PE ATM options
    const { ce: atmCE, pe: atmPE } = findATMContracts(symbol, atmStrike);
    logger.info(`${symbol} ATM Call Contract: ${atmCE.symbol} (${atmCE.token})`);
    logger.info(`${symbol} ATM Put Contract: ${atmPE.symbol} (${atmPE.token})`);

    // 3. Buy 1 lot ATM CE and PE
    const buyQty = config.lotSize;

    logger.info(`Placing market orders to buy ${symbol} ATM Call and ATM Put...`);
    const ceBuyOrderId = await placeOptionOrder({
      tradingsymbol: atmCE.symbol,
      symboltoken: atmCE.token,
      transactiontype: 'BUY',
      quantity: buyQty,
      exchange: config.optionExchange,
    });
    logger.info(`${symbol} ATM CE Order ID: ${ceBuyOrderId}`);

    const peBuyOrderId = await placeOptionOrder({
      tradingsymbol: atmPE.symbol,
      symboltoken: atmPE.token,
      transactiontype: 'BUY',
      quantity: buyQty,
      exchange: config.optionExchange,
    });
    logger.info(`${symbol} ATM PE Order ID: ${peBuyOrderId}`);

    // 4. Retrieve execute prices
    const fillPrices = await getOptionLtps([atmCE.token, atmPE.token], symbol);
    const pCEBuy = fillPrices.get(atmCE.token) || 100; // fallback if api returns 0
    const pPEBuy = fillPrices.get(atmPE.token) || 100;

    logger.info(`${symbol} ATM CE Entry Premium: ₹${pCEBuy}`);
    logger.info(`${symbol} ATM PE Entry Premium: ₹${pPEBuy}`);

    // 5. Calculate targets
    const targetCESell = pCEBuy / 3;
    const targetPESell = pPEBuy / 3;
    logger.info(`${symbol} Target CE Sell Premium: ₹${targetCESell.toFixed(2)}`);
    logger.info(`${symbol} Target PE Sell Premium: ₹${targetPESell.toFixed(2)}`);

    // 6. Find closest strikes to targets
    const { contract: sellCE, premium: pCESell } = await findClosestPremiumStrike(
      symbol,
      'CE',
      targetCESell,
    );
    const { contract: sellPE, premium: pPESell } = await findClosestPremiumStrike(
      symbol,
      'PE',
      targetPESell,
    );

    logger.info(`${symbol} Selected hedge CE to sell: ${sellCE.symbol} at premium ₹${pCESell}`);
    logger.info(`${symbol} Selected hedge PE to sell: ${sellPE.symbol} at premium ₹${pPESell}`);

    // 7. Sell 3 lots of target CE and target PE
    const sellQty = config.lotSize * 3;

    logger.info(`Placing market orders to sell ${symbol} hedge Call and Put positions...`);
    const ceSellOrderId = await placeOptionOrder({
      tradingsymbol: sellCE.symbol,
      symboltoken: sellCE.token,
      transactiontype: 'SELL',
      quantity: sellQty,
      exchange: config.optionExchange,
    });
    logger.info(`${symbol} Hedge CE Order ID: ${ceSellOrderId}`);

    const peSellOrderId = await placeOptionOrder({
      tradingsymbol: sellPE.symbol,
      symboltoken: sellPE.token,
      transactiontype: 'SELL',
      quantity: sellQty,
      exchange: config.optionExchange,
    });
    logger.info(`${symbol} Hedge PE Order ID: ${peSellOrderId}`);

    // 8. Construct positions state and fetch utilized margin
    const activeLegs: OptionLeg[] = [
      {
        symbol: atmCE.symbol,
        token: atmCE.token,
        entryPremium: pCEBuy,
        qty: buyQty,
        type: 'CE',
        direction: 'BUY',
      },
      {
        symbol: atmPE.symbol,
        token: atmPE.token,
        entryPremium: pPEBuy,
        qty: buyQty,
        type: 'PE',
        direction: 'BUY',
      },
      {
        symbol: sellCE.symbol,
        token: sellCE.token,
        entryPremium: pCESell,
        qty: sellQty,
        type: 'CE',
        direction: 'SELL',
      },
      {
        symbol: sellPE.symbol,
        token: sellPE.token,
        entryPremium: pPESell,
        qty: sellQty,
        type: 'PE',
        direction: 'SELL',
      },
    ];

    const marginLegs: MarginLeg[] = activeLegs.map((leg) => ({
      exchange: config.optionExchange,
      qty: leg.qty,
      price: leg.entryPremium,
      productType: 'CARRYFORWARD',
      token: leg.token,
      tradeType: leg.direction,
    }));

    const totalMargin = await fetchUtilizedMargin(marginLegs);

    const store = positionStores[symbol];
    // Save to store (which automatically sets 1% SL)
    store.setPositions(activeLegs, totalMargin);

    const positions = store.getPositions();
    const slAmount = positions.stopLoss;

    const alertMessage = `
🟢 <b>${symbol} Strategy Entry Complete</b>
---------------------------------
<b>${symbol} Spot:</b> ${spot}
<b>ATM Strike:</b> ${atmStrike}
---------------------------------
<b>Long Positions (1 Lot):</b>
• CE: ${atmCE.symbol} @ ₹${pCEBuy}
• PE: ${atmPE.symbol} @ ₹${pPEBuy}

<b>Short Positions (3 Lots):</b>
• CE: ${sellCE.symbol} @ ₹${pCESell}
• PE: ${sellPE.symbol} @ ₹${pPESell}
---------------------------------
<b>Utilized Margin:</b> ₹${totalMargin.toLocaleString()}
<b>Stop Loss (1%):</b> ₹${slAmount.toLocaleString()}
`;

    await sendAlert(alertMessage);
    return true;
  } catch (error: any) {
    logger.error(`${symbol} Strategy entry execution failed: ${error.message}`);
    await sendAlert(`🚨 <b>${symbol} Strategy Entry Failed!</b>\nError: ${error.message}`);
    return false;
  }
};
