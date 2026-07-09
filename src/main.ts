import cron from 'node-cron';
import { logger } from './helpers/logger.js';
import { isExpiryDayForSymbol } from './helpers/holidayCheck.js';
import { loginToSmartAPI } from './helpers/login.js';
import { downloadAndCacheScripMaster } from './helpers/scripMaster.js';
import { executeExpiryStrategyEntry } from './jobs/entryJob.js';
import { startContinuousMonitoring, exitAllPositions } from './jobs/monitorJob.js';
import { positionStores } from './store/positionStore.js';
import { startTelegramBot } from './telegram/bot.js';
import { startExpressServer } from './server.js';
import { isPaperMode } from './helpers/modeManager.js';

const BOOTSTRAP_TIMEZONE = 'Asia/Kolkata';

const bootstrap = async () => {
  try {
    logger.info('==================================================');
    logger.info('Starting RatioSpread Expiry Strategy Application...');
    logger.info(`Mode: ${isPaperMode() ? '🧪 PAPER' : '⚡ LIVE'}`);
    logger.info('==================================================');

    // 1. Start Express health check & Telegram Bot listeners
    const server = startExpressServer();
    startTelegramBot();

    // 2. Perform SmartAPI login if we are running in Live Mode
    if (!isPaperMode()) {
      const loginSuccess = await loginToSmartAPI();
      if (!loginSuccess) {
        logger.error(
          'Failed to log in to SmartAPI on startup. Strategy will not run without session.',
        );
      }
    }

    // 3. Recovery check: If there was a crash/restart and we have active positions, resume monitoring
    for (const symbol of ['NIFTY', 'SENSEX'] as const) {
      const positions = positionStores[symbol].getPositions();
      if (positions.active) {
        logger.warn(
          `Found active ${symbol} positions from a previous run. Resuming live monitoring...`,
        );
        startContinuousMonitoring(symbol);
      }
    }

    // 4. Register Scheduled Crons (Asia/Kolkata Timezone)

    // Cron A: Scrip master download (08:30 AM, Monday - Friday)
    cron.schedule(
      '30 8 * * 1-5',
      async () => {
        logger.info('Cron triggered: Starting morning scrip master cache update...');
        const today = new Date();
        const isNiftyExpiry = isExpiryDayForSymbol('NIFTY', today);
        const isSensexExpiry = isExpiryDayForSymbol('SENSEX', today);

        if (isNiftyExpiry || isSensexExpiry) {
          if (!isPaperMode()) {
            const loginSuccess = await loginToSmartAPI();
            if (!loginSuccess) return;
          }
          if (isNiftyExpiry) {
            await downloadAndCacheScripMaster('NIFTY');
          }
          if (isSensexExpiry) {
            await downloadAndCacheScripMaster('SENSEX');
          }
        } else {
          logger.info(
            'Today is not an expiry day for NIFTY or SENSEX. Skipping scrip master download.',
          );
        }
      },
      {
        timezone: BOOTSTRAP_TIMEZONE,
      },
    );

    // Cron B: Expiry strategy entry (09:20 AM, Monday - Friday)
    cron.schedule(
      '20 9 * * 1-5',
      async () => {
        logger.info('Cron triggered: Checking for expiry strategy entry (09:20 AM)...');
        const today = new Date();
        const isNiftyExpiry = isExpiryDayForSymbol('NIFTY', today);
        const isSensexExpiry = isExpiryDayForSymbol('SENSEX', today);

        if (isNiftyExpiry || isSensexExpiry) {
          if (!isPaperMode()) {
            const loginSuccess = await loginToSmartAPI();
            if (!loginSuccess) {
              logger.error('Skipping strategy entry due to failed login.');
              return;
            }
          }

          if (isNiftyExpiry) {
            logger.info('Today is NIFTY expiry. Executing NIFTY strategy entry...');
            const success = await executeExpiryStrategyEntry('NIFTY');
            if (success) {
              logger.info('NIFTY Strategy entered successfully. Starting monitoring...');
              startContinuousMonitoring('NIFTY');
            }
          }

          if (isSensexExpiry) {
            logger.info('Today is SENSEX expiry. Executing SENSEX strategy entry...');
            const success = await executeExpiryStrategyEntry('SENSEX');
            if (success) {
              logger.info('SENSEX Strategy entered successfully. Starting monitoring...');
              startContinuousMonitoring('SENSEX');
            }
          }
        } else {
          logger.info('Today is not an expiry day for NIFTY or SENSEX. Skipping strategy entry.');
        }
      },
      {
        timezone: BOOTSTRAP_TIMEZONE,
      },
    );

    // Cron C: Expiry strategy exit / market close (03:30 PM, Monday - Friday)
    cron.schedule(
      '30 15 * * 1-5',
      async () => {
        logger.info('Cron triggered: Checking for market close square-off (03:30 PM)...');
        const today = new Date();
        const isNiftyExpiry = isExpiryDayForSymbol('NIFTY', today);
        const isSensexExpiry = isExpiryDayForSymbol('SENSEX', today);

        if (isNiftyExpiry || isSensexExpiry) {
          if (!isPaperMode()) {
            await loginToSmartAPI();
          }

          if (isNiftyExpiry) {
            const positions = positionStores.NIFTY.getPositions();
            if (positions.active) {
              await exitAllPositions('NIFTY', 'Market close square-off (03:30 PM)');
            }
          }

          if (isSensexExpiry) {
            const positions = positionStores.SENSEX.getPositions();
            if (positions.active) {
              await exitAllPositions('SENSEX', 'Market close square-off (03:30 PM)');
            }
          }
        } else {
          logger.info(
            'Today is not an expiry day for NIFTY or SENSEX. Skipping market close check.',
          );
        }
      },
      {
        timezone: BOOTSTRAP_TIMEZONE,
      },
    );

    logger.info('All cron jobs scheduled successfully.');

    // Graceful Shutdown handling
    const shutdown = async () => {
      logger.info('Shutting down application...');
      server.close(() => {
        logger.info('HTTP server closed.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error: any) {
    logger.error(`Unhandled bootstrap error: ${error.message}`);
    process.exit(1);
  }
};

bootstrap();
