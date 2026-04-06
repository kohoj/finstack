import { describe, it, expect } from 'bun:test';
import { pearsonCorrelation, dailyReturns, computeCorrelationMatrix } from '../../src/commands/correlate';

describe('pearsonCorrelation', () => {
  it('returns 1 for perfectly correlated series', () => {
    const r = pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
    expect(r).toBe(1.0);
  });

  it('returns -1 for perfectly inversely correlated', () => {
    const r = pearsonCorrelation([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]);
    expect(r).toBe(-1.0);
  });

  it('returns ~0 for uncorrelated series', () => {
    const r = pearsonCorrelation([1, 2, 3, 4, 5], [5, 1, 4, 2, 3]);
    expect(Math.abs(r)).toBeLessThan(0.5);
  });

  it('returns 0 for insufficient data', () => {
    expect(pearsonCorrelation([1], [2])).toBe(0);
    expect(pearsonCorrelation([1, 2], [3, 4])).toBe(0);
  });

  it('handles different length arrays', () => {
    const r = pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6]);
    // Should use min length (3)
    expect(typeof r).toBe('number');
  });
});

describe('dailyReturns', () => {
  it('computes percentage changes', () => {
    const returns = dailyReturns([100, 105, 103]);
    expect(returns).toHaveLength(2);
    expect(returns[0]).toBeCloseTo(0.05, 4);
    expect(returns[1]).toBeCloseTo(-0.019, 2);
  });

  it('returns empty for single price', () => {
    expect(dailyReturns([100])).toEqual([]);
  });

  it('returns empty for no prices', () => {
    expect(dailyReturns([])).toEqual([]);
  });
});

describe('computeCorrelationMatrix', () => {
  it('diagonal is always 1.0', () => {
    const returns = new Map([
      ['A', [0.01, -0.02, 0.03]],
      ['B', [0.02, -0.01, 0.04]],
    ]);
    const { matrix } = computeCorrelationMatrix(['A', 'B'], returns);
    expect(matrix[0][0]).toBe(1.0);
    expect(matrix[1][1]).toBe(1.0);
  });

  it('matrix is symmetric', () => {
    const returns = new Map([
      ['A', [0.01, -0.02, 0.03, 0.01, -0.01]],
      ['B', [0.02, -0.01, 0.04, 0.02, -0.02]],
    ]);
    const { matrix } = computeCorrelationMatrix(['A', 'B'], returns);
    expect(matrix[0][1]).toBe(matrix[1][0]);
  });

  it('warns on high correlation', () => {
    const returns = new Map([
      ['A', [0.01, 0.02, 0.03, 0.04, 0.05]],
      ['B', [0.02, 0.04, 0.06, 0.08, 0.10]],
    ]);
    const { warnings } = computeCorrelationMatrix(['A', 'B'], returns);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('highly correlated');
  });
});
