import { Telegraf } from 'telegraf';
import axios from 'axios';
import { env } from './config/env.js';
import { logger } from './helpers/logger.js';

let bot: Telegraf | null = null;

if (env.TELEGRAM_ENABLED && env.TELEGRAM_BOT_TOKEN) {
  try {
    bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);
  } catch (err: any) {
    logger.error(`Failed to initialize Telegraf Bot: ${err.message}`);
  }
}

export const sendSlackNotification = async (message: string): Promise<boolean> => {
  if (!env.SLACK_WEBHOOK_URL) {
    logger.warn('Slack Webhook URL is missing. Cannot send Slack notification.');
    return false;
  }

  try {
    const payload = {
      text: `[RatioSpread Algo Alert]: ${message}`,
      username: 'Expiry Strategy Bot',
      icon_emoji: ':chart_with_upwards_trend:',
    };

    await axios.post(env.SLACK_WEBHOOK_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    logger.info(`Slack alert sent successfully.`);
    return true;
  } catch (err: any) {
    logger.error(`Failed to send Slack alert: ${err.message}`);
    return false;
  }
};

export const sendAlert = async (message: string): Promise<void> => {
  logger.info(`Notification Alert: ${message}`);
  let telegramSent = false;

  if (env.TELEGRAM_ENABLED && bot && env.TELEGRAM_CHAT_ID) {
    try {
      await bot.telegram.sendMessage(env.TELEGRAM_CHAT_ID, message, {
        parse_mode: 'HTML',
      });
      telegramSent = true;
      logger.info('Telegram alert sent successfully.');
    } catch (err: any) {
      logger.error(`Telegram notification failed: ${err.message}. Retrying via Slack fallback...`);
    }
  }

  // Fallback to Slack if Telegram is disabled, failed, or not working
  if (!telegramSent && env.SLACK_ENABLED) {
    await sendSlackNotification(message);
  }
};

export const notifierHelper = {
  sendAlert,
  sendSlackNotification,
};
