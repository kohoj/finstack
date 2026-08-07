/**
 * financials command — fallback chain.
 *
 * Chain: fresh cache -> Yahoo quoteSummary -> FMP (if keyed) -> stale cache
 *        -> FinstackError
 *
 * quoteSummary requires Yahoo's cookie/crumb handshake, so these tests also
 * exercise that path — two extra requests before the real one.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  captureJSON,
  type FetchRecorder,
  mockFetch,
  seedCache,
  useTestHome,
  yahooCrumbRules,
  yahooQuoteSummary,
} from '../helpers';

const home = useTestHome('financials');
let fetchMock: FetchRecorder | undefined;

async function loadFinancials() {
  const mod = await import('../../src/commands/financials');
  return mod.financials;
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
    await seedCache('financials-NVDA', { ticker: 'NVDA', marketCap: 2e12, grossMargin: 0.72 });
    fetchMock = mockFetch([]);

    const financials = await loadFinancials();
    const out = await captureJSON(() => financials(['NVDA']));

    expect(out.ticker).toBe('NVDA');
    expect(out.grossMargin).toBe(0.72);
    expect(fetchMock.calls).toHaveLength(0);
  });
});

describe('step 2: primary source', () => {
  it('fetches from Yahoo, completing the crumb handshake first', async () => {
    fetchMock = mockFetch([
      ...yahooCrumbRules,
      { match: '/v10/finance/quoteSummary/', body: yahooQuoteSummary('NVDA') },
    ]);

    const financials = await loadFinancials();
    const out = await captureJSON(() => financials(['NVDA']));

    expect(out.ticker).toBe('NVDA');
    // Handshake happened before the data request.
    expect(fetchMock.calls.some(u => u.includes('getcrumb'))).toBe(true);
    expect(fetchMock.calls.some(u => u.includes('quoteSummary'))).toBe(true);
  });

  it('caches the response', async () => {
    fetchMock = mockFetch([
      ...yahooCrumbRules,
      { match: '/v10/finance/quoteSummary/', body: yahooQuoteSummary('NVDA') },
    ]);

    const financials = await loadFinancials();
    await captureJSON(() => financials(['NVDA']));
    const afterFirst = fetchMock.calls.length;

    await captureJSON(() => financials(['NVDA']));

    expect(fetchMock.calls.length).toBe(afterFirst);
  });
});

describe('step 3: secondary source', () => {
  it('does not try FMP when no key is configured', async () => {
    fetchMock = mockFetch([
      ...yahooCrumbRules,
      { match: '/v10/finance/quoteSummary/', throws: 'network unreachable' },
    ]);

    const financials = await loadFinancials();

    await expect(captureJSON(() => financials(['NVDA']))).rejects.toThrow();
    expect(fetchMock.calls.some(u => u.includes('financialmodelingprep'))).toBe(false);
  });

  it('falls through to FMP when Yahoo fails and a key exists', async () => {
    const { setKey } = await import('../../src/data/keys');
    setKey('fmp', 'test-key');

    fetchMock = mockFetch([
      ...yahooCrumbRules,
      { match: '/v10/finance/quoteSummary/', throws: 'network unreachable' },
      {
        match: '/api/v3/profile/',
        body: [
          {
            symbol: 'NVDA',
            companyName: 'NVIDIA Corp',
            sector: 'Technology',
            industry: 'Semiconductors',
            mktCap: 2e12,
            price: 850,
          },
        ],
      },
      {
        match: '/api/v3/ratios-ttm/',
        body: [{ peRatioTTM: 65, grossProfitMarginTTM: 0.72 }],
      },
    ]);

    const financials = await loadFinancials();
    const out = await captureJSON(() => financials(['NVDA']));

    expect(out.ticker).toBe('NVDA');
    expect(out.name).toBe('NVIDIA Corp');
  });
});

describe('step 4: stale cache', () => {
  it('serves expired cache when every source fails', async () => {
    // financials TTL is 1 hour; 2 hours old is expired.
    await seedCache('financials-NVDA', { ticker: 'NVDA', marketCap: 1.9e12 }, 2 * 60 * 60 * 1000);

    fetchMock = mockFetch([
      ...yahooCrumbRules,
      { match: '/v10/finance/quoteSummary/', throws: 'network unreachable' },
    ]);

    const financials = await loadFinancials();
    const out = await captureJSON(() => financials(['NVDA']));

    expect(out.marketCap).toBe(1.9e12);
    expect(out._stale).toBe(true);
  });
});

describe('step 5: structured error', () => {
  it('throws with source and an actionable suggestion', async () => {
    fetchMock = mockFetch([
      ...yahooCrumbRules,
      { match: '/v10/finance/quoteSummary/', throws: 'network unreachable' },
    ]);

    const financials = await loadFinancials();

    try {
      await captureJSON(() => financials(['NVDA']));
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.source).toBe('yahoo');
      expect(e.suggestion).toContain('fmp');
    }
  });
});

describe('input validation', () => {
  it('rejects a bad ticker before making any request', async () => {
    fetchMock = mockFetch([]);
    const financials = await loadFinancials();

    await expect(captureJSON(() => financials(['..']))).rejects.toThrow();
    expect(fetchMock.calls).toHaveLength(0);
  });
});
