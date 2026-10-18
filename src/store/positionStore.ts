import fs from 'fs';
import path from 'path';
import { logger } from '../helpers/logger.js';
import { env } from '../config/env.js';

export interface OptionLeg {
  symbol: string;
  token: string;
  entryPremium: number;
  qty: number; // in lots or total qty
  type: 'CE' | 'PE';
  direction: 'BUY' | 'SELL';
  currentPrice?: number;
}

export interface PositionState {
  active: boolean;
  legs: OptionLeg[];
  entryMargin: number;
  stopLoss: number;
}

class PositionStore {
  private filePath: string;
  private state: PositionState = {
    active: false,
    legs: [],
    entryMargin: 0,
    stopLoss: 0,
  };

  constructor(private symbol: string) {
    this.filePath = path.join(process.cwd(), 'data', `${symbol.toLowerCase()}_positions.json`);
    this.load();
  }

  private load() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(this.filePath)) {
        const fileContent = fs.readFileSync(this.filePath, 'utf-8');
        this.state = JSON.parse(fileContent);
      } else {
        this.save();
      }
    } catch (error: any) {
      logger.error(`Failed to load ${this.symbol} positions: ${error.message}`);
    }
  }

  private save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (error: any) {
      logger.error(`Failed to save ${this.symbol} positions: ${error.message}`);
    }
  }

  public getPositions(): PositionState {
    return { ...this.state };
  }

  public setPositions(legs: OptionLeg[], entryMargin: number, customStopLoss?: number) {
    const defaultSl = entryMargin * (env.STOP_LOSS_PERCENT / 100);
    this.state = {
      active: true,
      legs,
      entryMargin,
      stopLoss: customStopLoss !== undefined ? customStopLoss : defaultSl,
    };
    this.save();
  }

  public updateLegPrice(token: string, price: number) {
    for (const leg of this.state.legs) {
      if (leg.token === token) {
        leg.currentPrice = price;
      }
    }
  }

  public updateLegs(legs: OptionLeg[]) {
    this.state.legs = legs;
    if (legs.length === 0) {
      this.state.active = false;
    }
    this.save();
  }

  public clear() {
    this.state = {
      active: false,
      legs: [],
      entryMargin: 0,
      stopLoss: 0,
    };
    this.save();
  }
}

const storeMap = new Map<string, PositionStore>();

export const getPositionStore = (symbol: string): PositionStore => {
  const upper = symbol.toUpperCase();
  if (!storeMap.has(upper)) {
    storeMap.set(upper, new PositionStore(upper));
  }
  return storeMap.get(upper)!;
};

export const getActivePositionStores = (): PositionStore[] => {
  return Array.from(storeMap.values());
};

export const positionStores: Record<string, PositionStore> = new Proxy(
  {},
  {
    get: (_, prop: string) => getPositionStore(prop),
  },
);

export const positionStore = getPositionStore('NIFTY');
export { PositionStore };
