// engine/test/security.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getKey, listKeys, setKey } from '../src/data/keys';
import { parseCustomUniverse } from '../src/data/universe';
import { addToWatchlist } from '../src/data/watchlist';
import { FinstackError, formatErrorJSON } from '../src/errors';
import { atomicWriteJSON, readJSONSafe } from '../src/fs';
import { redactUrl } from '../src/net';

const TEST_DIR = join(tmpdir(), `finstack-security-test-${Date.now()}`);

describe('API key security', () => {
  beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('keys.json has 0600 permissions', () => {
    const file = join(TEST_DIR, 'keys.json');
    setKey('fred', 'test-api-key-abc123', file);
    const stat = statSync(file);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('key values are masked in listKeys output', () => {
    const file = join(TEST_DIR, 'keys.json');
    setKey('fred', 'super-secret-key-12345', file);
    const list = listKeys(file);
    expect(list[0].masked).toBe('sup***');
    expect(list[0].masked).not.toContain('secret');
    expect(list[0].masked).not.toContain('12345');
  });

  it('error messages do not contain API keys', () => {
    const file = join(TEST_DIR, 'keys.json');
    setKey('fred', 'my-secret-api-key', file);
    const key = getKey('fred', file);

    const err = new FinstackError('API call failed', 'fred', 'HTTP 403', 'Check your key');
    const json = formatErrorJSON(err);
    expect(json).not.toContain('my-secret-api-key');
    expect(json).not.toContain(key!);
  });

  it('cache files do not contain API keys', () => {
    const cacheFile = join(TEST_DIR, 'cache-test.json');
    // Simulate what a cache write looks like
    const data = { ticker: 'NVDA', price: 850, source: 'yahoo' };
    atomicWriteJSON(cacheFile, { ...data, _cachedAt: Date.now(), _v: 2 });
    const content = readFileSync(cacheFile, 'utf-8');
    // API keys should never appear in cache
    expect(content).not.toContain('apikey');
    expect(content).not.toContain('api_key');
  });
});

describe('URL redaction in error messages', () => {
  it('redacts api_key / apikey / token query params', () => {
    expect(
      redactUrl('https://api.stlouisfed.org/fred/series?series_id=GDP&api_key=SECRET123'),
    ).toBe('https://api.stlouisfed.org/fred/series?series_id=GDP&api_key=REDACTED');
    expect(redactUrl('https://www.alphavantage.co/query?function=EARNINGS&apikey=KEY999')).toBe(
      'https://www.alphavantage.co/query?function=EARNINGS&apikey=REDACTED',
    );
    expect(redactUrl('https://api.polygon.io/v2/aggs?apiKey=abc&sort=asc')).not.toContain('abc');
    expect(redactUrl('https://x.test/y?token=zzz')).not.toContain('zzz');
  });

  it('preserves non-secret query params', () => {
    const out = redactUrl('https://api.stlouisfed.org/fred/series?series_id=GDP&api_key=SECRET');
    expect(out).toContain('series_id=GDP');
  });

  it('falls back to bare path on unparseable input', () => {
    expect(redactUrl('not a url?api_key=SECRET')).not.toContain('SECRET');
  });
});

describe('path traversal prevention', () => {
  beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('watchlist rejects tickers with path characters', () => {
    const file = join(TEST_DIR, 'watchlist.json');
    expect(() => addToWatchlist('../etc/passwd', 'hack', file)).toThrow();
    expect(() => addToWatchlist('../../root', 'hack', file)).toThrow();
    expect(() => addToWatchlist('A/B', 'hack', file)).toThrow();
  });

  it('watchlist rejects empty ticker', () => {
    const file = join(TEST_DIR, 'watchlist.json');
    expect(() => addToWatchlist('', 'empty', file)).toThrow();
  });

  it('watchlist rejects overly long ticker', () => {
    const file = join(TEST_DIR, 'watchlist.json');
    expect(() => addToWatchlist('ABCDEFGHIJKLMNOP', 'too long', file)).toThrow();
  });

  it('watchlist accepts valid tickers', () => {
    const file = join(TEST_DIR, 'watchlist.json');
    // These should not throw
    addToWatchlist('NVDA', 'ok', file);
    addToWatchlist('BRK.B', 'ok with dot', file);
    addToWatchlist('BF-B', 'ok with dash', file); // Some tickers have dashes
  });

  it('parseCustomUniverse rejects traversal entries', () => {
    // universe entries become cache filenames (join(CACHE_DIR, `${key}.json`)),
    // so an unvalidated 'X/../../../SECRET' would read an arbitrary JSON file.
    expect(() => parseCustomUniverse('X/../../../SECRET')).toThrow();
    expect(() => parseCustomUniverse('AAPL,../../etc/passwd')).toThrow();
    expect(() => parseCustomUniverse('..')).toThrow();
  });

  it('parseCustomUniverse accepts and uppercases valid tickers', () => {
    expect(parseCustomUniverse('aapl, msft ,BRK.B')).toEqual(['AAPL', 'MSFT', 'BRK.B']);
  });
});

describe('input validation', () => {
  it('ticker validation only allows A-Z, 0-9, dot, dash', () => {
    const file = join(TEST_DIR, 'watchlist.json');
    mkdirSync(TEST_DIR, { recursive: true });

    // Invalid characters
    expect(() => addToWatchlist('NV DA', 'space', file)).toThrow();
    expect(() => addToWatchlist('NV;DA', 'semicolon', file)).toThrow();
    expect(() => addToWatchlist('NV$DA', 'dollar', file)).toThrow();
    expect(() => addToWatchlist('<script>', 'xss', file)).toThrow();

    rmSync(TEST_DIR, { recursive: true, force: true });
  });
});

describe('atomic write safety', () => {
  beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('does not leave tmp files on success', () => {
    const file = join(TEST_DIR, 'test.json');
    atomicWriteJSON(file, { data: 'test' });
    const files = require('node:fs').readdirSync(TEST_DIR);
    const tmpFiles = files.filter((f: string) => f.includes('.tmp.'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('readJSONSafe returns fallback for corrupted file', () => {
    const file = join(TEST_DIR, 'corrupt.json');
    writeFileSync(file, '{"broken json');
    const result = readJSONSafe(file, { fallback: true });
    expect(result).toEqual({ fallback: true });
  });

  it('readJSONSafe returns fallback for missing file', () => {
    const result = readJSONSafe(join(TEST_DIR, 'nonexistent.json'), []);
    expect(result).toEqual([]);
  });

  it('atomic write creates parent dirs', () => {
    const file = join(TEST_DIR, 'deep', 'nested', 'file.json');
    atomicWriteJSON(file, { nested: true });
    expect(existsSync(file)).toBe(true);
  });
});

describe('FinstackError sanitization', () => {
  it('formatErrorJSON does not include stack trace', () => {
    const err = new FinstackError('test error');
    const json = formatErrorJSON(err);
    expect(json).not.toContain('at ');
    expect(json).not.toContain('.ts:');
    expect(json).not.toContain('node_modules');
  });

  it('formatErrorJSON handles undefined fields gracefully', () => {
    const err = new FinstackError('minimal');
    const json = formatErrorJSON(err);
    const parsed = JSON.parse(json);
    expect(parsed.error).toBe('minimal');
    expect(parsed.source).toBeUndefined();
    expect(parsed.reason).toBeUndefined();
  });
});
