import WebSocket from 'ws';
import { env } from '../config/env.js';
import { sessionStore } from '../store/sessionStore.js';
import { logger } from './logger.js';
import { isPaperMode } from './modeManager.js';
import { positionStores } from '../store/positionStore.js';
import { INDEX_CONFIGS } from './constants.js';

export interface TickData {
  token: string;
  ltp: number;
}

export type TickCallback = (tick: TickData) => void;

class SmartStreamClient {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private mockInterval: NodeJS.Timeout | null = null;
  private callback: TickCallback | null = null;
  private subscribedTokens: Set<string> = new Set();

  public connect(callback: TickCallback) {
    this.callback = callback;

    if (this.isConnected) {
      return;
    }

    if (isPaperMode()) {
      logger.info('Starting SmartStream Client in [PAPER MODE] mock tick generator');
      this.startMockGenerator();
      this.isConnected = true;
      return;
    }

    const session = sessionStore.getSession();
    if (!session.jwtToken || !session.feedToken) {
      logger.error('Cannot connect to WebSocket: JWT Token or Feed Token is missing');
      return;
    }

    try {
      const url = 'wss://smartapisocket.angelone.in/smart-stream';
      const wsHeaders = {
        Authorization: `${session.jwtToken}`,
        'x-api-key': env.API_KEY,
        'x-client-code': env.CLIENT_CODE,
        'x-feed-token': session.feedToken,
      };

      this.ws = new WebSocket(url, {
        headers: wsHeaders,
        rejectUnauthorized: false,
      });

      this.ws.on('open', () => {
        logger.info('SmartStream WebSocket connection established successfully.');
        this.isConnected = true;
        // Re-subscribe if we had previous tokens
        // Since we don't store the symbol for cached tokens, we can check where they belong
        if (this.subscribedTokens.size > 0) {
          // Re-subscribe in separate payloads depending on whether they are NSE or BSE
          const niftyTokens: string[] = [];
          const sensexTokens: string[] = [];

          const niftyPositions = positionStores.NIFTY.getPositions();
          const sensexPositions = positionStores.SENSEX.getPositions();

          for (const token of this.subscribedTokens) {
            if (niftyPositions.legs.some((l) => l.token === token)) {
              niftyTokens.push(token);
            } else if (sensexPositions.legs.some((l) => l.token === token)) {
              sensexTokens.push(token);
            } else {
              // Default fallback
              niftyTokens.push(token);
            }
          }

          if (niftyTokens.length > 0) this.subscribe(niftyTokens, 'NIFTY');
          if (sensexTokens.length > 0) this.subscribe(sensexTokens, 'SENSEX');
        }
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          if (Buffer.isBuffer(data)) {
            const type = data.readUInt8(0);
            if (type === 1 || type === 3) {
              const tokenBuffer = data.slice(1, 26);
              const token = tokenBuffer.toString('utf8').replace(/\0/g, '').trim();
              const ltpRaw = data.readInt32LE(26);
              const ltp = ltpRaw / 100;

              if (token && ltp > 0) {
                if (this.callback) {
                  this.callback({ token, ltp });
                }
              }
            }
          }
        } catch (err: any) {
          logger.error(`Error parsing WebSocket binary message: ${err.message}`);
        }
      });

      this.ws.on('error', (err: any) => {
        logger.error(`SmartStream WebSocket error: ${err.message}`);
      });

      this.ws.on('close', () => {
        logger.warn('SmartStream WebSocket connection closed. Attempting reconnect in 5s...');
        this.isConnected = false;
        setTimeout(() => this.connect(callback), 5000);
      });
    } catch (error: any) {
      logger.error(`Failed to initiate SmartStream connection: ${error.message}`);
    }
  }

  public subscribe(tokens: string[], symbol: 'NIFTY' | 'SENSEX') {
    tokens.forEach((t) => this.subscribedTokens.add(t));

    if (isPaperMode()) {
      logger.info(`Mock subscribed to tokens: ${tokens.join(', ')}`);
      return;
    }

    if (this.ws && this.isConnected) {
      const config = INDEX_CONFIGS[symbol];
      const payload = {
        action: 1, // 1 = Subscribe
        params: {
          mode: 1, // 1 = LTP
          tokenList: [
            {
              exchangeType: config.optionExchange === 'NFO' ? 2 : 4, // 2 = NFO, 4 = BFO
              tokens,
            },
          ],
        },
      };
      this.ws.send(JSON.stringify(payload));
      logger.info(`Subscribed to SmartStream tokens: ${tokens.join(', ')} for ${symbol}`);
    }
  }

  public unsubscribe(tokens: string[], symbol: 'NIFTY' | 'SENSEX') {
    tokens.forEach((t) => this.subscribedTokens.delete(t));

    if (isPaperMode()) {
      logger.info(`Mock unsubscribed from tokens: ${tokens.join(', ')}`);
      return;
    }

    if (this.ws && this.isConnected) {
      const config = INDEX_CONFIGS[symbol];
      const payload = {
        action: 2, // 2 = Unsubscribe
        params: {
          mode: 1, // 1 = LTP
          tokenList: [
            {
              exchangeType: config.optionExchange === 'NFO' ? 2 : 4, // 2 = NFO, 4 = BFO
              tokens,
            },
          ],
        },
      };
      this.ws.send(JSON.stringify(payload));
      logger.info(`Unsubscribed from SmartStream tokens: ${tokens.join(', ')} for ${symbol}`);
    }

    // If no more tokens are subscribed across both indices, disconnect
    if (this.subscribedTokens.size === 0) {
      this.disconnect();
    }
  }

  public disconnect() {
    this.stopMockGenerator();
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.subscribedTokens.clear();
    logger.info('SmartStream WebSocket disconnected.');
  }

  private startMockGenerator() {
    this.stopMockGenerator();

    // Simulate tick updates every 1.5 seconds
    this.mockInterval = setInterval(() => {
      if (!this.callback) return;

      const niftyPositions = positionStores.NIFTY.getPositions();
      const sensexPositions = positionStores.SENSEX.getPositions();

      const niftyActive = niftyPositions.active && niftyPositions.legs.length > 0;
      const sensexActive = sensexPositions.active && sensexPositions.legs.length > 0;

      if (!niftyActive && !sensexActive) {
        // Emit general dummy ticks if no active positions
        for (const token of this.subscribedTokens) {
          const ltp = 100 + (Math.random() - 0.5) * 5;
          this.callback({ token, ltp: parseFloat(ltp.toFixed(2)) });
        }
        return;
      }

      // Simulate realistic option pricing changes for NIFTY
      if (niftyActive) {
        for (const leg of niftyPositions.legs) {
          if (this.subscribedTokens.has(leg.token)) {
            const currentPrice = leg.currentPrice || leg.entryPremium;
            const change = (Math.random() - 0.53) * 1.5;
            const nextPrice = Math.max(0.05, currentPrice + change);
            positionStores.NIFTY.updateLegPrice(leg.token, nextPrice);

            this.callback({
              token: leg.token,
              ltp: parseFloat(nextPrice.toFixed(2)),
            });
          }
        }
      }

      // Simulate realistic option pricing changes for SENSEX
      if (sensexActive) {
        for (const leg of sensexPositions.legs) {
          if (this.subscribedTokens.has(leg.token)) {
            const currentPrice = leg.currentPrice || leg.entryPremium;
            const change = (Math.random() - 0.53) * 1.5;
            const nextPrice = Math.max(0.05, currentPrice + change);
            positionStores.SENSEX.updateLegPrice(leg.token, nextPrice);

            this.callback({
              token: leg.token,
              ltp: parseFloat(nextPrice.toFixed(2)),
            });
          }
        }
      }
    }, 1500);
  }

  private stopMockGenerator() {
    if (this.mockInterval) {
      clearInterval(this.mockInterval);
      this.mockInterval = null;
    }
  }
}

export const smartStream = new SmartStreamClient();
