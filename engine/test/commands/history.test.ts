/**
 * history command — fallback chain.
 *
 * Chain: fresh cache -> Yahoo chart -> Polygon (if keyed) -> stale cache
 *        -> FinstackError
 *
 * history also picks its cache TTL by age: ranges ending more than a year ago
 * are immutable and cached for 24h ('history-old'), recent ranges for 1h.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { captureJSON, type FetchRecorder, mockFetch, seedCache, useTestHome } from '../helpers';

const home = useTestHome('history');
let fetchMock: FetchRecorder | undefined;

async function loadHistory() {
  const mod = await import('../../src/commands/history');
  return mod.history;
}

/** Yahoo chart response with a series of daily bars. */
function chartWithBars(ticker: string, dates: string[], closes: number[]) {
  return {
    chart: {
      result: [
        {
          meta: { symbol: ticker, regularMarketPrice: closes[closes.length - 1] },
          timestamp: dates.map(d => Math.floor(new Date(`${d}T00:00:00Z`).getTime() / 1000)),
          indicators: {
            quote: [
              {
                open: closes.map(c => c * 0.99),
                high: closes.map(c => c * 1.01),
                low: closes.map(c => c * 0.98),
                close: closes,
                volume: closes.map(() => 1_000_000),
              },
            ],
          },
        },
      ],
      error: null,
    },
  };
}

beforeEach(() => {
  home.reset();
});

afterEach(() => {
  fetchMock?.restore();
  fetchMock = undefined;
});

afterAll(() => {
  home.cleanup();
});

describe('step 1: fresh cache', () => {
  it('serves from cache without touching the network', async () => {
    await seedCache('history-NVDA-2026-01-01-2026-01-05', {
      ticker: 'NVDA',
      from: '2026-01-01',
      to: '2026-01-05',
      source: 'yahoo',
      bars: [{ date: '2026-01-02', close: 800 }],
    });
    fetchMock = mockFetch([]);

    const history = await loadHistory();
    const out = await captureJSON(() =>
      history(['NVDA', '--from', '2026-01-01', '--to', '2026-01-05']),
    );

    expect(out.bars).toHaveLength(1);
    expect(fetchMock.calls).toHaveLength(0);
  });
});

describe('step 2: primary source', () => {
  it('fetches from Yahoo and filters bars to the requested range', async () => {
    fetchMock = mockFetch([
      {
        match: '/v8/finance/chart/',
        // Deliberately wider than the request: Yahoo returns whole ranges,
        // so the command must trim to the from/to window.
        body: chartWithBars(
          'NVDA',
          ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'],
          [800, 810, 820, 830],
        ),
      },
    ]);

    const history = await loadHistory();
    const out = await captureJSON(() =>
      history(['NVDA', '--from', '2026-01-02', '--to', '2026-01-03']),
    );

    expect(out.source).toBe('yahoo');
    expect(out.bars).toHaveLength(2);
    expect(out.bars[0].date).toBe('2026-01-02');
    expect(out.bars[1].date).toBe('2026-01-03');
  });

  it('caches the response', async () => {
    fetchMock = mockFetch([
      { match: '/v8/finance/chart/', body: chartWithBars('NVDA', ['2026-01-02'], [810]) },
    ]);

    const history = await loadHistory();
    const args = ['NVDA', '--from', '2026-01-01', '--to', '2026-01-05'];
    await captureJSON(() => history(args));
    const afterFirst = fetchMock.calls.length;

    await captureJSON(() => history(args));

    expect(fetchMock.calls.length).toBe(afterFirst);
  });
});

describe('step 3: secondary source', () => {
  it('falls through to Polygon when Yahoo fails and a key exists', async () => {
    const { setKey } = await import('../../src/data/keys');
    setKey('polygon', 'test-key');

    fetchMock = mockFetch([
      { match: '/v8/finance/chart/', throws: 'network unreachable' },
      {
        match: 'polygon.io',
        body: {
          results: [{ t: 1_767_312_000_000, o: 800, h: 820, l: 795, c: 810, v: 1_000_000 }],
        },
      },
    ]);

    const history = await loadHistory();
    const out = await captureJSON(() =>
      history(['NVDA', '--from', '2026-01-01', '--to', '2026-01-05']),
    );

    expect(out.source).toBe('polygon');
    expect(out.bars.length).toBeGreaterThan(0);
  });
});

describe('step 4: stale cache', () => {
  it('serves expired cache when Yahoo fails and Polygon is unconfigured', async () => {
    // The range ends in the past, so this is cached as 'history-old' with a
    // 24h TTL rather than the 1h 'history' TTL. Age it past 24h.
    await seedCache(
      'history-NVDA-2026-01-01-2026-01-05',
      { ticker: 'NVDA', source: 'yahoo', bars: [{ date: '2026-01-02', close: 800 }] },
      25 * 60 * 60 * 1000,
    );

    fetchMock = mockFetch([{ match: '/v8/finance/chart/', throws: 'network unreachable' }]);

    const history = await loadHistory();
    const out = await captureJSON(() =>
      history(['NVDA', '--from', '2026-01-01', '--to', '2026-01-05']),
    );

    expect(out._stale).toBe(true);
    expect(out.bars).toHaveLength(1);
  });

  // Regression: the Polygon branch had no try/catch, unlike quote and
  // financials. A Polygon failure propagated the raw error and skipped the
  // stale-cache fallback entirely — the user got a network error even though
  // usable data was on disk.
  it('serves stale cache when Polygon also fails', async () => {
    const { setKey } = await import('../../src/data/keys');
    setKey('polygon', 'test-key');

    await seedCache(
      'history-NVDA-2026-01-01-2026-01-05',
      { ticker: 'NVDA', source: 'yahoo', bars: [{ date: '2026-01-02', close: 800 }] },
      25 * 60 * 60 * 1000,
    );

    fetchMock = mockFetch([
      { match: '/v8/finance/chart/', throws: 'network unreachable' },
      { match: 'polygon.io', throws: 'polygon down too' },
    ]);

    const history = await loadHistory();
    const out = await captureJSON(() =>
      history(['NVDA', '--from', '2026-01-01', '--to', '2026-01-05']),
    );

    expect(out._stale).toBe(true);
    expect(out.bars).toHaveLength(1);
  });
});

describe('step 5: structured error', () => {
  it('throws with source and suggestion when nothing is available', async () => {
    fetchMock = mockFetch([{ match: '/v8/finance/chart/', throws: 'network unreachable' }]);

    const history = await loadHistory();

    try {
      await captureJSON(() => history(['NVDA', '--from', '2026-01-01', '--to', '2026-01-05']));
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.source).toBe('yahoo');
      expect(e.suggestion).toBeDefined();
    }
  });
});

describe('input validation', () => {
  it('rejects a date that does not exist', async () => {
    fetchMock = mockFetch([]);
    const history = await loadHistory();

    await expect(
      captureJSON(() => history(['NVDA', '--from', '2026-02-31', '--to', '2026-03-05'])),
    ).rejects.toThrow();
    expect(fetchMock.calls).toHaveLength(0);
  });

  it('rejects a reversed range', async () => {
    fetchMock = mockFetch([]);
    const history = await loadHistory();

    await expect(
      captureJSON(() => history(['NVDA', '--from', '2026-06-01', '--to', '2026-01-01'])),
    ).rejects.toThrow();
  });

  it('defaults to the last 90 days when no range is given', async () => {
    fetchMock = mockFetch([
      { match: '/v8/finance/chart/', body: chartWithBars('NVDA', ['2026-01-02'], [810]) },
    ]);

    const history = await loadHistory();
    const out = await captureJSON(() => history(['NVDA']));

    expect(out.from).toBeDefined();
    expect(out.to).toBeDefined();
    expect(out.from < out.to).toBe(true);
  });
});
