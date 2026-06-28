import { apiRequest } from './api.js';
import { CONSTANTS } from './constants.js';
import { getCachedScrips, ScripItem } from './scripMaster.js';
import { logger } from './logger.js';

export const getNiftySpotLtp = async (): Promise<number> => {
  try {
    const response = await apiRequest({
      method: 'POST',
      url: `${CONSTANTS.ANGEL_ONE_BASE_URL}/rest/secure/angelbroking/order/v1/getLastPointPrice`,
      data: {
        exchange: 'NSE',
        tradingsymbol: 'NIFTY',
        symboltoken: CONSTANTS.NIFTY_SPOT_TOKEN,
      },
    });

    if (response.status === true && response.data) {
      const ltp = parseFloat(response.data.ltp);
      logger.info(`Nifty 50 Spot LTP: ${ltp}`);
      return ltp;
    }
    throw new Error(response.message || 'Failed to fetch Nifty Spot LTP');
  } catch (error: any) {
    logger.error(`Error in getNiftySpotLtp: ${error.message}`);
    throw error;
  }
};

export const getATMStrike = (spot: number): number => {
  return Math.round(spot / 50) * 50;
};

export const findATMContracts = (atmStrike: number): { ce: ScripItem; pe: ScripItem } => {
  const scrips = getCachedScrips();

  let ce: ScripItem | null = null;
  let pe: ScripItem | null = null;

  for (const item of scrips) {
    // Normalise strike representation in SmartAPI headers
    const itemStrike = parseFloat(item.strike) / (parseFloat(item.strike) > 100000 ? 100 : 1);
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
      `Could not find CE or PE ATM contracts for strike ${atmStrike} in cached scrips`,
    );
  }

  return { ce, pe };
};

export const getOptionLtps = async (tokens: string[]): Promise<Map<string, number>> => {
  try {
    const response = await apiRequest({
      method: 'POST',
      url: `${CONSTANTS.ANGEL_ONE_BASE_URL}/rest/secure/angelbroking/market/v1/quote`,
      data: {
        mode: 'LTP',
        exchangeTokens: {
          NFO: tokens,
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
    logger.error(`Error in getOptionLtps: ${error.message}`);
    throw error;
  }
};

export const findClosestPremiumStrike = async (
  type: 'CE' | 'PE',
  targetPremium: number,
): Promise<{ contract: ScripItem; premium: number }> => {
  const scrips = getCachedScrips().filter((s) => s.symbol.endsWith(type));
  if (scrips.length === 0) {
    throw new Error(`No ${type} contracts found in scrip-master.json`);
  }

  // Fetch LTPs for all contracts in batches of 50 to avoid payload limits
  const tokens = scrips.map((s) => s.token);
  const ltpMap = new Map<string, number>();

  const batchSize = 45; // safe margin
  for (let i = 0; i < tokens.length; i += batchSize) {
    const batch = tokens.slice(i, i + batchSize);
    const batchLtps = await getOptionLtps(batch);
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
