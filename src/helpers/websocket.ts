import WebSocket from 'ws';
import { env } from '../config/env.js';
import { sessionStore } from '../store/sessionStore.js';
import { logger } from './logger.js';
import { isPaperMode } from './modeManager.js';
import { getActivePositionStores } from '../store/positionStore.js';
import { INDEX_CONFIGS, SupportedIndex } from './constants.js';

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
  private reconnectAttempts = 0;

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
        this.reconnectAttempts = 0;

        // Re-subscribe if we have existing tokens upon reconnect
        if (this.subscribedTokens.size > 0) {
          logger.info(`Re-subscribing to ${this.subscribedTokens.size} active tokens on reconnect`);
        }
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const parsedTick = this.parseBinaryTick(data);
          if (parsedTick && this.callback) {
            this.callback(parsedTick);
          }
        } catch (err: any) {
          logger.error(`Error processing SmartStream tick: ${err.message}`);
        }
      });

      this.ws.on('close', (code, reason) => {
        logger.warn(
          `SmartStream WebSocket closed (Code: ${code}, Reason: ${reason.toString() || 'none'}). Reconnecting...`,
        );
        this.isConnected = false;
        this.handleReconnect();
      });

      this.ws.on('error', (err) => {
        logger.error(`SmartStream WebSocket error: ${err.message}`);
      });
    } catch (err: any) {
      logger.error(`Error initializing WebSocket: ${err.message}`);
    }
  }

  private handleReconnect() {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    logger.info(
      `Attempting SmartStream reconnect in ${delay / 1000}s (Attempt ${this.reconnectAttempts})...`,
    );

    setTimeout(async () => {
      if (this.reconnectAttempts > 3) {
        logger.warn('Multiple WebSocket reconnect failures. Re-authenticating login session...');
        try {
          const { loginToSmartAPI } = await import('./login.js');
          await loginToSmartAPI();
        } catch (e: any) {
          logger.error(`Re-authentication failed during reconnect: ${e.message}`);
        }
      }
      if (this.callback) {
        this.connect(this.callback);
      }
    }, delay);
  }

  /**
   * Parse SmartStream V2 Binary Packets:
   * Token: bytes 2-27 (ASCII string, trimmed)
   * LTP: bytes 43-50 (BigInt64LE / 100)
   */
  public parseBinaryTick(buffer: Buffer): TickData | null {
    try {
      if (buffer.length < 51) {
        return null;
      }
      const token = buffer.subarray(2, 28).toString('ascii').replace(/\0/g, '').trim();
      const rawLtp = buffer.readBigInt64LE(43);
      const ltp = Number(rawLtp) / 100;

      return {
        token,
        ltp: parseFloat(ltp.toFixed(2)),
      };
    } catch {
      return null;
    }
  }

  public subscribe(tokens: string[], symbol: string) {
    tokens.forEach((t) => this.subscribedTokens.add(t));

    if (isPaperMode()) {
      logger.info(`Mock subscribed to tokens: ${tokens.join(', ')}`);
      return;
    }

    if (this.ws && this.isConnected) {
      const config = INDEX_CONFIGS[symbol as SupportedIndex];
      const exchangeType = config && config.optionExchange === 'BFO' ? 4 : 2; // 2 = NFO, 4 = BFO
      const payload = {
        action: 1, // 1 = Subscribe
        params: {
          mode: 1, // 1 = LTP
          tokenList: [
            {
              exchangeType,
              tokens,
            },
          ],
        },
      };
      this.ws.send(JSON.stringify(payload));
      logger.info(`Subscribed to SmartStream tokens: ${tokens.join(', ')} for ${symbol}`);
    }
  }

  public unsubscribe(tokens: string[], symbol: string) {
    tokens.forEach((t) => this.subscribedTokens.delete(t));

    if (isPaperMode()) {
      logger.info(`Mock unsubscribed from tokens: ${tokens.join(', ')}`);
      return;
    }

    if (this.ws && this.isConnected) {
      const config = INDEX_CONFIGS[symbol as SupportedIndex];
      const exchangeType = config && config.optionExchange === 'BFO' ? 4 : 2;
      const payload = {
        action: 2, // 2 = Unsubscribe
        params: {
          mode: 1, // 1 = LTP
          tokenList: [
            {
              exchangeType,
              tokens,
            },
          ],
        },
      };
      this.ws.send(JSON.stringify(payload));
      logger.info(`Unsubscribed from SmartStream tokens: ${tokens.join(', ')} for ${symbol}`);
    }

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

      const activeStores = getActivePositionStores();
      let hasActivePositions = false;

      for (const store of activeStores) {
        const positions = store.getPositions();
        if (positions.active && positions.legs.length > 0) {
          hasActivePositions = true;
          for (const leg of positions.legs) {
            if (this.subscribedTokens.has(leg.token)) {
              const currentPrice = leg.currentPrice || leg.entryPremium;
              const change = (Math.random() - 0.53) * 1.5;
              const nextPrice = Math.max(0.05, currentPrice + change);
              store.updateLegPrice(leg.token, nextPrice);

              this.callback({
                token: leg.token,
                ltp: parseFloat(nextPrice.toFixed(2)),
              });
            }
          }
        }
      }

      if (!hasActivePositions) {
        for (const token of this.subscribedTokens) {
          const ltp = 100 + (Math.random() - 0.5) * 5;
          this.callback({ token, ltp: parseFloat(ltp.toFixed(2)) });
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
