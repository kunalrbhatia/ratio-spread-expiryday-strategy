export interface IndexConfig {
  symbol: 'NIFTY' | 'SENSEX';
  spotToken: string;
  exchange: 'NSE' | 'BSE';
  optionExchange: 'NFO' | 'BFO';
  lotSize: number;
  strikeStep: number;
}

export const INDEX_CONFIGS: Record<'NIFTY' | 'SENSEX', IndexConfig> = {
  NIFTY: {
    symbol: 'NIFTY',
    spotToken: '99926000',
    exchange: 'NSE',
    optionExchange: 'NFO',
    lotSize: 65,
    strikeStep: 50,
  },
  SENSEX: {
    symbol: 'SENSEX',
    spotToken: '99919000',
    exchange: 'BSE',
    optionExchange: 'BFO',
    lotSize: 20,
    strikeStep: 100,
  },
};

export const CONSTANTS = {
  LOT_SIZE: 65,
  NIFTY_SYMBOL: 'NIFTY',
  NIFTY_SPOT_TOKEN: '99926000', // NSE index token for Nifty 50
  ANGEL_ONE_BASE_URL: 'https://apiconnect.angelone.in',
  SCRIP_MASTER_URL:
    'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json',
};
