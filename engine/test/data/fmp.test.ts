// engine/test/data/fmp.test.ts
import { describe, it, expect } from 'bun:test';
import { parseFMPFinancials } from '../../src/data/fmp';

describe('parseFMPFinancials', () => {
  it('parses FMP profile + ratios into finstack format', () => {
    const profile = [{
      symbol: 'NVDA',
      companyName: 'NVIDIA Corp',
      sector: 'Technology',
      industry: 'Semiconductors',
      mktCap: 2800000000000,
      price: 850,
    }];
    const ratios = [{
      peRatioTTM: 65.2,
      priceToBookRatioTTM: 40.1,
      grossProfitMarginTTM: 0.72,
      operatingProfitMarginTTM: 0.54,
      netProfitMarginTTM: 0.48,
      returnOnEquityTTM: 0.88,
      dividendYieldTTM: 0.001,
      debtEquityRatioTTM: 0.41,
      currentRatioTTM: 4.2,
    }];

    const result = parseFMPFinancials('NVDA', profile, ratios);
    expect(result).not.toBeNull();
    expect(result!.ticker).toBe('NVDA');
    expect(result!.name).toBe('NVIDIA Corp');
    expect(result!.sector).toBe('Technology');
    expect(result!.marketCap).toBe(2800000000000);
    expect(result!.trailingPE).toBe(65.2);
    expect(result!.grossMargin).toBe(0.72);
  });

  it('returns null for empty data', () => {
    const result = parseFMPFinancials('NVDA', [], []);
    expect(result).toBeNull();
  });
});
