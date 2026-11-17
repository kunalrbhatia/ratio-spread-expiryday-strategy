import {
  getSpotLtp,
  getATMStrike,
  findATMContracts,
  findClosestPremiumStrike,
  getOptionLtps,
} from '../helpers/marketData.js';
import {
  placeOptionOrderVerified,
  fetchUtilizedMargin,
  MarginLeg,
  OrderParams,
  OrderFill,
} from '../helpers/orders.js';
import { positionStores, OptionLeg } from '../store/positionStore.js';
import { sendAlert } from '../notifier.js';
import { logger } from '../helpers/logger.js';
import { INDEX_CONFIGS } from '../helpers/constants.js';
import { isKillSwitchActive, isPanicSwitchActive } from '../helpers/modeManager.js';

export const executeExpiryStrategyEntry = async (
  symbol: 'NIFTY' | 'SENSEX' = 'NIFTY',
): Promise<boolean> => {
  if (isKillSwitchActive() || isPanicSwitchActive()) {
    logger.warn(`Strategy entry blocked for ${symbol}: Kill Switch or Panic Switch is active.`);
    return false;
  }

  try {
    logger.info(`--- Starting ${symbol} Expiry Strategy Entry Job (09:20 AM) ---`);

    const config = INDEX_CONFIGS[symbol];

    // Every leg that actually fills is tracked here so a later failure can be
    // unwound instead of leaving a partial structure in the market. Acceptance
    // by the API is not a fill: the exchange rejects orders seconds later
    // (insufficient funds, price band), and on 17-Nov-2026 both short legs were
    // rejected while the ledger recorded all four as open.
    const filledLegs: OrderParams[] = [];

    const unwindFilledLegs = async (): Promise<void> => {
      for (const leg of filledLegs) {
        const opposite: OrderParams = {
          ...leg,
          transactiontype: leg.transactiontype === 'BUY' ? 'SELL' : 'BUY',
        };
        let closed = false;
        for (let attempt = 1; attempt <= 3 && !closed; attempt++) {
          try {
            const fill = await placeOptionOrderVerified(opposite);
            logger.warn(
              `Unwound ${leg.tradingsymbol}: ${opposite.transactiontype} ${opposite.quantity}` +
                (fill.averagePrice ? ` @ ${fill.averagePrice}` : ''),
            );
            closed = true;
          } catch (err: any) {
            logger.error(
              `Unwind attempt ${attempt}/3 for ${leg.tradingsymbol} failed: ${err.message}`,
            );
          }
        }
        if (!closed) {
          await sendAlert(
            `🚨 <b>MANUAL ACTION REQUIRED</b>\nCould not close ${leg.tradingsymbol} (${leg.quantity}) after the entry aborted — this leg is still open.`,
          );
        }
      }
      filledLegs.length = 0;
    };

    const enter = async (params: OrderParams): Promise<OrderFill> => {
      try {
        const fill = await placeOptionOrderVerified(params);
        filledLegs.push(params);
        return fill;
      } catch (err) {
        logger.error(`Entry leg failed: ${(err as Error).message}`);
        await unwindFilledLegs();
        throw err;
      }
    };

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
    const ceBuyFill = await enter({
      tradingsymbol: atmCE.symbol,
      symboltoken: atmCE.token,
      transactiontype: 'BUY',
      quantity: buyQty,
      exchange: config.optionExchange,
    });
    logger.info(`${symbol} ATM CE filled: ${ceBuyFill.orderId} @ ${ceBuyFill.averagePrice ?? '?'}`);

    const peBuyFill = await enter({
      tradingsymbol: atmPE.symbol,
      symboltoken: atmPE.token,
      transactiontype: 'BUY',
      quantity: buyQty,
      exchange: config.optionExchange,
    });
    logger.info(`${symbol} ATM PE filled: ${peBuyFill.orderId} @ ${peBuyFill.averagePrice ?? '?'}`);

    // 4. Retrieve LTPs as a fallback for the actual fill prices
    let fillPrices = new Map<string, number>();
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        fillPrices = await getOptionLtps([atmCE.token, atmPE.token], symbol);
        if (fillPrices.get(atmCE.token) && fillPrices.get(atmPE.token)) {
          break;
        }
      } catch (err: any) {
        logger.warn(`Attempt ${attempt} to retrieve option LTPs failed: ${err.message}`);
      }
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // The confirmed fill price is authoritative; the LTP is only a fallback.
    const pCEBuy = ceBuyFill.averagePrice ?? fillPrices.get(atmCE.token);
    const pPEBuy = peBuyFill.averagePrice ?? fillPrices.get(atmPE.token);

    if (!pCEBuy || !pPEBuy) {
      throw new Error(
        `Failed to retrieve valid LTPs for ATM CE (${atmCE.token}) or PE (${atmPE.token}) after retries. Aborting entry.`,
      );
    }

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
    const ceSellFill = await enter({
      tradingsymbol: sellCE.symbol,
      symboltoken: sellCE.token,
      transactiontype: 'SELL',
      quantity: sellQty,
      exchange: config.optionExchange,
    });
    logger.info(
      `${symbol} Hedge CE filled: ${ceSellFill.orderId} @ ${ceSellFill.averagePrice ?? '?'}`,
    );

    const peSellFill = await enter({
      tradingsymbol: sellPE.symbol,
      symboltoken: sellPE.token,
      transactiontype: 'SELL',
      quantity: sellQty,
      exchange: config.optionExchange,
    });
    logger.info(
      `${symbol} Hedge PE filled: ${peSellFill.orderId} @ ${peSellFill.averagePrice ?? '?'}`,
    );

    const pCESellActual = ceSellFill.averagePrice ?? pCESell;
    const pPESellActual = peSellFill.averagePrice ?? pPESell;

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
        entryPremium: pCESellActual,
        qty: sellQty,
        type: 'CE',
        direction: 'SELL',
      },
      {
        symbol: sellPE.symbol,
        token: sellPE.token,
        entryPremium: pPESellActual,
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
      orderType: 'MARKET',
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
• CE: ${sellCE.symbol} @ ₹${pCESellActual}
• PE: ${sellPE.symbol} @ ₹${pPESellActual}
---------------------------------
<b>Utilized Margin:</b> ₹${totalMargin.toLocaleString()}
<b>Stop Loss (1%):</b> ₹${slAmount.toLocaleString()}
`;

    await sendAlert(alertMessage);
    return true;
  } catch (error: any) {
    logger.error(`${symbol} Strategy entry execution failed: ${error.message}`);
    await sendAlert(
      `🚨 <b>${symbol} Strategy Entry Failed!</b>\nError: ${error.message}\nAny leg that had filled was unwound; no position was recorded.`,
    );
    return false;
  }
};
