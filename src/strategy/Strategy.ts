import { OptionLeg } from '../store/positionStore.js';
import { TickData } from '../helpers/websocket.js';

export interface StrategySchedule {
  /** Entry time in HH:mm (Asia/Kolkata timezone), e.g. "09:20" */
  entryTime: string;
  /** Market exit time in HH:mm (Asia/Kolkata timezone), e.g. "15:27" */
  exitTime: string;
  /** Morning scrip master cache update time in HH:mm, e.g. "08:30" (defaults to "08:30") */
  scripMasterTime?: string;
  /** Active trading weekdays (1 = Monday, ..., 5 = Friday). Defaults to [1, 2, 3, 4, 5] */
  weekdays?: number[];
}

export interface StrategyContext {
  symbol: string;
  isPaper: boolean;
}

export interface StrategyExitDecision {
  shouldExit: boolean;
  reason: string;
}

export interface Strategy {
  /** Unique strategy name */
  readonly name: string;
  /** Target instruments to trade (e.g. ['NIFTY', 'SENSEX', 'BANKNIFTY']) */
  readonly instruments: string[];
  /** Strategy execution schedule */
  readonly schedule: StrategySchedule;

  /**
   * Determine whether the strategy should run today for the specified instrument
   * (e.g. check expiry day, weekday filter, or volatility filter).
   */
  shouldRunToday(symbol: string, date: Date): boolean | Promise<boolean>;

  /**
   * Optional scrip master pre-trade preparation for the day.
   */
  onScripMasterUpdate?(symbol: string): Promise<void>;

  /**
   * Strategy entry function.
   * Places initial strategy orders (or creates mock legs in paper mode) and returns the resulting legs.
   * Return null or empty array if entry was skipped or not triggered.
   */
  entry(ctx: StrategyContext): Promise<OptionLeg[] | null>;

  /**
   * Real-time tick callback for open positions.
   * Strategy can evaluate custom profit targets, leg adjustments, or trailing stop logic.
   * Return a StrategyExitDecision to trigger an immediate exit, or null to continue monitoring.
   */
  onTick?(
    ctx: StrategyContext,
    tick: TickData,
    currentPnL: number,
    positions: OptionLeg[],
  ): Promise<StrategyExitDecision | null>;

  /**
   * Computes the stop loss threshold value for the position given the entry margin.
   */
  computeStopLoss(entryMargin: number): number;
}
