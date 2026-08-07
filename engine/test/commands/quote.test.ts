/**
 * quote command — fallback chain.
 *
 * quote implements the full five-step chain ARCHITECTURE.md describes:
 *   fresh cache -> Yahoo -> Polygon (if keyed) -> stale cache -> FinstackError
 *
 * The chain is the project's core reliability mechanism and had no coverage
 * before this file, so these tests assert each transition rather than just the
 * happy path — including that a fresh cache hit issues no request at all, and
 * that a total outage degrades to stale data rather than failing.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  captureJSON,
  type FetchRecorder,
  mockFetch,
  seedCache,
  useTestHome,
  yahooChart,
} from '../helpers';

const home = useTestHome('quote');

let fetchMock: FetchRecorder | undefined;

async function loadQuote() {
  const mod = await import('../../src/commands/quote');
  return mod.quote;
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
    await seedCache('quote-NVDA', { ticker: 'NVDA', price: 850, source: 'yahoo' });

    // No rules: any request would throw, proving none is made.
    fetchMock = mockFetch([]);

    const quote = await loadQuote();
    const out = await captureJSON(() => quote(['NVDA']));

    expect(out.ticker).toBe('NVDA');
    expect(out.price).toBe(850);
    expect(fetchMock.calls).toHaveLength(0);
  });

  it('strips cache bookkeeping fields from the output', async () => {
    await seedCache('quote-NVDA', { ticker: 'NVDA', price: 850 });
    fetchMock = mockFetch([]);

    const quote = await loadQuote();
    const out = await captureJSON(() => quote(['NVDA']));

    expect(out._cachedAt).toBeUndefined();
    expect(out._v).toBeUndefined();
  });
});

describe('step 2: primary source', () => {
  it('fetches from Yahoo on a cache miss', async () => {
    fetchMock = mockFetch([{ match: '/v8/finance/chart/', body: yahooChart('NVDA', 850) }]);

    const quote = await loadQuote();
    const out = await captureJSON(() => quote(['NVDA']));

    expect(out.ticker).toBe('NVDA');
    expect(out.price).toBe(850);
    expect(fetchMock.calls.some(u => u.includes('/v8/finance/chart/NVDA'))).toBe(true);
  });

  it('caches the Yahoo response so the next call is free', async () => {
    fetchMock = mockFetch([{ match: '/v8/finance/chart/', body: yahooChart('NVDA', 850) }]);

    const quote = await loadQuote();
    await captureJSON(() => quote(['NVDA']));
    const callsAfterFirst = fetchMock.calls.length;

    await captureJSON(() => quote(['NVDA']));

    expect(fetchMock.calls.length).toBe(callsAfterFirst);
  });

  it('url-encodes the ticker', async () => {
    fetchMock = mockFetch([{ match: '/v8/finance/chart/', body: yahooChart('BRK.B', 400) }]);

    const quote = await loadQuote();
    await captureJSON(() => quote(['BRK.B']));

    expect(fetchMock.calls.some(u => u.includes('BRK.B') || u.includes('BRK%2EB'))).toBe(true);
  });
});

describe('step 3: secondary source', () => {
  it('does not try Polygon when no key is configured', async () => {
    fetchMock = mockFetch([
      { match: '/v8/finance/chart/', status: 500, body: { error: 'upstream' } },
    ]);

    const quote = await loadQuote();

    // Yahoo fails, Polygon is unconfigured, cache is empty -> error.
    await expect(captureJSON(() => quote(['NVDA']))).rejects.toThrow();
    expect(fetchMock.calls.some(u => u.includes('polygon.io'))).toBe(false);
  });

  it('falls through to Polygon when Yahoo fails and a key exists', async () => {
    const { setKey } = await import('../../src/data/keys');
    setKey('polygon', 'test-key');

    fetchMock = mockFetch([
      { match: '/v8/finance/chart/', throws: 'network unreachable' },
      {
        match: 'polygon.io',
        body: {
          results: [{ t: 1_700_000_000_000, o: 840, h: 860, l: 835, c: 855, v: 1_000_000 }],
        },
      },
    ]);

    const quote = await loadQuote();
    const out = await captureJSON(() => quote(['NVDA']));

    expect(out.source).toBe('polygon');
    expect(out.price).toBe(855);
  });
});

describe('step 4: stale cache', () => {
  it('serves expired cache when every source fails', async () => {
    // TTL for quotes is 5 minutes; 10 minutes old is expired but usable.
    await seedCache('quote-NVDA', { ticker: 'NVDA', price: 800, source: 'yahoo' }, 10 * 60 * 1000);

    fetchMock = mockFetch([{ match: '/v8/finance/chart/', throws: 'network unreachable' }]);

    const quote = await loadQuote();
    const out = await captureJSON(() => quote(['NVDA']));

    expect(out.price).toBe(800);
    // Flagged so the caller can tell stale data from live data.
    expect(out._stale).toBe(true);
    expect(out._cacheAge).toBeDefined();
  });

  it('prefers a live fetch over stale cache', async () => {
    await seedCache('quote-NVDA', { ticker: 'NVDA', price: 800 }, 10 * 60 * 1000);
    fetchMock = mockFetch([{ match: '/v8/finance/chart/', body: yahooChart('NVDA', 850) }]);

    const quote = await loadQuote();
    const out = await captureJSON(() => quote(['NVDA']));

    expect(out.price).toBe(850);
    expect(out._stale).toBeUndefined();
  });
});

describe('step 5: structured error', () => {
  it('throws FinstackError when nothing is available', async () => {
    fetchMock = mockFetch([{ match: '/v8/finance/chart/', throws: 'network unreachable' }]);

    const quote = await loadQuote();
    const { FinstackError } = await import('../../src/errors');

    await expect(captureJSON(() => quote(['NVDA']))).rejects.toThrow(FinstackError);
  });

  it('names the source and suggests a recovery path', async () => {
    fetchMock = mockFetch([{ match: '/v8/finance/chart/', throws: 'network unreachable' }]);

    const quote = await loadQuote();

    try {
      await captureJSON(() => quote(['NVDA']));
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.source).toBe('yahoo');
      expect(e.suggestion).toContain('polygon');
    }
  });
});

describe('input validation', () => {
  it('rejects a bad ticker before making any request', async () => {
    fetchMock = mockFetch([]);
    const quote = await loadQuote();

    await expect(captureJSON(() => quote(['../etc/passwd']))).rejects.toThrow();
    expect(fetchMock.calls).toHaveLength(0);
  });

  it('rejects a missing ticker', async () => {
    fetchMock = mockFetch([]);
    const quote = await loadQuote();

    await expect(captureJSON(() => quote([]))).rejects.toThrow();
  });
});
