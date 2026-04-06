import { describe, it, expect } from 'bun:test';
import { estimateImpact, SCENARIOS } from '../../src/commands/scenario';

describe('estimateImpact', () => {
  const positions = [
    { ticker: 'NVDA', shares: 100, avgCost: 850 },
    { ticker: 'JPM', shares: 50, avgCost: 200 },
    { ticker: 'XOM', shares: 200, avgCost: 110 },
  ];

  it('calculates total portfolio impact', () => {
    const result = estimateImpact(positions, SCENARIOS['spy-20pct']);
    expect(result.totalImpact).toBeLessThan(0);
    expect(result.totalImpactPct).toBeLessThan(0);
    expect(result.portfolioValue).toBe(85000 + 10000 + 22000); // 117000
  });

  it('uses sector ETF factors when available', () => {
    const result = estimateImpact(positions, SCENARIOS['rates+100bp']);
    // NVDA → XLK → -0.10, JPM → XLF → 0.03, XOM → XLE (not in rates scenario → SPY fallback)
    const nvda = result.positions.find(p => p.ticker === 'NVDA');
    const jpm = result.positions.find(p => p.ticker === 'JPM');
    expect(nvda!.sectorETF).toBe('XLK');
    expect(jpm!.sectorETF).toBe('XLF');
    expect(nvda!.estimatedReturn).toBe(-0.10);
    expect(jpm!.estimatedReturn).toBe(0.03);
  });

  it('sorts positions worst-first', () => {
    const result = estimateImpact(positions, SCENARIOS['spy-20pct']);
    // All negative, largest position hit worst
    expect(result.positions[0].impactDollars).toBeLessThanOrEqual(result.positions[1].impactDollars);
  });

  it('handles empty portfolio', () => {
    const result = estimateImpact([], SCENARIOS['recession']);
    expect(result.totalImpact).toBe(0);
    expect(result.positions).toEqual([]);
  });

  it('handles custom scenario', () => {
    const custom = { name: 'custom', description: 'test', factors: { NVDA: 0.5 } };
    const result = estimateImpact(positions, custom);
    const nvda = result.positions.find(p => p.ticker === 'NVDA');
    expect(nvda!.estimatedReturn).toBe(0.5);
    expect(nvda!.impactDollars).toBe(42500); // 85000 * 0.5
  });

  it('has 6 preset scenarios', () => {
    expect(Object.keys(SCENARIOS)).toHaveLength(6);
  });
});
