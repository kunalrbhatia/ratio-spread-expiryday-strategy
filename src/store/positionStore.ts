import fs from 'fs';
import path from 'path';
import { logger } from '../helpers/logger.js';

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
  stopLoss: number; // 1% of entryMargin
}

class PositionStore {
  private filePath: string;
  private state: PositionState = {
    active: false,
    legs: [],
    entryMargin: 0,
    stopLoss: 0,
  };

  constructor(private symbol: 'NIFTY' | 'SENSEX') {
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

  public setPositions(legs: OptionLeg[], entryMargin: number) {
    this.state = {
      active: true,
      legs,
      entryMargin,
      stopLoss: entryMargin * 0.01,
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

export const positionStores: Record<'NIFTY' | 'SENSEX', PositionStore> = {
  NIFTY: new PositionStore('NIFTY'),
  SENSEX: new PositionStore('SENSEX'),
};

export const positionStore = positionStores.NIFTY;
export { PositionStore };
