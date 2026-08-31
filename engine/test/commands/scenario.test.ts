import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { importPortfolioSnapshot } from '../../src/commands/portfolio';
import { estimateImpact, SCENARIOS, scenario } from '../../src/commands/scenario';
import { captureJSON, useTestHome } from '../helpers';

describe('estimateImpact', () => {
  const positions = [
    { ticker: 'NVDA', shares: 100, avgCost: 850 },
    { ticker: 'JPM', shares: 50, avgCost: 200 },
    { ticker: 'XOM', shares: 200, avgCost: 110 },
  ];

  it('calculates total portfolio impact', () => {
    const result = estimateImpact(positions, SCENARIOS['spy-20pct']);
    expect(result.totalImpact).toBeLessThan(0);
    expect(result.totalImpactPct).not.toBeNull();
    expect(result.totalImpactPct!).toBeLessThan(0);
    expect(result.portfolioValue).toBe(85000 + 10000 + 22000); // 117000
  });

  it('labels the documented factor rather than silently falling back to SPY', () => {
    const result = estimateImpact(positions, SCENARIOS['rates+100bp']);
    // NVDA → XLK → -0.10, JPM → XLF → 0.03, XOM → XLE → -0.02.
    const nvda = result.positions.find(p => p.ticker === 'NVDA');
    const jpm = result.positions.find(p => p.ticker === 'JPM');
    const xom = result.positions.find(p => p.ticker === 'XOM');
    expect(nvda!.scenarioFactor).toBe('XLK');
    expect(jpm!.scenarioFactor).toBe('XLF');
    expect(xom!.scenarioFactor).toBe('XLE');
    expect(nvda!.estimatedReturn).toBe(-0.1);
    expect(jpm!.estimatedReturn).toBe(0.03);
    expect(xom!.estimatedReturn).toBe(-0.02);
  });

  it('sorts positions worst-first', () => {
    const result = estimateImpact(positions, SCENARIOS['spy-20pct']);
    // All negative, largest position hit worst
    expect(result.positions[0].impactDollars!).toBeLessThanOrEqual(
      result.positions[1].impactDollars!,
    );
  });

  it('handles empty portfolio', () => {
    const result = estimateImpact([], SCENARIOS.recession);
    expect(result.totalImpact).toBe(0);
    expect(result.totalImpactPct).toBeNull();
    expect(result.positions).toEqual([]);
  });

  it('handles custom scenario', () => {
    const custom = { name: 'custom', description: 'test', factors: { NVDA: 0.5 } };
    const result = estimateImpact(positions, custom);
    const nvda = result.positions.find(p => p.ticker === 'NVDA');
    expect(nvda!.estimatedReturn).toBe(0.5);
    expect(nvda!.impactDollars).toBe(42500); // 85000 * 0.5
    expect(result.unmodeledTickers).toEqual(['JPM', 'XOM']);
    expect(result.coveragePct).toBeCloseTo((85000 / 117000) * 100, 2);
  });

  it('leaves unknown holdings unmodeled instead of assigning a hidden market beta', () => {
    const result = estimateImpact(
      [{ ticker: '07709.HK', shares: 200, avgCost: 36.44 }],
      SCENARIOS.recession,
    );
    expect(result.coveragePct).toBe(0);
    expect(result.totalImpactPct).toBeNull();
    expect(result.unmodeledTickers).toEqual(['07709.HK']);
    expect(result.positions[0]).toMatchObject({
      modeled: false,
      factorSource: 'unmodeled',
      impactDollars: null,
    });
  });

  it('uses an explicit investor proxy for otherwise unmodeled holdings', () => {
    const result = estimateImpact(
      [
        {
          ticker: '07709.HK',
          shares: 200,
          avgCost: 36.44,
          scenarioExposure: { factor: 'XLK', source: 'user' },
        },
      ],
      SCENARIOS.recession,
    );
    expect(result.coveragePct).toBe(100);
    expect(result.positions[0]).toMatchObject({
      modeled: true,
      scenarioFactor: 'XLK',
      factorSource: 'user',
      estimatedReturn: -0.2,
    });
  });

  it('has 6 preset scenarios', () => {
    expect(Object.keys(SCENARIOS)).toHaveLength(6);
  });
});

const scenarioHome = useTestHome('scenario-marked-portfolio');

describe('scenario command', () => {
  beforeEach(() => scenarioHome.reset());
  afterAll(() => scenarioHome.cleanup());

  it('models the current marked base-currency value, not cost basis', async () => {
    importPortfolioSnapshot({
      baseCurrency: 'USD',
      positions: [
        {
          ticker: 'MSFT',
          shares: 10,
          avgCost: 100,
          currency: 'USD',
          mark: { price: 500, asOf: '2026-08-28T00:00:00Z', source: 'broker' },
        },
      ],
    });
    const out = await captureJSON(() => scenario(['spy-20pct']));

    expect(out.baseCurrency).toBe('USD');
    expect(out.portfolioValue).toBe(5000);
    expect(out.totalImpact).toBe(-1000);
    expect(out.valuation.fullyMarked).toBe(true);
  });
});
