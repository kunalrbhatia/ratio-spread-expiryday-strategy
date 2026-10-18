import { jest } from '@jest/globals';
import {
  Strategy,
  StrategyContext,
  StrategyExitDecision,
  registerStrategy,
  getActiveStrategy,
} from '../../src/strategy/index.js';
import { ExampleStrategy } from '../../src/strategy/ExampleStrategy.js';
import { executeStrategyEntry } from '../../src/jobs/entryJob.js';
import {
  handleIncomingTick,
  calculateCurrentPnL,
  exitAllPositions,
} from '../../src/jobs/monitorJob.js';
import { positionStores, OptionLeg } from '../../src/store/positionStore.js';
import { setPaperMode, setKillSwitch, setPanicSwitch } from '../../src/helpers/modeManager.js';
import { notifierHelper } from '../../src/notifier.js';
import { ordersHelper } from '../../src/helpers/orders.js';

describe('Strategy Plug-in & Lifecycle Verification', () => {
  beforeEach(() => {
    setPaperMode(true);
    setKillSwitch(false);
    setPanicSwitch(false);
    positionStores.NIFTY.clear();
    jest.spyOn(notifierHelper, 'sendAlert').mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    positionStores.NIFTY.clear();
  });

  test('ExampleStrategy loads as default and executes entry in paper mode', async () => {
    const active = getActiveStrategy();
    expect(active.name).toBe('example');
    expect(active.instruments).toContain('NIFTY');

    const success = await executeStrategyEntry('NIFTY');
    expect(success).toBe(true);

    const positions = positionStores.NIFTY.getPositions();
    expect(positions.active).toBe(true);
    expect(positions.legs.length).toBeGreaterThan(0);
    expect(positions.stopLoss).toBeGreaterThan(0);
  });

  test('Custom strategy plugs into entry, tick evaluation, stop loss, and exit', async () => {
    let tickEvaluated = false;

    class TestCustomStrategy implements Strategy {
      public readonly name = 'test-custom';
      public readonly instruments = ['NIFTY'];
      public readonly schedule = {
        entryTime: '09:20',
        exitTime: '15:27',
      };

      public async shouldRunToday(): Promise<boolean> {
        return true;
      }

      public async entry(ctx: StrategyContext): Promise<OptionLeg[]> {
        return [
          {
            symbol: 'NIFTY-CALL-CUSTOM',
            token: 'CUSTOM_TOKEN_99',
            entryPremium: 200,
            qty: 50,
            type: 'CE',
            direction: 'BUY',
            currentPrice: 200,
          },
        ];
      }

      public async onTick(
        ctx: StrategyContext,
        tick: any,
        currentPnL: number,
      ): Promise<StrategyExitDecision | null> {
        tickEvaluated = true;
        if (currentPnL >= 500) {
          return { shouldExit: true, reason: 'Target profit of 500 reached' };
        }
        return null;
      }

      public computeStopLoss(entryMargin: number): number {
        return 1000; // Custom fixed stop loss
      }
    }

    const customStrategy = new TestCustomStrategy();
    registerStrategy(customStrategy);

    // Mock active strategy retrieval by setting env or registering
    const origGetActive = getActiveStrategy;
    // Test custom entry execution
    const legs = await customStrategy.entry({ symbol: 'NIFTY', isPaper: true });
    expect(legs.length).toBe(1);

    const customSL = customStrategy.computeStopLoss(50000);
    expect(customSL).toBe(1000);

    positionStores.NIFTY.setPositions(legs, 50000, customSL);
    const pos = positionStores.NIFTY.getPositions();
    expect(pos.stopLoss).toBe(1000);

    // Test onTick profit target exit trigger
    const decision = await customStrategy.onTick(
      { symbol: 'NIFTY', isPaper: true },
      { token: 'CUSTOM_TOKEN_99', ltp: 215 },
      750, // PnL > 500
      legs,
    );

    expect(tickEvaluated).toBe(true);
    expect(decision).not.toBeNull();
    expect(decision?.shouldExit).toBe(true);
    expect(decision?.reason).toContain('Target profit');
  });

  test('Core SL enforcement closes positions when P&L threshold exceeded', async () => {
    const legs: OptionLeg[] = [
      {
        symbol: 'NIFTY-BUY',
        token: 'TK_SL_TEST',
        entryPremium: 100,
        qty: 100,
        type: 'CE',
        direction: 'BUY',
        currentPrice: 100,
      },
    ];

    // Set position with SL = 500
    positionStores.NIFTY.setPositions(legs, 50000, 500);

    const placeOrderSpy = jest.spyOn(ordersHelper, 'placeOptionOrder').mockResolvedValue('MOCK-EXIT');

    // Simulate tick dropping premium to 90 (loss = (90 - 100) * 100 = -1000 <= -500)
    await handleIncomingTick('NIFTY', { token: 'TK_SL_TEST', ltp: 90 });

    const postState = positionStores.NIFTY.getPositions();
    expect(postState.active).toBe(false);
    expect(postState.legs.length).toBe(0);
    expect(placeOrderSpy).toHaveBeenCalled();
  });
});
