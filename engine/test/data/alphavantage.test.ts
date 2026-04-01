import { describe, it, expect } from 'bun:test';
import { parseEarnings } from '../../src/data/alphavantage';

describe('alphavantage', () => {
  it('parseEarnings extracts quarterly data', () => {
    const raw = {
      symbol: 'AAPL',
      quarterlyEarnings: [
        {
          fiscalDateEnding: '2024-09-30',
          reportedDate: '2024-10-31',
          reportedEPS: '1.64',
          estimatedEPS: '1.60',
          surprise: '0.04',
          surprisePercentage: '2.50',
        },
        {
          fiscalDateEnding: '2024-06-30',
          reportedDate: '2024-08-01',
          reportedEPS: '1.40',
          estimatedEPS: '1.35',
          surprise: '0.05',
          surprisePercentage: '3.70',
        },
      ],
    };
    const result = parseEarnings('AAPL', raw);
    expect(result.ticker).toBe('AAPL');
    expect(result.quarterly.length).toBe(2);
    expect(result.quarterly[0].reportedEPS).toBe(1.64);
    expect(result.quarterly[0].estimatedEPS).toBe(1.60);
    expect(result.quarterly[0].surprisePct).toBe(2.50);
    expect(result.quarterly[0].date).toBe('2024-10-31');
    expect(result.quarterly[0].fiscalEnd).toBe('2024-09-30');
  });

  it('parseEarnings limits to 8 quarters', () => {
    const raw = {
      symbol: 'AAPL',
      quarterlyEarnings: Array.from({ length: 20 }, (_, i) => ({
        fiscalDateEnding: `2024-0${(i % 4) + 1}-30`,
        reportedDate: `2024-0${(i % 4) + 2}-15`,
        reportedEPS: '1.00',
        estimatedEPS: '0.95',
        surprise: '0.05',
        surprisePercentage: '5.26',
      })),
    };
    const result = parseEarnings('AAPL', raw);
    expect(result.quarterly.length).toBe(8);
  });
});
