export type SupportedIndex = 'NIFTY' | 'SENSEX' | 'BANKNIFTY';

export interface IndexConfig {
  symbol: SupportedIndex;
  spotToken: string;
  exchange: 'NSE' | 'BSE';
  optionExchange: 'NFO' | 'BFO';
  lotSize: number; // NOTE: Verify lot sizes before live use (exchange regulations update periodically)
  strikeStep: number;
}

export const INDEX_CONFIGS: Record<SupportedIndex, IndexConfig> = {
  NIFTY: {
    symbol: 'NIFTY',
    spotToken: '99926000', // NSE Index token for Nifty 50
    exchange: 'NSE',
    optionExchange: 'NFO',
    lotSize: 65, // NOTE: Verify lot sizes before live use
    strikeStep: 50,
  },
  SENSEX: {
    symbol: 'SENSEX',
    spotToken: '99919000', // BSE Index token for Sensex
    exchange: 'BSE',
    optionExchange: 'BFO',
    lotSize: 20, // NOTE: Verify lot sizes before live use
    strikeStep: 100,
  },
  BANKNIFTY: {
    symbol: 'BANKNIFTY',
    spotToken: '99926009', // NSE Index token for Bank Nifty
    exchange: 'NSE',
    optionExchange: 'NFO',
    lotSize: 30, // NOTE: Verify lot sizes before live use
    strikeStep: 100,
  },
};

export const CONSTANTS = {
  ANGEL_ONE_BASE_URL: 'https://apiconnect.angelone.in',
  SCRIP_MASTER_URL:
    'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json',
};
