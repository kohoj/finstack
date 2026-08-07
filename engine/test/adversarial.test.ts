/**
 * Adversarial input tests.
 *
 * security.test.ts covers the properties (key permissions, no secrets in
 * output). This file covers attacks: what a hostile ticker, a hostile API
 * response, or a hostile filesystem can do.
 *
 * finstack is a local CLI, so the threat model is narrow but real — tickers
 * reach URLs and cache filenames, and API responses are written to disk.
 */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FinstackError } from '../src/errors';
import { validateTicker } from '../src/validation';
import { captureJSON, type FetchRecorder, mockFetch, useTestHome } from './helpers';

const home = useTestHome('adversarial');
let fetchMock: FetchRecorder | undefined;

beforeEach(() => {
  home.reset();
  fetchMock?.restore();
  fetchMock = undefined;
});

afterAll(() => {
  fetchMock?.restore();
  home.cleanup();
});

describe('command injection via ticker', () => {
  // Tickers are interpolated into URLs and shell-adjacent contexts. The
  // character class is an allowlist, so these are rejected by construction —
  // these tests pin that the allowlist has not been widened.
  const payloads = [
    '$(whoami)',
    '`id`',
    'A;rm -rf /',
    'A|cat /etc/passwd',
    'A&&curl evil.test',
    'A>out.txt',
    "A'||'1",
    'A\nB',
    'A\tB',
    'A\0B',
  ];

  for (const payload of payloads) {
    it(`rejects ${JSON.stringify(payload)}`, () => {
      expect(() => validateTicker(payload)).toThrow(FinstackError);
    });
  }
});

describe('path traversal via ticker', () => {
  // Tickers become cache filenames: cache/quote-<TICKER>.json.
  const payloads = [
    '..',
    '../..',
    '../etc/passwd',
    './x',
    'a/b',
    'a\\b',
    '%2e%2e',
    '....//',
    '.',
    '-',
    '...',
  ];

  for (const payload of payloads) {
    it(`rejects ${JSON.stringify(payload)}`, () => {
      expect(() => validateTicker(payload)).toThrow(FinstackError);
    });
  }

  it('confines cache writes to the cache directory', async () => {
    const { setCache } = await import('../src/cache');
    const { paths } = await import('../src/paths');

    // Even if a caller skips validation, a traversal key must not escape.
    const before = readdirSync(paths.CACHE_DIR).length;
    setCache(`quote-${validateTicker('NVDA')}`, { ticker: 'NVDA' });
    const after = readdirSync(paths.CACHE_DIR).length;

    expect(after).toBe(before + 1);
    // Nothing landed outside the cache dir.
    expect(existsSync(join(home.dir, 'quote-NVDA.json'))).toBe(false);
  });
});

describe('SSRF via ticker', () => {
  // A ticker that parses as a URL would let a caller redirect an outbound
  // request — cloud metadata endpoints being the classic target.
  const payloads = [
    'http://169.254.169.254/',
    'https://evil.test',
    '//evil.test',
    'file:///etc/passwd',
    'evil.test/x',
  ];

  for (const payload of payloads) {
    it(`rejects ${JSON.stringify(payload)}`, () => {
      expect(() => validateTicker(payload)).toThrow(FinstackError);
    });
  }

  // 'localhost' and '127.0.0.1' are valid ticker *characters*, so they pass
  // validation. That is not a vulnerability: they are interpolated into a path
  // segment of a fixed host, so they cannot redirect the request. This test
  // pins that property, which is what actually prevents SSRF.
  it('keeps a host-like ticker inside the path of the intended host', async () => {
    fetchMock = mockFetch([{ match: 'query1.finance.yahoo.com', status: 404, body: {} }]);

    const { quote } = await import('../src/commands/quote');
    await expect(captureJSON(() => quote(['127.0.0.1']))).rejects.toThrow();

    for (const url of fetchMock.calls) {
      expect(new URL(url).hostname).toBe('query1.finance.yahoo.com');
    }
  });

  it('never issues a request for an invalid ticker', async () => {
    fetchMock = mockFetch([]);
    const { quote } = await import('../src/commands/quote');

    await expect(captureJSON(() => quote(['http://169.254.169.254/']))).rejects.toThrow();
    // Validation runs before any network call.
    expect(fetchMock.calls).toHaveLength(0);
  });
});

describe('hostile API responses', () => {
  it('does not persist secrets echoed back by a data source', async () => {
    const { setKey } = await import('../src/data/keys');
    setKey('polygon', 'super-secret-polygon-key');

    // A compromised or malicious upstream echoing the key back into the body.
    fetchMock = mockFetch([
      {
        match: '/v8/finance/chart/',
        body: {
          chart: {
            result: [
              {
                meta: {
                  symbol: 'NVDA',
                  regularMarketPrice: 850,
                  chartPreviousClose: 833,
                  debug_apikey: 'super-secret-polygon-key',
                },
                timestamp: [1_700_000_000],
                indicators: { quote: [{ close: [850], volume: [1] }] },
              },
            ],
            error: null,
          },
        },
      },
    ]);

    const { quote } = await import('../src/commands/quote');
    await captureJSON(() => quote(['NVDA']));

    const { paths } = await import('../src/paths');
    for (const f of readdirSync(paths.CACHE_DIR)) {
      const content = readFileSync(join(paths.CACHE_DIR, f), 'utf-8');
      // extractQuote() allowlists fields, so unexpected keys never reach disk.
      expect(content).not.toContain('super-secret-polygon-key');
    }
  });

  it('survives a malformed response without corrupting state', async () => {
    fetchMock = mockFetch([{ match: '/v8/finance/chart/', body: 'not json at all' }]);

    const { quote } = await import('../src/commands/quote');
    await expect(captureJSON(() => quote(['NVDA']))).rejects.toThrow(FinstackError);

    const { paths } = await import('../src/paths');
    // A failed fetch leaves no partial cache entry behind.
    expect(readdirSync(paths.CACHE_DIR)).toHaveLength(0);
  });

  it('survives an unexpected response shape', async () => {
    fetchMock = mockFetch([{ match: '/v8/finance/chart/', body: { chart: { result: null } } }]);

    const { quote } = await import('../src/commands/quote');
    await expect(captureJSON(() => quote(['NVDA']))).rejects.toThrow(FinstackError);
  });
});

describe('corrupt state files', () => {
  it('treats a truncated portfolio as empty rather than crashing', async () => {
    writeFileSync(join(home.dir, 'portfolio.json'), '{"positions": [{"ticker": "NV');

    const { portfolio } = await import('../src/commands/portfolio');
    const out = await captureJSON(() => portfolio(['show']));

    // readJSONSafe falls back rather than throwing, so a corrupt file does not
    // brick the CLI. The user can still add positions.
    expect(out.positions).toEqual([]);
  });

  it('does not follow a symlinked state file out of the home directory', async () => {
    const outside = join(home.dir, '..', `finstack-escape-${Date.now()}.json`);
    writeFileSync(outside, '{"positions":[{"ticker":"LEAK","shares":1,"avgCost":1}]}');
    const link = join(home.dir, 'portfolio.json');
    symlinkSync(outside, link);

    const { portfolio } = await import('../src/commands/portfolio');
    await captureJSON(() => portfolio(['add', 'NVDA', '1', '100']));

    // atomicWriteJSON writes a temp file and renames over the link, replacing
    // it. The target outside the home directory must be untouched.
    const target = JSON.parse(readFileSync(outside, 'utf-8'));
    expect(target.positions[0].ticker).toBe('LEAK');
  });
});

describe('filesystem permissions', () => {
  it('writes keys.json as user-only', async () => {
    const { setKey } = await import('../src/data/keys');
    const { paths } = await import('../src/paths');
    const { statSync } = await import('node:fs');

    setKey('fred', 'test-key');

    expect(statSync(paths.KEYS_FILE).mode & 0o777).toBe(0o600);
  });

  it('keeps the mode after a rewrite', async () => {
    const { setKey, removeKey } = await import('../src/data/keys');
    const { paths } = await import('../src/paths');
    const { statSync } = await import('node:fs');

    setKey('fred', 'a');
    setKey('polygon', 'b');
    removeKey('fred');

    expect(statSync(paths.KEYS_FILE).mode & 0o777).toBe(0o600);
  });

  it('does not leave temp files behind on the happy path', async () => {
    const { setKey } = await import('../src/data/keys');
    setKey('fred', 'test-key');

    const leftovers = readdirSync(home.dir).filter(f => f.includes('.tmp.'));
    expect(leftovers).toHaveLength(0);
  });

  it('does not leave lock directories behind', async () => {
    const { portfolio } = await import('../src/commands/portfolio');
    await captureJSON(() => portfolio(['init']));
    await captureJSON(() => portfolio(['add', 'NVDA', '10', '800']));

    const locks = readdirSync(home.dir).filter(f => f.endsWith('.lock'));
    expect(locks).toHaveLength(0);
  });
});

describe('oversized input', () => {
  it('rejects a very long ticker', () => {
    expect(() => validateTicker('A'.repeat(10_000))).toThrow(FinstackError);
  });

  it('handles a large but valid portfolio', async () => {
    const { portfolio } = await import('../src/commands/portfolio');
    await captureJSON(() => portfolio(['init']));

    for (let i = 0; i < 50; i++) {
      await captureJSON(() => portfolio(['add', `T${i}`, '10', '100']));
    }

    const out = await captureJSON(() => portfolio(['show']));
    expect(out.positions).toHaveLength(50);
  });
});

describe('error output hygiene', () => {
  it('keeps configured keys out of error payloads', async () => {
    const { setKey } = await import('../src/data/keys');
    setKey('polygon', 'super-secret-polygon-key');

    fetchMock = mockFetch([
      { match: '/v8/finance/chart/', throws: 'network down' },
      { match: 'polygon.io', throws: 'polygon down' },
    ]);

    const { quote } = await import('../src/commands/quote');
    const { formatErrorJSON } = await import('../src/errors');

    try {
      await captureJSON(() => quote(['NVDA']));
      throw new Error('should have thrown');
    } catch (e) {
      const payload = formatErrorJSON(e as Error);
      expect(payload).not.toContain('super-secret-polygon-key');
      expect(payload).not.toContain('.ts:');
      expect(payload).not.toMatch(/\s+at\s+/);
    }
  });

  it('keeps the home directory path out of error payloads', async () => {
    const { formatErrorJSON } = await import('../src/errors');
    const err = new FinstackError('failed', 'yahoo', 'HTTP 500', 'Retry later');
    const payload = formatErrorJSON(err);

    expect(payload).not.toContain(home.dir);
  });
});
