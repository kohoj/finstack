import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { importPortfolioSnapshot, portfolio } from '../../src/commands/portfolio';
import { assertValidImport, loadPortfolio, valuePortfolio } from '../../src/data/portfolio';
import { FinstackError } from '../../src/errors';
import { captureJSON, useTestHome } from '../helpers';

const home = useTestHome('portfolio-command');

beforeEach(() => home.reset());
afterAll(() => home.cleanup());

describe('portfolio import', () => {
  const openingSnapshot = {
    baseCurrency: 'USD',
    asOf: '2026-08-28T11:36:00Z',
    positions: [
      {
        ticker: 'MSFT',
        shares: 18,
        avgCost: 449.8894,
        currency: 'USD',
        mark: { price: 505.06, asOf: '2026-08-28T11:36:00Z', source: 'ZABANK' },
      },
      {
        ticker: '07709.HK',
        shares: 200,
        avgCost: 42.06,
        currency: 'HKD',
        mark: {
          price: 36.44,
          asOf: '2026-08-28T11:36:00Z',
          source: 'ZABANK',
          fxRateToBase: 0.128,
        },
      },
    ],
  };

  it('imports an opening balance without fabricating trade history', () => {
    const out = importPortfolioSnapshot(openingSnapshot);

    expect(out.positions).toHaveLength(2);
    expect(out.transactions).toEqual([]);
    expect(out.baseCurrency).toBe('USD');
    expect(out.valuation.totalValueBase).toBeCloseTo(9091.08 + 7288 * 0.128, 2);
    expect(out.valuation.fullyMarked).toBe(true);
    expect(loadPortfolio().transactions).toEqual([]);
  });

  it('refuses to overwrite an existing ledger without --replace', async () => {
    await captureJSON(() => portfolio(['init']));
    await captureJSON(() => portfolio(['add', 'AAPL', '10', '200']));

    expect(() => importPortfolioSnapshot(openingSnapshot)).toThrow(FinstackError);
    const out = importPortfolioSnapshot(openingSnapshot, true);
    expect(out.positions).toHaveLength(2);
    expect(out.transactions).toEqual([]);
  });

  it('rejects foreign marks that omit their FX conversion', () => {
    const invalid = structuredClone(openingSnapshot);
    delete (invalid.positions[1].mark as any).fxRateToBase;
    expect(() => assertValidImport(invalid)).toThrow(FinstackError);
  });

  it('rejects an invalid snapshot timestamp instead of silently dropping it', () => {
    const invalid = { ...openingSnapshot, asOf: 'not-a-timestamp' };
    expect(() => assertValidImport(invalid)).toThrow(FinstackError);
  });

  it('persists an explicit scenario factor separately from the price mark', async () => {
    importPortfolioSnapshot(openingSnapshot);
    const out = await captureJSON(() =>
      portfolio(['exposure', '07709.HK', 'XLK', '--notes', 'semiconductor proxy']),
    );
    const holding = out.positions.find((position: any) => position.ticker === '07709.HK');
    expect(holding.scenarioExposure).toEqual({
      factor: 'XLK',
      source: 'user',
      notes: 'semiconductor proxy',
    });
    expect(holding.mark.source).toBe('ZABANK');
  });
});

describe('portfolio valuation', () => {
  it('marks an existing base-currency position and never treats cost as a live price', async () => {
    await captureJSON(() => portfolio(['init']));
    await captureJSON(() => portfolio(['add', 'MSFT', '10', '400']));

    const before = loadPortfolio();
    expect(valuePortfolio(before).fullyMarked).toBe(false);
    expect(valuePortfolio(before).costFallbackTickers).toEqual(['MSFT']);

    const out = await captureJSON(() =>
      portfolio(['mark', 'MSFT', '500', '--as-of', '2026-08-28T11:36:00Z', '--source', 'broker']),
    );
    expect(out.valuation.fullyMarked).toBe(true);
    expect(out.valuation.positions[0].price).toBe(500);
    expect(out.valuation.positions[0].priceSource).toBe('mark');
    expect(out.valuation.totalValueBase).toBe(5000);
  });

  it('requires an FX rate when marking a foreign-currency position', async () => {
    await captureJSON(() => portfolio(['init']));
    await captureJSON(() => portfolio(['add', '07709.HK', '200', '42.06', '--currency', 'HKD']));

    await expect(portfolio(['mark', '07709.HK', '36.44', '--source', 'broker'])).rejects.toThrow(
      FinstackError,
    );
  });
});
