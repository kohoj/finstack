// engine/src/cache.ts
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { CACHE_DIR } from './paths';
import { atomicWriteJSON } from './fs';

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
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function getCached(key: string, type: string): any | null {
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

export function getCachedWithFallback(
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

export function setCache(key: string, data: any): void {
  const file = cacheFile(key);
  atomicWriteJSON(file, { ...data, _cachedAt: Date.now(), _v: CACHE_VERSION });
}
