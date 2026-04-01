import { describe, it, expect } from 'bun:test';
import { calculatePositionAlpha, calculateAggregate, categorizeDeviation } from '../../src/commands/alpha';

describe('alpha calculation', () => {
  it('calculates behavioral cost for a single position', () => {
    const result = calculatePositionAlpha(
      { ticker: 'NVDA', buyPrice: 850, sellPrice: 910, shares: 8 },
      { ticker: 'NVDA', buyPrice: 852, sellPrice: 985, shares: 8 },
    );
    expect(result.ticker).toBe('NVDA');
    expect(result.realPL).toBe((910 - 850) * 8);
    expect(result.shadowPL).toBe((985 - 852) * 8);
    expect(result.behavioralCost).toBe(result.realPL - result.shadowPL);
  });

  it('calculates aggregate alpha', () => {
    const positions = [
      { realPL: 480, shadowPL: 1064, behavioralCost: -584 },
      { realPL: -200, shadowPL: -350, behavioralCost: 150 },
    ];
    const spyReturn = 0.082;
    const portfolioValue = 200000;

    const result = calculateAggregate(positions, spyReturn, portfolioValue);
    expect(result.benchmark.returnDollars).toBe(16400);
    expect(result.real.returnDollars).toBe(280);
    expect(result.shadow.returnDollars).toBe(714);
    expect(result.executionDrag.dollars).toBe(280 - 714);
  });

  it('categorizes behavioral costs by pattern', () => {
    expect(categorizeDeviation('emotional')).toBe('early-profit-taking');
    expect(categorizeDeviation('stop-triggered')).toBe('stop-loss-avoidance');
    expect(categorizeDeviation('thesis-changed')).toBe('thesis-changed');
    expect(categorizeDeviation('need-cash')).toBe('need-cash');
    expect(categorizeDeviation('unspecified')).toBe('unspecified');
    expect(categorizeDeviation(null)).toBe('unspecified');
  });
});
