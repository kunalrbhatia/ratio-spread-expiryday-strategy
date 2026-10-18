import express from 'express';
import { env } from './config/env.js';
import { logger } from './helpers/logger.js';
import { positionStores } from './store/positionStore.js';
import { isPaperMode } from './helpers/modeManager.js';
import { getActiveStrategy } from './strategy/index.js';
import { Server } from 'http';

const app = express();

app.get('/health', (req, res) => {
  const strategy = getActiveStrategy();
  const instruments = strategy.instruments || ['NIFTY'];

  const activeTrades: Record<string, boolean> = {};
  let anyActive = false;

  for (const sym of instruments) {
    const active = positionStores[sym].getPositions().active;
    activeTrades[sym] = active;
    if (active) anyActive = true;
  }

  res.json({
    status: 'UP',
    strategy: strategy.name,
    mode: isPaperMode() ? 'PAPER' : 'LIVE',
    activeTrade: anyActive,
    activeTrades,
    timestamp: new Date().toISOString(),
  });
});

export const startExpressServer = (): Server => {
  const port = env.PORT || 3000;
  const server = app.listen(port, () => {
    logger.info(
      `Express server running on port ${port} (Health route: http://localhost:${port}/health)`,
    );
  });
  return server;
};
