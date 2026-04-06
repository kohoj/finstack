import { describe, it, expect } from 'bun:test';

describe('calendar', () => {
  it('filters entries within date range', () => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const inRange = new Date(now.getTime() + 5 * 86400000).toISOString().split('T')[0];
    const outRange = new Date(now.getTime() + 60 * 86400000).toISOString().split('T')[0];

    const entries = [
      { ticker: 'NVDA', earningsDate: inRange, earningsDateEnd: null, epsEstimate: null, source: 'yahoo', inPortfolio: true, inWatchlist: false },
      { ticker: 'AMD', earningsDate: outRange, earningsDateEnd: null, epsEstimate: null, source: 'yahoo', inPortfolio: false, inWatchlist: true },
    ];

    const cutoff = new Date(now.getTime() + 30 * 86400000);
    const filtered = entries.filter(e => {
      const d = new Date(e.earningsDate!);
      return d >= now && d <= cutoff;
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].ticker).toBe('NVDA');
  });

  it('sorts by earnings date ascending', () => {
    const now = new Date();
    const d1 = new Date(now.getTime() + 10 * 86400000).toISOString().split('T')[0];
    const d2 = new Date(now.getTime() + 3 * 86400000).toISOString().split('T')[0];

    const entries = [
      { ticker: 'LATE', earningsDate: d1 },
      { ticker: 'SOON', earningsDate: d2 },
    ];

    entries.sort((a, b) => new Date(a.earningsDate).getTime() - new Date(b.earningsDate).getTime());
    expect(entries[0].ticker).toBe('SOON');
  });
});
