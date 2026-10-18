import cron from 'node-cron';
import { logger } from './helpers/logger.js';
import { loginToSmartAPI } from './helpers/login.js';
import { downloadAndCacheScripMaster } from './helpers/scripMaster.js';
import { executeStrategyEntry } from './jobs/entryJob.js';
import { startContinuousMonitoring, exitAllPositions } from './jobs/monitorJob.js';
import { positionStores } from './store/positionStore.js';
import { startTelegramBot } from './telegram/bot.js';
import { startExpressServer } from './server.js';
import { isPaperMode } from './helpers/modeManager.js';
import { startMtmLogging } from './jobs/mtmLogger.js';
import { getActiveStrategy } from './strategy/index.js';

const BOOTSTRAP_TIMEZONE = 'Asia/Kolkata';

/**
 * Parse "HH:mm" time string into cron minute and hour parts.
 */
const parseTimeToCron = (timeStr: string): { minute: string; hour: string } => {
  const parts = timeStr.split(':');
  if (parts.length >= 2) {
    return { minute: parts[1], hour: parts[0] };
  }
  return { minute: '0', hour: '9' };
};

const bootstrap = async () => {
  try {
    const strategy = getActiveStrategy();
    const paper = isPaperMode();

    logger.info('==================================================');
    logger.info(`Starting Algo-Trading Skeleton [Strategy: ${strategy.name.toUpperCase()}]`);
    logger.info(`Mode: ${paper ? '🧪 PAPER' : '⚡ LIVE'}`);
    logger.info(`Instruments: ${strategy.instruments.join(', ')}`);
    logger.info('==================================================');

    // 1. Start Express health check & Telegram Bot listeners
    const server = startExpressServer();
    startTelegramBot();

    // 2. Perform SmartAPI login if running in Live Mode
    if (!paper) {
      const loginSuccess = await loginToSmartAPI();
      if (!loginSuccess) {
        logger.error(
          'Failed to log in to SmartAPI on startup. System will not execute live orders without active session.',
        );
      }
    }

    // 3. Crash recovery check: Resume monitoring for any active open positions
    for (const symbol of strategy.instruments) {
      const positions = positionStores[symbol].getPositions();
      if (positions.active) {
        logger.warn(
          `Found active ${symbol} positions from a previous run. Resuming live monitoring...`,
        );
        startContinuousMonitoring(symbol);
      }
    }

    // 4. Schedule Strategy Jobs dynamically from strategy.schedule
    const { schedule } = strategy;
    const weekdaysPattern = schedule.weekdays ? schedule.weekdays.join(',') : '1-5';

    // Cron A: Scrip master update
    const scripTime = parseTimeToCron(schedule.scripMasterTime || '08:30');
    const scripCronPattern = `${scripTime.minute} ${scripTime.hour} * * ${weekdaysPattern}`;
    logger.info(
      `Registering Scrip Master Cron: '${scripCronPattern}' (${schedule.scripMasterTime || '08:30'} IST)`,
    );
    cron.schedule(
      scripCronPattern,
      async () => {
        logger.info('Cron triggered: Starting morning scrip master cache update...');
        const today = new Date();

        for (const symbol of strategy.instruments) {
          const shouldRun = await strategy.shouldRunToday(symbol, today);
          if (shouldRun) {
            if (!isPaperMode()) {
              const loginSuccess = await loginToSmartAPI();
              if (!loginSuccess) continue;
            }
            if (strategy.onScripMasterUpdate) {
              await strategy.onScripMasterUpdate(symbol);
            } else {
              await downloadAndCacheScripMaster(symbol);
            }
          } else {
            logger.info(
              `Today is not an active trading day for ${symbol}. Skipping scrip download.`,
            );
          }
        }
      },
      { timezone: BOOTSTRAP_TIMEZONE },
    );

    // Cron B: Strategy entry
    const entryTime = parseTimeToCron(schedule.entryTime || '09:20');
    const entryCronPattern = `${entryTime.minute} ${entryTime.hour} * * ${weekdaysPattern}`;
    logger.info(
      `Registering Strategy Entry Cron: '${entryCronPattern}' (${schedule.entryTime || '09:20'} IST)`,
    );
    cron.schedule(
      entryCronPattern,
      async () => {
        logger.info(
          `Cron triggered: Checking strategy entry (${schedule.entryTime || '09:20'} AM)...`,
        );
        const today = new Date();

        for (const symbol of strategy.instruments) {
          const shouldRun = await strategy.shouldRunToday(symbol, today);
          if (shouldRun) {
            if (!isPaperMode()) {
              const loginSuccess = await loginToSmartAPI();
              if (!loginSuccess) {
                logger.error(`Skipping strategy entry for ${symbol} due to failed login.`);
                continue;
              }
            }

            logger.info(`Executing strategy entry for ${symbol}...`);
            const success = await executeStrategyEntry(symbol);
            if (success) {
              logger.info(`${symbol} Strategy entered successfully. Starting monitoring...`);
              startContinuousMonitoring(symbol);
            }
          } else {
            logger.info(`Today is not an execution day for ${symbol}. Skipping strategy entry.`);
          }
        }
      },
      { timezone: BOOTSTRAP_TIMEZONE },
    );

    // Cron C: Market close square-off
    const exitTime = parseTimeToCron(schedule.exitTime || '15:27');
    const exitCronPattern = `${exitTime.minute} ${exitTime.hour} * * ${weekdaysPattern}`;
    logger.info(
      `Registering Market Close Exit Cron: '${exitCronPattern}' (${schedule.exitTime || '15:27'} IST)`,
    );
    cron.schedule(
      exitCronPattern,
      async () => {
        logger.info(
          `Cron triggered: Checking market close square-off (${schedule.exitTime || '15:27'} PM)...`,
        );
        const today = new Date();

        for (const symbol of strategy.instruments) {
          const shouldRun = await strategy.shouldRunToday(symbol, today);
          if (shouldRun) {
            if (!isPaperMode()) {
              await loginToSmartAPI();
            }

            const positions = positionStores[symbol].getPositions();
            if (positions.active) {
              await exitAllPositions(
                symbol,
                `Market close square-off (${schedule.exitTime || '15:27'} PM)`,
              );
            }
          }
        }
      },
      { timezone: BOOTSTRAP_TIMEZONE },
    );

    // Cron D: Per-minute MTM logging
    logger.info('Scheduling Per-minute MTM logging...');
    startMtmLogging();

    logger.info('All strategy cron jobs scheduled successfully.');

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
