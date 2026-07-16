import { Telegraf } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';
import {
  isPaperMode,
  setPaperMode,
  isKillSwitchActive,
  setKillSwitch,
} from '../helpers/modeManager.js';
import { positionStores } from '../store/positionStore.js';
import { calculateCurrentPnL } from '../jobs/monitorJob.js';
import { downloadAndCacheScripMaster } from '../helpers/scripMaster.js';
import { logger } from '../helpers/logger.js';
import { getOptionLtps } from '../helpers/marketData.js';

export let telegramBot: Telegraf | null = null;

export const startTelegramBot = () => {
  if (!env.USE_TELEGRAM || !env.TELEGRAM_BOT_TOKEN) {
    logger.warn('Telegram Bot is disabled or credentials missing. Skipping startup.');
    return;
  }

  try {
    telegramBot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

    // Command: /status
    telegramBot.command('status', async (ctx) => {
      try {
        const paper = isPaperMode();

        let msg = `ℹ️ <b>System Status</b>\n`;
        msg += `<b>Trading Mode:</b> ${paper ? '🧪 PAPER' : '⚡ LIVE'}\n`;
        msg += `---------------------------------\n`;

        for (const symbol of ['NIFTY', 'SENSEX'] as const) {
          const store = positionStores[symbol];
          const positions = store.getPositions();

          if (positions.active) {
            // Fetch fresh prices for status reporting
            const tokens = positions.legs.map((l) => l.token);
            const freshPrices = await getOptionLtps(tokens, symbol);

            // Update positions array temporarily for calculation
            const updatedLegs = positions.legs.map((l) => ({
              ...l,
              currentPrice: freshPrices.get(l.token) ?? l.currentPrice ?? l.entryPremium,
            }));

            const currentPnL = calculateCurrentPnL(updatedLegs);

            msg += `📈 <b>${symbol} Position Status:</b> ACTIVE\n`;
            msg += `<b>Entry Margin:</b> ₹${positions.entryMargin.toLocaleString()}\n`;
            msg += `<b>Stop Loss (1%):</b> ₹${positions.stopLoss.toLocaleString()}\n`;
            msg += `<b>Current P&L:</b> ₹${currentPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n`;

            for (const leg of updatedLegs) {
              msg += `  • <b>${leg.symbol}</b> (${leg.direction})\n`;
              msg += `    Entry: ₹${leg.entryPremium} | LTP: ₹${leg.currentPrice}\n`;
            }
          } else {
            msg += `⚪ <b>${symbol} Position:</b> No active trade today.\n`;
          }
          msg += `---------------------------------\n`;
        }

        ctx.replyWithHTML(msg);
      } catch (err: any) {
        logger.error(`Status command failed: ${err.message}`);
        ctx.reply(`Error retrieving status: ${err.message}`);
      }
    });

    // Command: /paper
    telegramBot.command('paper', (ctx) => {
      const args = ctx.message.text.split(' ');
      if (args.length > 1) {
        const setting = args[1].toLowerCase();
        if (setting === 'on' || setting === 'true') {
          setPaperMode(true);
        } else if (setting === 'off' || setting === 'false') {
          setPaperMode(false);
        }
      }
      const isPaper = isPaperMode();
      ctx.reply(`Trading Mode: ${isPaper ? '🧪 PAPER' : '⚡ LIVE'}`);
    });

    // Command: /kill
    telegramBot.command('kill', (ctx) => {
      const args = ctx.message.text.split(' ');
      if (args.length > 1) {
        const setting = args[1].toLowerCase();
        if (setting === 'on' || setting === 'true') {
          setKillSwitch(true);
        } else if (setting === 'off' || setting === 'false') {
          setKillSwitch(false);
        }
      } else {
        // Toggle if no arguments are provided
        const active = isKillSwitchActive();
        setKillSwitch(!active);
      }
      const isKilled = isKillSwitchActive();
      ctx.reply(
        `Kill Switch: ${isKilled ? '🚨 ACTIVE (Algo is PAUSED)' : '🟢 INACTIVE (Algo is RUNNING)'}`,
      );
    });

    // Command: /update
    telegramBot.command('update', async (ctx) => {
      ctx.reply('Initiating options scrip master update for both indices...');
      const successNifty = await downloadAndCacheScripMaster('NIFTY');
      const successSensex = await downloadAndCacheScripMaster('SENSEX');
      ctx.reply(
        `NIFTY update: ${successNifty ? '✅ Success' : '❌ Failed'}\nSENSEX update: ${successSensex ? '✅ Success' : '❌ Failed'}`,
      );
    });

    // Command: /logs
    telegramBot.command('logs', (ctx) => {
      try {
        const logsDir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(logsDir)) {
          return ctx.reply('No logs directory exists.');
        }

        const files = fs
          .readdirSync(logsDir)
          .filter((f) => f.startsWith('app-') && f.endsWith('.log'));
        if (files.length === 0) {
          return ctx.reply('No log files found.');
        }

        // Get latest log file
        files.sort();
        const latestFile = path.join(logsDir, files[files.length - 1]);
        const logContent = fs.readFileSync(latestFile, 'utf-8');
        const lines = logContent.trim().split('\n');
        const lastLines = lines.slice(-20).join('\n');

        ctx.reply(`Last 20 lines of today's log:\n\n\`\`\`\n${lastLines}\n\`\`\``, {
          parse_mode: 'Markdown',
        });
      } catch (err: any) {
        ctx.reply(`Failed to read logs: ${err.message}`);
      }
    });

    telegramBot.launch();
    logger.info('Telegram Bot listener started.');
  } catch (error: any) {
    logger.error(`Error starting Telegram Bot: ${error.message}`);
  }
};
