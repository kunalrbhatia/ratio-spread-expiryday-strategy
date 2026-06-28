import cron from 'node-cron';
import { logger } from './helpers/logger.js';
import { isExpiryDay } from './helpers/holidayCheck.js';
import { loginToSmartAPI } from './helpers/login.js';
import { downloadAndCacheScripMaster } from './helpers/scripMaster.js';
import { executeExpiryStrategyEntry } from './jobs/entryJob.js';
import { startContinuousMonitoring, exitAllPositions } from './jobs/monitorJob.js';
import { positionStore } from './store/positionStore.js';
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

    // 3. Recovery check: If there was a crash/restart and we have an active position, resume monitoring
    const positions = positionStore.getPositions();
    if (positions.active) {
      logger.warn('Found active positions from a previous run. Resuming live monitoring...');
      startContinuousMonitoring();
    }

    // 4. Register Scheduled Crons (Asia/Kolkata Timezone)

    // Cron A: Scrip master download (08:30 AM, Monday - Friday)
    cron.schedule(
      '30 8 * * 1-5',
      async () => {
        logger.info('Cron triggered: Starting morning scrip master cache update...');
        // Only download scrips on expiry days to optimize bandwith/rate limit usage
        if (isExpiryDay(new Date())) {
          if (!isPaperMode()) {
            const loginSuccess = await loginToSmartAPI();
            if (!loginSuccess) return;
          }
          await downloadAndCacheScripMaster();
        } else {
          logger.info('Today is not an expiry day. Skipping scrip master download.');
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
        if (isExpiryDay(new Date())) {
          if (!isPaperMode()) {
            const loginSuccess = await loginToSmartAPI();
            if (!loginSuccess) {
              logger.error('Skipping strategy entry due to failed login.');
              return;
            }
          }

          const success = await executeExpiryStrategyEntry();
          if (success) {
            logger.info('Strategy entered successfully. Starting monitoring...');
            startContinuousMonitoring();
          }
        } else {
          logger.info('Today is not an expiry day. Skipping strategy entry.');
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
        if (isExpiryDay(new Date())) {
          const positions = positionStore.getPositions();
          if (positions.active) {
            if (!isPaperMode()) {
              await loginToSmartAPI();
            }
            await exitAllPositions('Market close square-off (03:30 PM)');
          }
        } else {
          logger.info('Today is not an expiry day. Skipping market close check.');
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
