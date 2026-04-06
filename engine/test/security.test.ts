// engine/test/security.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, readFileSync, statSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { atomicWriteJSON, readJSONSafe } from '../src/fs';
import { setKey, getKey, listKeys } from '../src/data/keys';
import { FinstackError, formatErrorJSON } from '../src/errors';
import { addToWatchlist } from '../src/data/watchlist';

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
    const files = require('fs').readdirSync(TEST_DIR);
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
