/**
 * filing command — SEC EDGAR.
 *
 * Chain: fresh cache -> EDGAR -> FinstackError. There is no secondary source
 * and, deliberately, no stale-cache step: filings are legal documents, and
 * serving an outdated list silently is worse than saying EDGAR is unreachable.
 *
 * EDGAR needs two requests: company_tickers.json to resolve the CIK, then the
 * submissions endpoint.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { captureJSON, type FetchRecorder, mockFetch, seedCache, useTestHome } from '../helpers';

const home = useTestHome('filing');
let fetchMock: FetchRecorder | undefined;

async function loadFiling() {
  const mod = await import('../../src/commands/filing');
  return mod.filing;
}

const tickerMap = {
  '0': { cik_str: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' },
  '1': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
};

const submissions = {
  cik: '1045810',
  name: 'NVIDIA CORP',
  filings: {
    recent: {
      accessionNumber: ['0001045810-26-000001', '0001045810-26-000002'],
      form: ['10-K', '8-K'],
      filingDate: ['2026-02-21', '2026-05-22'],
      primaryDocument: ['nvda-20260128.htm', 'nvda-8k.htm'],
      primaryDocDescription: ['10-K', '8-K'],
    },
  },
};

beforeEach(async () => {
  home.reset();
  // The CIK map is a process-wide cache in edgar.ts. Without clearing it, one
  // test's fetch satisfies the next test's lookup, so the network path under
  // test never runs.
  const { resetTickerMapCache } = await import('../../src/data/edgar');
  resetTickerMapCache();
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
    await seedCache('filing-NVDA', {
      ticker: 'NVDA',
      cik: '1045810',
      company: 'NVIDIA CORP',
      filings: [{ type: '10-K', date: '2026-02-21', url: 'https://x', description: '10-K' }],
    });
    fetchMock = mockFetch([]);

    const filing = await loadFiling();
    const out = await captureJSON(() => filing(['NVDA']));

    expect(out.filings).toHaveLength(1);
    expect(fetchMock.calls).toHaveLength(0);
  });
});

describe('step 2: EDGAR', () => {
  it('resolves the CIK, then fetches submissions', async () => {
    fetchMock = mockFetch([
      { match: 'company_tickers.json', body: tickerMap },
      { match: 'data.sec.gov/submissions/', body: submissions },
    ]);

    const filing = await loadFiling();
    const out = await captureJSON(() => filing(['NVDA']));

    expect(out.ticker).toBe('NVDA');
    expect(out.company).toBe('NVIDIA CORP');
    expect(out.filings).toHaveLength(2);
    // CIK is zero-padded to 10 digits in the submissions URL.
    expect(fetchMock.calls.some(u => u.includes('CIK0001045810'))).toBe(true);
  });

  it('keeps only 10-K, 10-Q, and 8-K forms', async () => {
    fetchMock = mockFetch([
      { match: 'company_tickers.json', body: tickerMap },
      {
        match: 'data.sec.gov/submissions/',
        body: {
          ...submissions,
          filings: {
            recent: {
              accessionNumber: ['a1', 'a2', 'a3'],
              form: ['10-K', 'S-1', '4'],
              filingDate: ['2026-02-21', '2026-03-01', '2026-03-02'],
              primaryDocument: ['d1.htm', 'd2.htm', 'd3.htm'],
              primaryDocDescription: ['10-K', 'S-1', 'Form 4'],
            },
          },
        },
      },
    ]);

    const filing = await loadFiling();
    const out = await captureJSON(() => filing(['NVDA']));

    expect(out.filings).toHaveLength(1);
    expect(out.filings[0].type).toBe('10-K');
  });

  it('caches the response', async () => {
    fetchMock = mockFetch([
      { match: 'company_tickers.json', body: tickerMap },
      { match: 'data.sec.gov/submissions/', body: submissions },
    ]);

    const filing = await loadFiling();
    await captureJSON(() => filing(['NVDA']));
    const afterFirst = fetchMock.calls.length;

    await captureJSON(() => filing(['NVDA']));

    expect(fetchMock.calls.length).toBe(afterFirst);
  });
});

describe('step 3: structured error', () => {
  // EDGAR blocks some regions outright, so the 403 message has to say that
  // rather than just reporting an HTTP status.
  it('explains a 403 as a possible regional block', async () => {
    fetchMock = mockFetch([{ match: 'company_tickers.json', status: 403, body: 'Forbidden' }]);

    const filing = await loadFiling();

    try {
      await captureJSON(() => filing(['NVDA']));
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.source).toBe('edgar');
      expect(e.reason).toContain('region');
      expect(e.suggestion).toContain('WebSearch');
    }
  });

  it('reports an unknown ticker rather than returning an empty list', async () => {
    fetchMock = mockFetch([{ match: 'company_tickers.json', body: tickerMap }]);

    const filing = await loadFiling();

    await expect(captureJSON(() => filing(['ZZZZ']))).rejects.toThrow(/not found/i);
  });
});

describe('input validation', () => {
  it('rejects a bad ticker before making any request', async () => {
    fetchMock = mockFetch([]);
    const filing = await loadFiling();

    await expect(captureJSON(() => filing(['../secrets']))).rejects.toThrow();
    expect(fetchMock.calls).toHaveLength(0);
  });
});
