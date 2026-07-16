import dotenv from 'dotenv';

dotenv.config();

export interface Env {
  PORT: number;
  NODE_ENV: string;
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
  ENABLE_SENSEX_EXPIRY: boolean;
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
  const parsed = parseInt(val, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a number`);
  }
  return parsed;
};

// Validate variables
export const env: Env = {
  PORT: getEnvNumber('PORT', '3000'),
  NODE_ENV: getEnvOrThrow('NODE_ENV', 'development'),
  API_KEY: getEnvOrThrow('API_KEY'),
  CLIENT_CODE: getEnvOrThrow('CLIENT_CODE'),
  CLIENT_PIN: getEnvOrThrow('CLIENT_PIN'),
  CLIENT_TOTP_PIN: getEnvOrThrow('CLIENT_TOTP_PIN'),
  USE_TELEGRAM: getEnvBool('USE_TELEGRAM', 'true'),
  USE_SLACK: getEnvBool('USE_SLACK', 'false'),
  ENABLE_SENSEX_EXPIRY: getEnvBool('ENABLE_SENSEX_EXPIRY', 'true'),
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
