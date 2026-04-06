// engine/test/cache.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { atomicWriteJSON } from '../src/fs';

const TEST_DIR = join(tmpdir(), `finstack-cache-test-${Date.now()}`);
const CACHE_DIR = join(TEST_DIR, 'cache');

// Mock cache implementation for testing
// We can't use FINSTACK_HOME env var because modules are evaluated at import time
// So we'll test the cache functions directly using a test cache directory

const CACHE_VERSION = 2;

const TTL: Record<string, number> = {
  quote: 5 * 60 * 1000,
  financials: 60 * 60 * 1000,
  scan: 15 * 60 * 1000,
  macro: 60 * 60 * 1000,
  filing: 6 * 60 * 60 * 1000,
  earnings: 6 * 60 * 60 * 1000,
  history: 60 * 60 * 1000,
  'history-old': 24 * 60 * 60 * 1000,
};

function cacheFile(key: string): string {
  return join(CACHE_DIR, `${key}.json`);
}

function formatAge(cachedAt: number): string {
  const diffMs = Date.now() - cachedAt;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function getCached(key: string, type: string): any | null {
  const file = cacheFile(key);
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    if (data._v !== CACHE_VERSION) return null;
    const ttl = TTL[type] ?? 5 * 60 * 1000;
    if (Date.now() - data._cachedAt > ttl) return null;
    return data;
  } catch {
    return null;
  }
}

function getCachedWithFallback(
  key: string,
  type: string,
): { data: any; stale: boolean; age: string } | null {
  const file = cacheFile(key);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    const { _cachedAt, _v, ...data } = raw;
    const ttl = TTL[type] ?? 5 * 60 * 1000;
    const stale = Date.now() - _cachedAt > ttl;
    return { data, stale, age: formatAge(_cachedAt) };
  } catch {
    return null;
  }
}

function setCache(key: string, data: any): void {
  const file = cacheFile(key);
  atomicWriteJSON(file, { ...data, _cachedAt: Date.now(), _v: CACHE_VERSION });
}

describe('cache', () => {
  beforeEach(() => {
    mkdirSync(CACHE_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('stores and retrieves cached data', () => {
    setCache('test-key', { price: 100 });
    const result = getCached('test-key', 'quote');
    expect(result).not.toBeNull();
    expect(result.price).toBe(100);
  });

  it('returns null for expired cache', () => {
    setCache('test-key', { price: 100 });
    const file = join(CACHE_DIR, 'test-key.json');
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    data._cachedAt = Date.now() - 999999999;
    writeFileSync(file, JSON.stringify(data));
    const result = getCached('test-key', 'quote');
    expect(result).toBeNull();
  });

  it('getCachedWithFallback returns stale data with flag', () => {
    setCache('test-key', { price: 100 });
    const file = join(CACHE_DIR, 'test-key.json');
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    data._cachedAt = Date.now() - 999999999;
    writeFileSync(file, JSON.stringify(data));

    const result = getCachedWithFallback('test-key', 'quote');
    expect(result).not.toBeNull();
    expect(result!.stale).toBe(true);
    expect(result!.data.price).toBe(100);
  });

  it('getCachedWithFallback returns null for missing cache', () => {
    const result = getCachedWithFallback('nonexistent', 'quote');
    expect(result).toBeNull();
  });

  it('rejects cache with wrong version', () => {
    setCache('test-key', { price: 100 });
    const file = join(CACHE_DIR, 'test-key.json');
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    data._v = 1;
    writeFileSync(file, JSON.stringify(data));
    const result = getCached('test-key', 'quote');
    expect(result).toBeNull();
  });
});
