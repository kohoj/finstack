/**
 * Test helpers for command-level tests.
 *
 * Commands are exercised through their exported function, with two things
 * controlled: the filesystem (finstackHome()) and the network (globalThis.fetch).
 *
 * finstackHome() must be set before engine/src/paths.ts is first imported —
 * it resolves the constant at module load. withTestHome() sets the variable and
 * then dynamically imports the command, so every test gets an isolated
 * directory and a cold cache.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface MockResponse {
  /** Matched against the request URL with String.includes. */
  match: string;
  status?: number;
  /** Response body. Objects are JSON-serialized. */
  body?: unknown;
  /** Throw instead of responding — simulates DNS failure or a timeout. */
  throws?: string;
}

export interface FetchRecorder {
  /** URLs requested, in order. */
  calls: string[];
  restore: () => void;
}

/**
 * Replace globalThis.fetch with a matcher-driven stub.
 *
 * Rules are tried in order; the first whose `match` appears in the URL wins.
 * An unmatched URL is a test bug, not a scenario, so it rejects loudly rather
 * than returning a default.
 */
export function mockFetch(rules: MockResponse[]): FetchRecorder {
  const original = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: any, _init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push(url);

    const rule = rules.find(r => url.includes(r.match));
    if (!rule) {
      throw new Error(`mockFetch: no rule matched ${url}`);
    }
    if (rule.throws) {
      throw new Error(rule.throws);
    }

    const status = rule.status ?? 200;
    const body = typeof rule.body === 'string' ? rule.body : JSON.stringify(rule.body ?? {});

    return new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** Capture console.log output while `fn` runs. */
export async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

/** Capture console.log and parse it as JSON — commands emit a single object. */
export async function captureJSON<T = any>(fn: () => Promise<void>): Promise<T> {
  const out = await captureStdout(fn);
  return JSON.parse(out) as T;
}

export interface TestHome {
  dir: string;
  /** Remove everything under the home, leaving an empty cache dir. */
  reset: () => void;
  cleanup: () => void;
}

/**
 * Point the engine at an isolated FINSTACK_HOME.
 *
 * Safe to call per test: paths.ts resolves the directory on every access, so
 * each call fully redirects subsequent reads and writes. Call reset() between
 * tests in the same file to start from a clean directory.
 */
export function useTestHome(label: string): TestHome {
  const dir = join(
    tmpdir(),
    `finstack-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(join(dir, 'cache'), { recursive: true });
  process.env.FINSTACK_HOME = dir;

  // Collapse retry backoff. Retry counts are unchanged, so the code path is
  // identical — this only removes the 1s + 3s of real sleeping that each
  // simulated outage would otherwise cost.
  process.env.FINSTACK_NO_BACKOFF = '1';

  return {
    dir,
    reset: () => {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(join(dir, 'cache'), { recursive: true });
      // Re-assert: a concurrently running test file may have pointed the
      // process elsewhere between our tests.
      process.env.FINSTACK_HOME = dir;
    },
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Write a cache entry directly, with control over its age. */
export async function seedCache(key: string, data: unknown, ageMs = 0): Promise<void> {
  const { atomicWriteJSON } = await import('../src/fs');
  const { paths } = await import('../src/paths');
  atomicWriteJSON(join(paths.CACHE_DIR, `${key}.json`), {
    ...(data as object),
    _cachedAt: Date.now() - ageMs,
    _v: 2,
  });
}

/** Minimal Yahoo /v8/finance/chart response. */
export function yahooChart(ticker: string, price: number) {
  return {
    chart: {
      result: [
        {
          meta: {
            symbol: ticker,
            regularMarketPrice: price,
            chartPreviousClose: price * 0.98,
            currency: 'USD',
            exchangeName: 'NMS',
          },
          timestamp: [1_700_000_000],
          indicators: { quote: [{ close: [price], volume: [1_000_000] }] },
        },
      ],
      error: null,
    },
  };
}

/**
 * Rules satisfying Yahoo's cookie/crumb handshake.
 *
 * /v10/finance/quoteSummary requires a crumb, which costs two extra requests
 * (fc.yahoo.com for cookies, then /v1/test/getcrumb). Spread these into any
 * rule list for a command that reaches quoteSummary.
 */
export const yahooCrumbRules: MockResponse[] = [
  { match: 'fc.yahoo.com', body: '' },
  { match: '/v1/test/getcrumb', body: 'test-crumb-value' },
];

/** Minimal Yahoo quoteSummary response covering the modules finstack reads. */
export function yahooQuoteSummary(
  ticker: string,
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    quoteSummary: {
      result: [
        {
          price: {
            symbol: ticker,
            longName: `${ticker} Inc`,
            regularMarketPrice: { raw: 850 },
            marketCap: { raw: 2_000_000_000_000 },
          },
          financialData: {
            grossMargins: { raw: 0.72 },
            operatingMargins: { raw: 0.54 },
            profitMargins: { raw: 0.48 },
            returnOnEquity: { raw: 0.88 },
            currentRatio: { raw: 4.2 },
            debtToEquity: { raw: 41 },
          },
          defaultKeyStatistics: {
            trailingEps: { raw: 13 },
            forwardPE: { raw: 45 },
            priceToBook: { raw: 40 },
          },
          assetProfile: { sector: 'Technology', industry: 'Semiconductors' },
          ...overrides,
        },
      ],
      error: null,
    },
  };
}
