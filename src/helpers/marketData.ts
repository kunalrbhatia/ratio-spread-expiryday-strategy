import { apiRequest } from './api.js';
import { CONSTANTS } from './constants.js';
import { getCachedScrips, ScripItem } from './scripMaster.js';
import { logger } from './logger.js';

import { INDEX_CONFIGS } from './constants.js';

export const getSpotLtp = async (symbol: 'NIFTY' | 'SENSEX'): Promise<number> => {
  const config = INDEX_CONFIGS[symbol];
  try {
    const response = await apiRequest({
      method: 'POST',
      url: `${CONSTANTS.ANGEL_ONE_BASE_URL}/rest/secure/angelbroking/market/v1/quote`,
      data: {
        mode: 'LTP',
        exchangeTokens: {
          [config.exchange]: [config.spotToken],
        },
      },
    });

    if (
      response.status === true &&
      response.data &&
      response.data.fetched &&
      response.data.fetched.length > 0
    ) {
      const ltp = parseFloat(response.data.fetched[0].ltp);
      logger.info(`${symbol} Spot LTP: ${ltp}`);
      return ltp;
    }
    throw new Error(response.message || `Failed to fetch ${symbol} Spot LTP`);
  } catch (error: any) {
    logger.error(`Error in getSpotLtp for ${symbol}: ${error.message}`);
    throw error;
  }
};

export const getNiftySpotLtp = async (): Promise<number> => {
  return getSpotLtp('NIFTY');
};

export const getATMStrike = (spot: number, strikeStep: number = 50): number => {
  return Math.round(spot / strikeStep) * strikeStep;
};

export const findATMContracts = (
  symbol: 'NIFTY' | 'SENSEX',
  atmStrike: number,
): { ce: ScripItem; pe: ScripItem } => {
  const scrips = getCachedScrips(symbol);

  let ce: ScripItem | null = null;
  let pe: ScripItem | null = null;

  for (const item of scrips) {
    // Normalise strike representation in SmartAPI headers.
    // According to Angel One API conventions, OPTIDX strikes in both NFO and BFO segments
    // are represented in paise (multiplied by 100), requiring a fixed divisor of 100.
    const itemStrike = parseFloat(item.strike) / 100;
    if (Math.round(itemStrike) === atmStrike) {
      if (item.symbol.endsWith('CE')) {
        ce = item;
      } else if (item.symbol.endsWith('PE')) {
        pe = item;
      }
    }
  }

  if (!ce || !pe) {
    throw new Error(
      `Could not find CE or PE ATM contracts for strike ${atmStrike} in cached ${symbol} scrips`,
    );
  }

  return { ce, pe };
};

export const getOptionLtps = async (
  tokens: string[],
  symbol: 'NIFTY' | 'SENSEX' = 'NIFTY',
): Promise<Map<string, number>> => {
  const config = INDEX_CONFIGS[symbol];
  try {
    const response = await apiRequest({
      method: 'POST',
      url: `${CONSTANTS.ANGEL_ONE_BASE_URL}/rest/secure/angelbroking/market/v1/quote`,
      data: {
        mode: 'LTP',
        exchangeTokens: {
          [config.optionExchange]: tokens,
        },
      },
    });

    const ltpMap = new Map<string, number>();
    if (response.status === true && response.data && response.data.fetched) {
      for (const item of response.data.fetched) {
        ltpMap.set(item.symbolToken, parseFloat(item.ltp));
      }
    }
    return ltpMap;
  } catch (error: any) {
    logger.error(`Error in getOptionLtps for ${symbol}: ${error.message}`);
    throw error;
  }
};

export const findClosestPremiumStrike = async (
  symbol: 'NIFTY' | 'SENSEX',
  type: 'CE' | 'PE',
  targetPremium: number,
): Promise<{ contract: ScripItem; premium: number }> => {
  const scrips = getCachedScrips(symbol).filter((s) => s.symbol.endsWith(type));
  if (scrips.length === 0) {
    throw new Error(`No ${type} contracts found in scrip-master-${symbol.toLowerCase()}.json`);
  }

  // Fetch LTPs for all contracts in batches of 50 to avoid payload limits
  const tokens = scrips.map((s) => s.token);
  const ltpMap = new Map<string, number>();

  const batchSize = 45; // safe margin
  for (let i = 0; i < tokens.length; i += batchSize) {
    const batch = tokens.slice(i, i + batchSize);
    const batchLtps = await getOptionLtps(batch, symbol);
    for (const [token, ltp] of batchLtps.entries()) {
      ltpMap.set(token, ltp);
    }
  }

  let closestContract: ScripItem | null = null;
  let closestPremium = 0;
  let minDiff = Infinity;

  for (const item of scrips) {
    const premium = ltpMap.get(item.token);
    if (premium !== undefined && premium > 0) {
      const diff = Math.abs(premium - targetPremium);
      if (diff < minDiff) {
        minDiff = diff;
        closestContract = item;
        closestPremium = premium;
      }
    }
  }

  if (!closestContract) {
    throw new Error(`Could not find closest ${type} contract for target premium ${targetPremium}`);
  }

  return { contract: closestContract, premium: closestPremium };
};
