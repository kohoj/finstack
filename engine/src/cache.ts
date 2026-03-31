import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CACHE_DIR = join(homedir(), '.finstack', 'cache');

const TTL: Record<string, number> = {
  quote: 5 * 60 * 1000,
  financials: 60 * 60 * 1000,
  scan: 15 * 60 * 1000,
};

export function getCached(key: string, type: string): any | null {
  const file = join(CACHE_DIR, `${key}.json`);
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    const ttl = TTL[type] ?? 5 * 60 * 1000;
    if (Date.now() - data._cachedAt > ttl) return null;
    return data;
  } catch {
    return null;
  }
}

export function setCache(key: string, data: any): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, `${key}.json`);
  writeFileSync(file, JSON.stringify({ ...data, _cachedAt: Date.now() }, null, 2));
}
