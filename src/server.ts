import express from 'express';
import { env } from './config/env.js';
import { logger } from './helpers/logger.js';
import { positionStores } from './store/positionStore.js';
import { isPaperMode } from './helpers/modeManager.js';
import { Server } from 'http';

const app = express();

app.get('/health', (req, res) => {
  const niftyPositions = positionStores.NIFTY.getPositions();
  const sensexPositions = positionStores.SENSEX.getPositions();
  res.json({
    status: 'UP',
    mode: isPaperMode() ? 'PAPER' : 'LIVE',
    activeTrade: niftyPositions.active || sensexPositions.active,
    activeTrades: {
      NIFTY: niftyPositions.active,
      SENSEX: sensexPositions.active,
    },
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
