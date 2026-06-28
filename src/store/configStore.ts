import fs from 'fs';
import path from 'path';
import { logger } from '../helpers/logger.js';

export interface ConfigData {
  investmentAmount: number;
}

class ConfigStore {
  private filePath = path.join(process.cwd(), 'data', 'config.json');
  private data: ConfigData = {
    investmentAmount: 100000, // Default investment or margin threshold
  };

  constructor() {
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
        this.data = JSON.parse(fileContent);
      } else {
        this.save();
      }
    } catch (error: any) {
      logger.error(`Failed to load config: ${error.message}`);
    }
  }

  private save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error: any) {
      logger.error(`Failed to save config: ${error.message}`);
    }
  }

  public getInvestmentAmount(): number {
    return this.data.investmentAmount;
  }

  public setInvestmentAmount(amount: number) {
    this.data.investmentAmount = amount;
    this.save();
  }
}

export const configStore = new ConfigStore();
