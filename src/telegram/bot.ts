import { Telegraf } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';
import {
  isPaperMode,
  setPaperMode,
  isKillSwitchActive,
  setKillSwitch,
  isPanicSwitchActive,
  setPanicSwitch,
} from '../helpers/modeManager.js';
import { positionStores } from '../store/positionStore.js';
import { calculateCurrentPnL } from '../jobs/monitorJob.js';
import { downloadAndCacheScripMaster } from '../helpers/scripMaster.js';
import { logger } from '../helpers/logger.js';
import { getOptionLtps } from '../helpers/marketData.js';
import { getActiveStrategy } from '../strategy/index.js';

export let telegramBot: Telegraf | null = null;

export const startTelegramBot = () => {
  if (!env.USE_TELEGRAM || !env.TELEGRAM_BOT_TOKEN) {
    logger.warn('Telegram Bot is disabled or credentials missing. Skipping startup.');
    return;
  }

  try {
    telegramBot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

    // Middleware to authorize incoming commands/messages
    telegramBot.use((ctx, next) => {
      const fromId = ctx.from?.id ? String(ctx.from.id) : '';
      if (fromId !== env.TELEGRAM_CHAT_ID) {
        logger.warn(`Unauthorized Telegram command from user ID: ${fromId || 'unknown'}`);
        return; // silently drop
      }
      return next();
    });

    // Command: /status
    telegramBot.command('status', async (ctx) => {
      try {
        const paper = isPaperMode();
        const killActive = isKillSwitchActive();
        const panicActive = isPanicSwitchActive();
        const strategy = getActiveStrategy();

        let msg = `ℹ️ <b>System Status [${strategy.name.toUpperCase()}]</b>\n`;
        msg += `<b>Trading Mode:</b> ${paper ? '🧪 PAPER' : '⚡ LIVE'}\n`;
        if (killActive || panicActive) {
          msg += `<b>System Status:</b> ${panicActive ? '🚨 PANIC (HALTED)' : '⚠️ KILLED (No new entries)'}\n`;
        } else {
          msg += `<b>System Status:</b> 🟢 RUNNING\n`;
        }
        msg += `---------------------------------\n`;

        for (const symbol of strategy.instruments) {
          const store = positionStores[symbol];
          const positions = store.getPositions();

          if (positions.active) {
            // Fetch fresh prices for status reporting
            const tokens = positions.legs.map((l) => l.token);
            let freshPrices = new Map<string, number>();
            try {
              freshPrices = await getOptionLtps(tokens, symbol);
            } catch {
              // fallback to cached prices
            }

            const updatedLegs = positions.legs.map((l) => ({
              ...l,
              currentPrice: freshPrices.get(l.token) ?? l.currentPrice ?? l.entryPremium,
            }));

            const currentPnL = calculateCurrentPnL(updatedLegs);

            msg += `📈 <b>${symbol} Position Status:</b> ACTIVE\n`;
            msg += `<b>Entry Margin:</b> ₹${positions.entryMargin.toLocaleString()}\n`;
            msg += `<b>Stop Loss:</b> ₹${positions.stopLoss.toLocaleString()}\n`;
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
        const active = isKillSwitchActive();
        setKillSwitch(!active);
      }
      const isKilled = isKillSwitchActive();
      ctx.reply(
        `Kill Switch: ${isKilled ? '🚨 ACTIVE (New entries are BLOCKED)' : '🟢 INACTIVE (New entries are ALLOWED)'}`,
      );
    });

    // Command: /panic
    telegramBot.command('panic', (ctx) => {
      const args = ctx.message.text.split(' ');
      if (args.length > 1) {
        const setting = args[1].toLowerCase();
        if (setting === 'on' || setting === 'true') {
          setPanicSwitch(true);
        } else if (setting === 'off' || setting === 'false') {
          setPanicSwitch(false);
        }
      } else {
        const active = isPanicSwitchActive();
        setPanicSwitch(!active);
      }
      const isPanicked = isPanicSwitchActive();
      ctx.reply(
        `Panic Switch: ${isPanicked ? '🚨 ACTIVE (All entries, exits, and monitoring are HALTED)' : '🟢 INACTIVE (Monitoring and exits are active)'}`,
      );
    });

    // Command: /update
    telegramBot.command('update', async (ctx) => {
      const strategy = getActiveStrategy();
      ctx.reply(
        `Initiating scrip master update for strategy instruments: ${strategy.instruments.join(', ')}...`,
      );
      const results: string[] = [];
      for (const symbol of strategy.instruments) {
        const success = await downloadAndCacheScripMaster(symbol);
        results.push(`${symbol}: ${success ? '✅ Success' : '❌ Failed'}`);
      }
      ctx.reply(results.join('\n'));
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
