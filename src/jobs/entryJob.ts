import {
  getNiftySpotLtp,
  getATMStrike,
  findATMContracts,
  findClosestPremiumStrike,
  getOptionLtps,
} from '../helpers/marketData.js';
import { placeOptionOrder, fetchUtilizedMargin, MarginLeg } from '../helpers/orders.js';
import { positionStore, OptionLeg } from '../store/positionStore.js';
import { sendAlert } from '../notifier.js';
import { logger } from '../helpers/logger.js';
import { CONSTANTS } from '../helpers/constants.js';

export const executeExpiryStrategyEntry = async (): Promise<boolean> => {
  try {
    logger.info('--- Starting Expiry Strategy Entry Job (09:20 AM) ---');

    // 1. Get spot and calculate ATM
    const spot = await getNiftySpotLtp();
    const atmStrike = getATMStrike(spot);
    logger.info(`Calculated ATM Strike: ${atmStrike}`);

    // 2. Find CE and PE ATM options
    const { ce: atmCE, pe: atmPE } = findATMContracts(atmStrike);
    logger.info(`ATM Call Contract: ${atmCE.symbol} (${atmCE.token})`);
    logger.info(`ATM Put Contract: ${atmPE.symbol} (${atmPE.token})`);

    // 3. Buy 1 lot (65 qty) ATM CE and PE
    const buyQty = CONSTANTS.LOT_SIZE;

    logger.info('Placing market orders to buy ATM Call and ATM Put...');
    const ceBuyOrderId = await placeOptionOrder({
      tradingsymbol: atmCE.symbol,
      symboltoken: atmCE.token,
      transactiontype: 'BUY',
      quantity: buyQty,
    });
    logger.info(`ATM CE Order ID: ${ceBuyOrderId}`);

    const peBuyOrderId = await placeOptionOrder({
      tradingsymbol: atmPE.symbol,
      symboltoken: atmPE.token,
      transactiontype: 'BUY',
      quantity: buyQty,
    });
    logger.info(`ATM PE Order ID: ${peBuyOrderId}`);

    // 4. Retrieve execute prices
    // In live trading, we'd fetch the average fill price of order IDs.
    // As a robust baseline, we fetch their current LTP right after execution.
    const fillPrices = await getOptionLtps([atmCE.token, atmPE.token]);
    const pCEBuy = fillPrices.get(atmCE.token) || 100; // fallback if api returns 0
    const pPEBuy = fillPrices.get(atmPE.token) || 100;

    logger.info(`ATM CE Entry Premium: ₹${pCEBuy}`);
    logger.info(`ATM PE Entry Premium: ₹${pPEBuy}`);

    // 5. Calculate targets
    const targetCESell = pCEBuy / 3;
    const targetPESell = pPEBuy / 3;
    logger.info(`Target CE Sell Premium: ₹${targetCESell.toFixed(2)}`);
    logger.info(`Target PE Sell Premium: ₹${targetPESell.toFixed(2)}`);

    // 6. Find closest strikes to targets
    const { contract: sellCE, premium: pCESell } = await findClosestPremiumStrike(
      'CE',
      targetCESell,
    );
    const { contract: sellPE, premium: pPESell } = await findClosestPremiumStrike(
      'PE',
      targetPESell,
    );

    logger.info(`Selected hedge CE to sell: ${sellCE.symbol} at premium ₹${pCESell}`);
    logger.info(`Selected hedge PE to sell: ${sellPE.symbol} at premium ₹${pPESell}`);

    // 7. Sell 3 lots of target CE and target PE
    const sellQty = CONSTANTS.LOT_SIZE * 3;

    logger.info('Placing market orders to sell hedge Call and Put positions...');
    const ceSellOrderId = await placeOptionOrder({
      tradingsymbol: sellCE.symbol,
      symboltoken: sellCE.token,
      transactiontype: 'SELL',
      quantity: sellQty,
    });
    logger.info(`Hedge CE Order ID: ${ceSellOrderId}`);

    const peSellOrderId = await placeOptionOrder({
      tradingsymbol: sellPE.symbol,
      symboltoken: sellPE.token,
      transactiontype: 'SELL',
      quantity: sellQty,
    });
    logger.info(`Hedge PE Order ID: ${peSellOrderId}`);

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
      exchange: 'NFO',
      qty: leg.qty,
      price: leg.entryPremium,
      productType: 'CARRYFORWARD',
      token: leg.token,
      tradeType: leg.direction,
    }));

    const totalMargin = await fetchUtilizedMargin(marginLegs);

    // Save to positionStore (which automatically sets 1% SL)
    positionStore.setPositions(activeLegs, totalMargin);

    const positions = positionStore.getPositions();
    const slAmount = positions.stopLoss;

    const alertMessage = `
🟢 <b>Strategy Entry Complete</b>
---------------------------------
<b>Nifty Spot:</b> ${spot}
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
    logger.error(`Strategy entry execution failed: ${error.message}`);
    await sendAlert(`🚨 <b>Strategy Entry Failed!</b>\nError: ${error.message}`);
    return false;
  }
};
