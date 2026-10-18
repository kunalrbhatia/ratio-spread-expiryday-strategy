import { Strategy, StrategyContext, StrategyExitDecision, StrategySchedule } from './Strategy.js';
import { OptionLeg } from '../store/positionStore.js';
import { TickData } from '../helpers/websocket.js';
import { logger } from '../helpers/logger.js';
import { env } from '../config/env.js';

/**
 * ExampleStrategy
 *
 * A template/no-op strategy stub.
 * In PAPER mode: logs simulated entry behavior without risking capital.
 * In LIVE mode: NEVER places live trades; serves as an architectural blueprint.
 */
export class ExampleStrategy implements Strategy {
  public readonly name = 'example';
  public readonly instruments = ['NIFTY'];

  public readonly schedule: StrategySchedule = {
    entryTime: '09:20',
    exitTime: '15:27',
    scripMasterTime: '08:30',
    weekdays: [1, 2, 3, 4, 5],
  };

  /**
   * Determine whether strategy should trade today.
   * TODO: Add your custom schedule filter (e.g. isExpiryDayForSymbol, IV percentile, etc.)
   */
  public async shouldRunToday(symbol: string, date: Date): Promise<boolean> {
    logger.info(
      `[ExampleStrategy] Evaluating if ${symbol} should run today (${date.toISOString()})`,
    );
    // Example: return true on trading days
    return true;
  }

  /**
   * Pre-market setup (e.g. download scrip master for the target symbol).
   */
  public async onScripMasterUpdate(symbol: string): Promise<void> {
    logger.info(`[ExampleStrategy] Scrip master update hook invoked for ${symbol}`);
  }

  /**
   * Strategy Entry
   * In LIVE mode, returns null (no-op).
   * In PAPER mode, returns a mock simulated position leg so that tick monitoring and exit flows can be tested end-to-end.
   */
  public async entry(ctx: StrategyContext): Promise<OptionLeg[] | null> {
    logger.info(`[ExampleStrategy] Entry triggered for ${ctx.symbol} (Paper: ${ctx.isPaper})`);

    if (!ctx.isPaper) {
      logger.warn(
        '[ExampleStrategy] Live mode execution disabled for ExampleStrategy. No orders placed.',
      );
      return null;
    }

    // Example mock leg for testing paper mode
    const mockLeg: OptionLeg = {
      symbol: `${ctx.symbol}-TEST-CE`,
      token: 'MOCK_TOKEN_1',
      entryPremium: 100,
      qty: 65,
      type: 'CE',
      direction: 'BUY',
      currentPrice: 100,
    };

    logger.info(`[ExampleStrategy] Paper mode mock leg created: ${mockLeg.symbol}`);
    return [mockLeg];
  }

  /**
   * Evaluates incoming real-time market ticks.
   * Return a StrategyExitDecision to trigger an exit, or null to keep holding.
   */
  public async onTick(
    ctx: StrategyContext,
    tick: TickData,
    currentPnL: number,
    positions: OptionLeg[],
  ): Promise<StrategyExitDecision | null> {
    // Reference parameters to show signature usage
    void ctx;
    void tick;
    void currentPnL;
    void positions;
    // TODO: Add custom profit targets, leg adjustments, or trailing stop loss logic here.
    return null;
  }

  /**
   * Stop Loss threshold calculation.
   * Default: utilizes env.STOP_LOSS_PERCENT (default 1.0%) of entry margin.
   */
  public computeStopLoss(entryMargin: number): number {
    const slPercent = env.STOP_LOSS_PERCENT / 100;
    return entryMargin * slPercent;
  }
}
