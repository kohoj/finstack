import { afterEach, describe, expect, it } from 'bun:test';
import { fetchHistoricalClose } from '../../src/data/yahoo';
import { mockFetch } from '../helpers';

// A minimal chart response: parallel timestamp/close arrays, Yahoo's shape.
function chart(bars: Array<[string, number | null]>) {
  return {
    chart: {
      result: [
        {
          meta: { symbol: 'SPY' },
          timestamp: bars.map(([d]) => Math.floor(new Date(`${d}T00:00:00Z`).getTime() / 1000)),
          indicators: { quote: [{ close: bars.map(([, c]) => c) }] },
        },
      ],
      error: null,
    },
  };
}

describe('fetchHistoricalClose', () => {
  let recorder: { restore: () => void };
  afterEach(() => recorder.restore());

  it('returns the close on the target trading day', async () => {
    recorder = mockFetch([
      {
        match: '/v8/finance/chart/',
        body: chart([
          ['2026-01-14', 470],
          ['2026-01-15', 475],
          ['2026-01-16', 480],
        ]),
      },
    ]);
    expect(await fetchHistoricalClose('SPY', '2026-01-16')).toBe(480);
  });

  it('walks back to the prior trading day when the target is a weekend', async () => {
    // 2026-01-17 is a Saturday: no bar. Last bar in-window is Friday the 16th.
    recorder = mockFetch([
      {
        match: '/v8/finance/chart/',
        body: chart([
          ['2026-01-15', 475],
          ['2026-01-16', 480],
        ]),
      },
    ]);
    expect(await fetchHistoricalClose('SPY', '2026-01-17')).toBe(480);
  });

  it('skips a null close and takes the prior real bar', async () => {
    recorder = mockFetch([
      {
        match: '/v8/finance/chart/',
        body: chart([
          ['2026-01-15', 475],
          ['2026-01-16', null],
        ]),
      },
    ]);
    expect(await fetchHistoricalClose('SPY', '2026-01-16')).toBe(475);
  });

  it('returns null when the window holds no bars', async () => {
    recorder = mockFetch([{ match: '/v8/finance/chart/', body: chart([]) }]);
    expect(await fetchHistoricalClose('SPY', '2026-01-16')).toBeNull();
  });

  it('requests an explicit period1/period2 window, not a range', async () => {
    recorder = mockFetch([
      { match: '/v8/finance/chart/', body: chart([['2026-01-16', 480]]) },
    ]) as any;
    await fetchHistoricalClose('SPY', '2026-01-16');
    const url = (recorder as any).calls[0] as string;
    expect(url).toContain('period1=');
    expect(url).toContain('period2=');
    expect(url).not.toContain('range=');
  });
});
