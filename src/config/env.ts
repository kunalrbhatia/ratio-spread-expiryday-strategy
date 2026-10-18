import dotenv from 'dotenv';

dotenv.config();

export interface Env {
  PORT: number;
  NODE_ENV: string;
  STRATEGY: string;
  PAPER_MODE: boolean;
  STOP_LOSS_PERCENT: number;
  STOP_LOSS_MODE: 'MARGIN' | 'FIXED';
  API_KEY: string;
  CLIENT_CODE: string;
  CLIENT_PIN: string;
  CLIENT_TOTP_PIN: string;
  USE_TELEGRAM: boolean;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  USE_SLACK: boolean;
  SLACK_WEBHOOK_URL?: string;
  SLACK_SIGNING_SECRET?: string;
}

const getEnvOrThrow = (key: string, defaultValue?: string): string => {
  const val = process.env[key] || defaultValue;
  if (val === undefined) {
    throw new Error(`Environment variable ${key} is missing`);
  }
  return val;
};

const getEnvBool = (key: string, defaultValue = 'false'): boolean => {
  const val = process.env[key] || defaultValue;
  return val.toLowerCase() === 'true';
};

const getEnvNumber = (key: string, defaultValue: string): number => {
  const val = getEnvOrThrow(key, defaultValue);
  const parsed = parseFloat(val);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a number`);
  }
  return parsed;
};

// Validate variables
export const env: Env = {
  PORT: getEnvNumber('PORT', '3000'),
  NODE_ENV: getEnvOrThrow('NODE_ENV', 'development'),
  STRATEGY: getEnvOrThrow('STRATEGY', 'example'),
  PAPER_MODE: getEnvBool('PAPER_MODE', 'true'), // Default to paper mode for safety
  STOP_LOSS_PERCENT: getEnvNumber('STOP_LOSS_PERCENT', '1.0'),
  STOP_LOSS_MODE: (process.env.STOP_LOSS_MODE === 'FIXED' ? 'FIXED' : 'MARGIN') as
    'MARGIN' | 'FIXED',
  API_KEY: getEnvOrThrow('API_KEY', 'MOCK_API_KEY'),
  CLIENT_CODE: getEnvOrThrow('CLIENT_CODE', 'MOCK_CLIENT_CODE'),
  CLIENT_PIN: getEnvOrThrow('CLIENT_PIN', '0000'),
  CLIENT_TOTP_PIN: getEnvOrThrow('CLIENT_TOTP_PIN', 'MOCK_TOTP_SEED'),
  USE_TELEGRAM: getEnvBool('USE_TELEGRAM', 'false'),
  USE_SLACK: getEnvBool('USE_SLACK', 'false'),
};

if (env.USE_TELEGRAM) {
  env.TELEGRAM_BOT_TOKEN = getEnvOrThrow('TELEGRAM_BOT_TOKEN');
  env.TELEGRAM_CHAT_ID = getEnvOrThrow('TELEGRAM_CHAT_ID');
}

if (env.USE_SLACK) {
  env.SLACK_WEBHOOK_URL = getEnvOrThrow('SLACK_WEBHOOK_URL');
}
if (process.env.SLACK_SIGNING_SECRET) {
  env.SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
}
