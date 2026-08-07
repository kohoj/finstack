/**
 * earnings command — fallback chain.
 *
 * Two independent branches with separate cache keys:
 *   --upcoming  -> Yahoo calendarEvents
 *   (default)   -> Alpha Vantage earnings history
 *
 * Neither has a secondary source, so the chain is four steps: fresh cache ->
 * primary -> stale cache -> FinstackError.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  captureJSON,
  type FetchRecorder,
  mockFetch,
  seedCache,
  useTestHome,
  yahooCrumbRules,
} from '../helpers';

const home = useTestHome('earnings');
let fetchMock: FetchRecorder | undefined;

async function loadEarnings() {
  const mod = await import('../../src/commands/earnings');
  return mod.earnings;
}

function calendarEvents(dateFmt: string) {
  return {
    quoteSummary: {
      result: [
        {
          calendarEvents: {
            earnings: {
              earningsDate: [{ fmt: dateFmt }],
              earningsAverage: { raw: 5.12 },
              revenueAverage: { raw: 32_000_000_000 },
            },
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

describe('--upcoming branch', () => {
  it('serves fresh cache without touching the network', async () => {
    await seedCache('earnings-upcoming-NVDA', {
      ticker: 'NVDA',
      earningsDate: '2026-08-20',
      source: 'yahoo',
    });
    fetchMock = mockFetch([]);

    const earnings = await loadEarnings();
    const out = await captureJSON(() => earnings(['NVDA', '--upcoming']));

    expect(out.earningsDate).toBe('2026-08-20');
    expect(fetchMock.calls).toHaveLength(0);
  });

  it('fetches the calendar from Yahoo on a miss', async () => {
    fetchMock = mockFetch([
      ...yahooCrumbRules,
      { match: '/v10/finance/quoteSummary/', body: calendarEvents('2026-08-20') },
    ]);

    const earnings = await loadEarnings();
    const out = await captureJSON(() => earnings(['NVDA', '--upcoming']));

    expect(out.ticker).toBe('NVDA');
    expect(out.earningsDate).toBe('2026-08-20');
    expect(out.epsEstimate).toBe(5.12);
    expect(out.source).toBe('yahoo');
  });

  it('serves stale cache when Yahoo fails', async () => {
    // earnings TTL is 6 hours; 7 hours old is expired.
    await seedCache(
      'earnings-upcoming-NVDA',
      { ticker: 'NVDA', earningsDate: '2026-05-20' },
      7 * 60 * 60 * 1000,
    );
    fetchMock = mockFetch([
      ...yahooCrumbRules,
      { match: '/v10/finance/quoteSummary/', throws: 'network unreachable' },
    ]);

    const earnings = await loadEarnings();
    const out = await captureJSON(() => earnings(['NVDA', '--upcoming']));

    expect(out._stale).toBe(true);
    expect(out.earningsDate).toBe('2026-05-20');
  });

  it('throws with source when nothing is available', async () => {
    fetchMock = mockFetch([
      ...yahooCrumbRules,
      { match: '/v10/finance/quoteSummary/', throws: 'network unreachable' },
    ]);

    const earnings = await loadEarnings();

    try {
      await captureJSON(() => earnings(['NVDA', '--upcoming']));
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.source).toBe('yahoo');
    }
  });
});

describe('history branch', () => {
  it('serves fresh cache without touching the network', async () => {
    await seedCache('earnings-NVDA', { ticker: 'NVDA', quarters: [{ eps: 5.1 }] });
    fetchMock = mockFetch([]);

    const earnings = await loadEarnings();
    const out = await captureJSON(() => earnings(['NVDA']));

    expect(out.quarters).toHaveLength(1);
    expect(fetchMock.calls).toHaveLength(0);
  });

  it('fetches from Alpha Vantage on a miss', async () => {
    const { setKey } = await import('../../src/data/keys');
    setKey('alphavantage', 'test-key');

    fetchMock = mockFetch([
      {
        match: 'alphavantage.co',
        body: {
          symbol: 'NVDA',
          quarterlyEarnings: [
            {
              fiscalDateEnding: '2026-04-30',
              reportedEPS: '5.16',
              estimatedEPS: '5.12',
              surprisePercentage: '0.78',
            },
          ],
        },
      },
    ]);

    const earnings = await loadEarnings();
    const out = await captureJSON(() => earnings(['NVDA']));

    expect(out.ticker).toBe('NVDA');
    expect(fetchMock.calls.some(u => u.includes('alphavantage.co'))).toBe(true);
  });

  it('serves stale cache when Alpha Vantage fails', async () => {
    await seedCache('earnings-NVDA', { ticker: 'NVDA', quarters: [] }, 7 * 60 * 60 * 1000);
    fetchMock = mockFetch([{ match: 'alphavantage.co', throws: 'network unreachable' }]);

    const earnings = await loadEarnings();
    const out = await captureJSON(() => earnings(['NVDA']));

    expect(out._stale).toBe(true);
  });

  it('suggests configuring a key when the source fails and no cache exists', async () => {
    fetchMock = mockFetch([{ match: 'alphavantage.co', throws: 'network unreachable' }]);

    const earnings = await loadEarnings();

    try {
      await captureJSON(() => earnings(['NVDA']));
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.source).toBe('alphavantage');
      expect(e.suggestion).toContain('keys set alphavantage');
    }
  });
});

describe('cache separation', () => {
  it('does not let the upcoming cache satisfy a history request', async () => {
    await seedCache('earnings-upcoming-NVDA', { ticker: 'NVDA', earningsDate: '2026-08-20' });

    // Only the upcoming key is warm. The history branch must not read it — with
    // no Alpha Vantage key configured, fetchEarnings throws before any request,
    // so reaching the error proves the caches are separate.
    fetchMock = mockFetch([]);

    const earnings = await loadEarnings();

    await expect(captureJSON(() => earnings(['NVDA']))).rejects.toThrow();
  });

  it('does not let the history cache satisfy an upcoming request', async () => {
    await seedCache('earnings-NVDA', { ticker: 'NVDA', quarters: [{ eps: 5.1 }] });

    fetchMock = mockFetch([
      ...yahooCrumbRules,
      { match: '/v10/finance/quoteSummary/', body: calendarEvents('2026-08-20') },
    ]);

    const earnings = await loadEarnings();
    const out = await captureJSON(() => earnings(['NVDA', '--upcoming']));

    // Went to the network rather than reusing the history entry.
    expect(out.earningsDate).toBe('2026-08-20');
    expect(fetchMock.calls.some(u => u.includes('quoteSummary'))).toBe(true);
  });
});
