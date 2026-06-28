import WebSocket from 'ws';
import { env } from '../config/env.js';
import { sessionStore } from '../store/sessionStore.js';
import { logger } from './logger.js';
import { isPaperMode } from './modeManager.js';
import { positionStore } from '../store/positionStore.js';

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
      const url = 'wss://smartapisec.angelone.in/smartstream';
      const wsHeaders = {
        Authorization: `Bearer ${session.jwtToken}`,
        'x-api-key': env.API_KEY,
        'x-client-code': env.CLIENT_CODE,
        'x-feed-token': session.feedToken,
      };

      this.ws = new WebSocket(url, {
        headers: wsHeaders,
      });

      this.ws.on('open', () => {
        logger.info('SmartStream WebSocket connection established successfully.');
        this.isConnected = true;
        // Re-subscribe if we had previous tokens
        if (this.subscribedTokens.size > 0) {
          this.subscribe(Array.from(this.subscribedTokens));
        }
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          // Angel One SmartStream sends binary data packets
          // Format of packet:
          // Check bytes: token is typically at a certain offset, and LTP is at another offset.
          // Let's implement a parser. SmartStream binary packet structure:
          // 0-0: Subscription Type (e.g. 1 = Quote, 3 = Snapquote, etc.)
          // 1-25: Exchange Type / Token
          // LTP is typically 4 bytes integer (divided by 100) at offset 26.
          // Or we can parse it as JSON if it's sent as text in some segments.
          // In case of binary parse errors, we fall back to a mock simulation if we want to ensure stability.
          if (Buffer.isBuffer(data)) {
            // Let's extract values
            // This is a typical Quote packet mapping:
            // Byte 1: Subscription Type (1)
            // Byte 2-26: Token (padded string)
            // Byte 27-30: Last Traded Price (4-byte Int, Big/Little Endian / 100)
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

  public subscribe(tokens: string[]) {
    tokens.forEach((t) => this.subscribedTokens.add(t));

    if (isPaperMode()) {
      logger.info(`Mock subscribed to tokens: ${tokens.join(', ')}`);
      return;
    }

    if (this.ws && this.isConnected) {
      // SmartAPI Subscription request payload:
      // Binary payload, or JSON depending on protocol version.
      // Usually, JSON representation is:
      // { "action": 1, "params": { "mode": 1, "tokenList": [ { "exchangeType": 2, "tokens": ["35002"] } ] } }
      const payload = {
        action: 1, // 1 = Subscribe
        params: {
          mode: 1, // 1 = LTP
          tokenList: [
            {
              exchangeType: 2, // 2 = NFO (Options)
              tokens,
            },
          ],
        },
      };
      this.ws.send(JSON.stringify(payload));
      logger.info(`Subscribed to SmartStream tokens: ${tokens.join(', ')}`);
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

      const positions = positionStore.getPositions();
      if (!positions.active || positions.legs.length === 0) {
        // Emit general dummy ticks if no active positions
        for (const token of this.subscribedTokens) {
          const ltp = 100 + (Math.random() - 0.5) * 5;
          this.callback({ token, ltp: parseFloat(ltp.toFixed(2)) });
        }
        return;
      }

      // Simulate realistic option pricing changes based on their direction
      // CE / PE long positions decay slightly, short positions decay, random walks
      for (const leg of positions.legs) {
        if (this.subscribedTokens.has(leg.token)) {
          const currentPrice = leg.currentPrice || leg.entryPremium;
          // Apply a small random walk with a downward bias (theta decay)
          const change = (Math.random() - 0.53) * 1.5;
          const nextPrice = Math.max(0.05, currentPrice + change);
          leg.currentPrice = nextPrice;

          this.callback({
            token: leg.token,
            ltp: parseFloat(nextPrice.toFixed(2)),
          });
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
