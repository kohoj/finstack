/**
 * scan command — multi-source signal scan.
 *
 * scan aggregates Yahoo trending tickers and news search. Unlike the
 * single-source commands, partial failure is normal and acceptable: if
 * trending works but news does not, the scan still succeeds.
 *
 * The behaviour that matters is the total-failure case. scan used to cache and
 * return an empty signal list with exit 0, which /sense cannot distinguish
 * from a genuinely quiet market.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { captureJSON, type FetchRecorder, mockFetch, seedCache, useTestHome } from '../helpers';

const home = useTestHome('scan');
let fetchMock: FetchRecorder | undefined;

async function loadScan() {
  const mod = await import('../../src/commands/scan');
  return mod.scan;
}

const trendingBody = {
  finance: {
    result: [{ quotes: [{ symbol: 'NVDA' }, { symbol: 'TSLA' }, { symbol: 'AAPL' }] }],
  },
};

const newsBody = {
  news: [
    {
      title: 'Market rallies on earnings',
      publisher: 'Reuters',
      link: 'https://example.test/a',
      providerPublishTime: 1_767_312_000,
    },
  ],
};

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

describe('fresh cache', () => {
  it('serves from cache without touching the network', async () => {
    await seedCache('scan-all-US', {
      timestamp: '2026-08-06T00:00:00.000Z',
      region: 'US',
      signals: [{ type: 'trending', items: ['NVDA'] }],
    });
    fetchMock = mockFetch([]);

    const scan = await loadScan();
    const out = await captureJSON(() => scan([]));

    expect(out.signals).toHaveLength(1);
    expect(fetchMock.calls).toHaveLength(0);
  });

  it('keys the cache by source and region', async () => {
    await seedCache('scan-all-US', { region: 'US', signals: [{ type: 'trending', items: [] }] });

    // A different region must not read the US entry.
    fetchMock = mockFetch([
      { match: '/v1/finance/trending/', body: trendingBody },
      { match: '/v1/finance/search', body: newsBody },
    ]);

    const scan = await loadScan();
    await captureJSON(() => scan(['--region', 'GB']));

    expect(fetchMock.calls.length).toBeGreaterThan(0);
  });
});

describe('source selection', () => {
  it('queries both sources by default', async () => {
    fetchMock = mockFetch([
      { match: '/v1/finance/trending/', body: trendingBody },
      { match: '/v1/finance/search', body: newsBody },
    ]);

    const scan = await loadScan();
    const out = await captureJSON(() => scan([]));

    expect(out.signals.some((s: any) => s.type === 'trending')).toBe(true);
    expect(out.signals.some((s: any) => s.type === 'news')).toBe(true);
  });

  it('queries only trending when asked', async () => {
    fetchMock = mockFetch([{ match: '/v1/finance/trending/', body: trendingBody }]);

    const scan = await loadScan();
    const out = await captureJSON(() => scan(['--source', 'trending']));

    expect(out.signals.every((s: any) => s.type === 'trending')).toBe(true);
    expect(fetchMock.calls.some(u => u.includes('/v1/finance/search'))).toBe(false);
  });

  it('caps trending at 10 tickers', async () => {
    fetchMock = mockFetch([
      {
        match: '/v1/finance/trending/',
        body: {
          finance: {
            result: [{ quotes: Array.from({ length: 25 }, (_, i) => ({ symbol: `T${i}` })) }],
          },
        },
      },
    ]);

    const scan = await loadScan();
    const out = await captureJSON(() => scan(['--source', 'trending']));

    expect(out.signals[0].items).toHaveLength(10);
  });
});

describe('partial failure', () => {
  it('still succeeds when news fails but trending works', async () => {
    fetchMock = mockFetch([
      { match: '/v1/finance/trending/', body: trendingBody },
      { match: '/v1/finance/search', throws: 'search unavailable' },
    ]);

    const scan = await loadScan();
    const out = await captureJSON(() => scan([]));

    expect(out.signals.some((s: any) => s.type === 'trending')).toBe(true);
  });

  it('reports the trending error inline when news works', async () => {
    fetchMock = mockFetch([
      { match: '/v1/finance/trending/', throws: 'trending unavailable' },
      { match: '/v1/finance/search', body: newsBody },
    ]);

    const scan = await loadScan();
    const out = await captureJSON(() => scan([]));

    const trending = out.signals.find((s: any) => s.type === 'trending');
    expect(trending.error).toBeDefined();
    expect(out.signals.some((s: any) => s.type === 'news')).toBe(true);
  });
});

describe('total failure', () => {
  // Regression: scan previously cached and returned {signals: []} with exit 0
  // when every source failed, which /sense reads as "quiet market".
  it('throws rather than reporting an empty scan as success', async () => {
    fetchMock = mockFetch([
      { match: '/v1/finance/trending/', throws: 'unavailable' },
      { match: '/v1/finance/search', throws: 'unavailable' },
    ]);

    const scan = await loadScan();

    await expect(captureJSON(() => scan([]))).rejects.toThrow();
  });

  it('does not cache a total failure', async () => {
    fetchMock = mockFetch([
      { match: '/v1/finance/trending/', throws: 'unavailable' },
      { match: '/v1/finance/search', throws: 'unavailable' },
    ]);

    const scan = await loadScan();
    await expect(captureJSON(() => scan([]))).rejects.toThrow();
    fetchMock.restore();

    // A cached failure would be served for the next 15 minutes.
    fetchMock = mockFetch([
      { match: '/v1/finance/trending/', body: trendingBody },
      { match: '/v1/finance/search', body: newsBody },
    ]);

    const out = await captureJSON(() => scan([]));
    expect(out.signals.some((s: any) => s.type === 'trending')).toBe(true);
  });

  it('serves stale cache instead of failing when one exists', async () => {
    // scan TTL is 15 minutes; 20 minutes old is expired.
    await seedCache(
      'scan-all-US',
      { region: 'US', signals: [{ type: 'trending', items: ['NVDA'] }] },
      20 * 60 * 1000,
    );

    fetchMock = mockFetch([
      { match: '/v1/finance/trending/', throws: 'unavailable' },
      { match: '/v1/finance/search', throws: 'unavailable' },
    ]);

    const scan = await loadScan();
    const out = await captureJSON(() => scan([]));

    expect(out._stale).toBe(true);
    expect(out.signals).toHaveLength(1);
  });
});

describe('input validation', () => {
  it('rejects an unknown --source instead of scanning nothing', async () => {
    fetchMock = mockFetch([]);
    const scan = await loadScan();

    await expect(captureJSON(() => scan(['--source', 'bogus']))).rejects.toThrow(/source/i);
    expect(fetchMock.calls).toHaveLength(0);
  });
});
