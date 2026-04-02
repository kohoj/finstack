import { describe, it, expect } from 'bun:test';
import { calculateConcentration, calculatePositionSize, evaluateRiskGate } from '../../src/commands/risk';

describe('risk', () => {
  it('detects single-position concentration', () => {
    const result = calculateConcentration([
      { ticker: 'NVDA', weight: 30 },
      { ticker: 'AAPL', weight: 20 },
      { ticker: 'GOOGL', weight: 15 },
      { ticker: 'MSFT', weight: 10 },
      { ticker: 'AMZN', weight: 25 },
    ]);
    expect(result.top1.ticker).toBe('NVDA');
    expect(result.top1.weight).toBe(30);
    expect(result.warnings.length).toBe(2); // single > 25% + top3 > 60%
  });

  it('passes clean portfolio', () => {
    const result = calculateConcentration([
      { ticker: 'NVDA', weight: 20 },
      { ticker: 'AAPL', weight: 20 },
      { ticker: 'GOOGL', weight: 20 },
      { ticker: 'MSFT', weight: 20 },
      { ticker: 'AMZN', weight: 20 },
    ]);
    expect(result.warnings.length).toBe(0);
  });

  it('sizes position by risk budget', () => {
    // $200k portfolio, 2% risk = $4,000 max loss
    // Entry $100, stop $90 = $10 risk per share
    // Max shares = 400
    const result = calculatePositionSize(200000, 2, 100, 90);
    expect(result.shares).toBe(400);
    expect(result.riskDollars).toBe(4000);
    expect(result.positionDollars).toBe(40000);
  });

  it('sizes zero when stop equals entry', () => {
    const result = calculatePositionSize(200000, 2, 100, 100);
    expect(result.shares).toBe(0);
  });

  it('risk gate blocks over-concentrated position', () => {
    const existing = [
      { ticker: 'AAPL', weight: 20 },
      { ticker: 'GOOGL', weight: 20 },
    ];
    const gate = evaluateRiskGate('NVDA', 30, existing, 2, 0);
    expect(gate.pass).toBe(false);
    expect(gate.blocks.length).toBeGreaterThan(0);
    expect(gate.blocks[0]).toContain('NVDA');
  });

  it('risk gate passes balanced position', () => {
    const existing = [
      { ticker: 'AAPL', weight: 15 },
      { ticker: 'GOOGL', weight: 15 },
    ];
    const gate = evaluateRiskGate('NVDA', 10, existing, 2, 0);
    expect(gate.pass).toBe(true);
    expect(gate.blocks.length).toBe(0);
  });

  it('risk gate triggers drawdown circuit breaker', () => {
    const gate = evaluateRiskGate('NVDA', 10, [], 2, 18);
    expect(gate.pass).toBe(false);
    expect(gate.blocks[0]).toContain('circuit breaker');
  });

  it('risk gate warns near drawdown threshold', () => {
    const gate = evaluateRiskGate('NVDA', 10, [], 2, 12);
    expect(gate.pass).toBe(true);
    expect(gate.warnings.length).toBe(1);
    expect(gate.warnings[0]).toContain('approaching');
  });
});
