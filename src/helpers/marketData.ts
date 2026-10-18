import { apiRequest } from './api.js';
import { CONSTANTS, INDEX_CONFIGS, SupportedIndex } from './constants.js';
import { getCachedScrips, ScripItem } from './scripMaster.js';
import { logger } from './logger.js';

export const getSpotLtp = async (symbol: SupportedIndex | string): Promise<number> => {
  const config = INDEX_CONFIGS[symbol as SupportedIndex];
  if (!config) {
    throw new Error(`Unsupported index symbol: ${symbol}`);
  }
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

export const getATMStrike = (spot: number, strikeStep = 50): number => {
  return Math.round(spot / strikeStep) * strikeStep;
};

export const findATMContracts = (
  symbol: SupportedIndex | string,
  atmStrike: number,
): { ce: ScripItem; pe: ScripItem } => {
  const scrips = getCachedScrips(symbol);

  let ce: ScripItem | null = null;
  let pe: ScripItem | null = null;

  for (const item of scrips) {
    // Normalise strike representation in SmartAPI headers.
    // OPTIDX strikes in both NFO and BFO segments are represented in paise (multiplied by 100).
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
  symbol: SupportedIndex | string = 'NIFTY',
): Promise<Map<string, number>> => {
  const config = INDEX_CONFIGS[symbol as SupportedIndex];
  const optionExchange = config ? config.optionExchange : 'NFO';

  try {
    const response = await apiRequest({
      method: 'POST',
      url: `${CONSTANTS.ANGEL_ONE_BASE_URL}/rest/secure/angelbroking/market/v1/quote`,
      data: {
        mode: 'LTP',
        exchangeTokens: {
          [optionExchange]: tokens,
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
