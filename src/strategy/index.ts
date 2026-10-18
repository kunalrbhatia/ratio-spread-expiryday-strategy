import { Strategy } from './Strategy.js';
import { ExampleStrategy } from './ExampleStrategy.js';
import { env } from '../config/env.js';
import { logger } from '../helpers/logger.js';

const strategyRegistry: Record<string, Strategy> = {
  example: new ExampleStrategy(),
};

/**
 * Register a custom strategy dynamically.
 */
export const registerStrategy = (strategy: Strategy): void => {
  strategyRegistry[strategy.name.toLowerCase()] = strategy;
  logger.info(`Strategy '${strategy.name}' registered.`);
};

/**
 * Retrieve the active strategy as specified by STRATEGY env var.
 */
export const getActiveStrategy = (): Strategy => {
  const strategyName = (env.STRATEGY || 'example').toLowerCase();
  const strategy = strategyRegistry[strategyName];
  if (!strategy) {
    logger.warn(
      `Strategy '${strategyName}' not found in registry. Falling back to 'example' strategy.`,
    );
    return strategyRegistry.example;
  }
  return strategy;
};

export * from './Strategy.js';
export * from './ExampleStrategy.js';
