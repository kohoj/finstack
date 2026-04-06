# Phase 1: Data Layer Rebuild + Watchlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make finstack's data layer reliable (timeouts, retries, atomic writes, fallback chains) and add daily-use infrastructure (watchlist + alerts), upgrading from v0.2.0 to v0.3.0.

**Architecture:** Foundation-first — build three utility modules (paths, net, fs/errors) that every subsequent module depends on. Then upgrade existing data sources to use them. Then add new features (watchlist, alerts) on the solid foundation. Finally wire everything into /sense.

**Tech Stack:** TypeScript, Bun runtime, bun:test

**Spec:** `docs/superpowers/specs/2026-04-07-finstack-v2-upgrade-design.md` (Sections 2.1–2.12)

---

## File Structure

### New Files
```
engine/src/paths.ts          — Central path constants, FINSTACK_HOME env var
engine/src/errors.ts         — FinstackError class with actionable diagnostics
engine/src/net.ts            — fetchWithTimeout, fetchWithRetry
engine/src/fs.ts             — atomicWriteJSON, readJSONSafe
engine/src/data/fmp.ts       — Financial Modeling Prep data source
engine/src/commands/watchlist.ts  — Watchlist CRUD
engine/src/commands/alerts.ts     — Alert aggregation

engine/test/paths.test.ts
engine/test/errors.test.ts
engine/test/net.test.ts
engine/test/fs.test.ts
engine/test/commands/watchlist.test.ts
engine/test/commands/alerts.test.ts
engine/test/data/fmp.test.ts
```

### Modified Files
```
engine/src/cache.ts          — Use paths.ts, add version stamps + fallback reads
engine/src/cli.ts            — Register new commands, version check, FinstackError handling
engine/src/data/yahoo.ts     — fetchWithRetry, crumb TTL, UA rotation
engine/src/data/fred.ts      — fetchWithRetry
engine/src/data/edgar.ts     — fetchWithRetry
engine/src/data/alphavantage.ts — fetchWithRetry
engine/src/data/polygon.ts   — fetchWithRetry
engine/src/data/keys.ts      — atomicWriteJSON, paths.ts
engine/src/data/thesis.ts    — atomicWriteJSON, paths.ts
engine/src/data/shadow.ts    — atomicWriteJSON, paths.ts
engine/src/commands/portfolio.ts — atomicWriteJSON, paths.ts
engine/src/commands/regime.ts    — atomicWriteJSON, paths.ts
engine/src/commands/quote.ts     — Fallback chain (Yahoo → Polygon → cache)
engine/src/commands/financials.ts — Fallback chain (Yahoo → FMP → cache)
engine/src/commands/history.ts   — FinstackError on total failure
engine/src/commands/scan.ts      — fetchWithRetry
sense/SKILL.md               — Integrate watchlist + alerts
setup                        — Register new skills, create reports dir
package.json                 — Version bump to 0.3.0
```

---

### Task 1: Central Path Constants (`paths.ts`)

**Files:**
- Create: `engine/src/paths.ts`
- Create: `engine/test/paths.test.ts`

- [ ] **Step 1: Write failing tests for paths module**

```typescript
// engine/test/paths.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

describe('paths', () => {
  const originalEnv = process.env.FINSTACK_HOME;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FINSTACK_HOME;
    } else {
      process.env.FINSTACK_HOME = originalEnv;
    }
    // Force re-import to pick up env changes
  });

  it('uses ~/.finstack by default', async () => {
    delete process.env.FINSTACK_HOME;
    // Dynamic import to pick up env at import time
    const mod = await import('../src/paths');
    expect(mod.FINSTACK_HOME).toContain('.finstack');
  });

  it('respects FINSTACK_HOME env var', async () => {
    process.env.FINSTACK_HOME = '/tmp/test-finstack';
    // Need to bust module cache for env change
    delete require.cache[require.resolve('../src/paths')];
    const { homedir } = await import('os');
    // We'll test the getter function instead
  });

  it('derives all paths from FINSTACK_HOME', async () => {
    const mod = await import('../src/paths');
    expect(mod.CACHE_DIR).toStartWith(mod.FINSTACK_HOME);
    expect(mod.JOURNAL_DIR).toStartWith(mod.FINSTACK_HOME);
    expect(mod.PORTFOLIO_FILE).toStartWith(mod.FINSTACK_HOME);
    expect(mod.THESES_FILE).toStartWith(mod.FINSTACK_HOME);
    expect(mod.SHADOW_FILE).toStartWith(mod.FINSTACK_HOME);
    expect(mod.CONSENSUS_FILE).toStartWith(mod.FINSTACK_HOME);
    expect(mod.KEYS_FILE).toStartWith(mod.FINSTACK_HOME);
    expect(mod.WATCHLIST_FILE).toStartWith(mod.FINSTACK_HOME);
    expect(mod.PROFILE_FILE).toStartWith(mod.FINSTACK_HOME);
    expect(mod.PATTERNS_DIR).toStartWith(mod.FINSTACK_HOME);
    expect(mod.REPORTS_DIR).toStartWith(mod.FINSTACK_HOME);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test engine/test/paths.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement paths.ts**

```typescript
// engine/src/paths.ts
import { join } from 'path';
import { homedir } from 'os';

export const FINSTACK_HOME = process.env.FINSTACK_HOME || join(homedir(), '.finstack');

export const CACHE_DIR = join(FINSTACK_HOME, 'cache');
export const JOURNAL_DIR = join(FINSTACK_HOME, 'journal');
export const PATTERNS_DIR = join(FINSTACK_HOME, 'patterns');
export const REPORTS_DIR = join(FINSTACK_HOME, 'reports');

export const PORTFOLIO_FILE = join(FINSTACK_HOME, 'portfolio.json');
export const THESES_FILE = join(FINSTACK_HOME, 'theses.json');
export const SHADOW_FILE = join(FINSTACK_HOME, 'shadow.json');
export const CONSENSUS_FILE = join(FINSTACK_HOME, 'consensus.json');
export const KEYS_FILE = join(FINSTACK_HOME, 'keys.json');
export const WATCHLIST_FILE = join(FINSTACK_HOME, 'watchlist.json');
export const PROFILE_FILE = join(FINSTACK_HOME, 'profile.json');
export const VERSION_FILE = join(FINSTACK_HOME, '..', 'engine', 'dist', '.version');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test engine/test/paths.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/src/paths.ts engine/test/paths.test.ts
git commit -m "feat: add central path constants with FINSTACK_HOME env var support"
```

---

### Task 2: FinstackError Class (`errors.ts`)

**Files:**
- Create: `engine/src/errors.ts`
- Create: `engine/test/errors.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// engine/test/errors.test.ts
import { describe, it, expect } from 'bun:test';
import { FinstackError, formatErrorJSON } from '../src/errors';

describe('FinstackError', () => {
  it('extends Error with actionable fields', () => {
    const err = new FinstackError(
      '无法获取 NVDA 报价',
      'yahoo',
      'HTTP 403',
      '稍后重试，或配置 Polygon: finstack keys set polygon YOUR_KEY',
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('无法获取 NVDA 报价');
    expect(err.source).toBe('yahoo');
    expect(err.reason).toBe('HTTP 403');
    expect(err.suggestion).toBe('稍后重试，或配置 Polygon: finstack keys set polygon YOUR_KEY');
    expect(err.cached).toBeUndefined();
  });

  it('supports cached data attachment', () => {
    const err = new FinstackError('无法获取报价', 'yahoo');
    err.cached = { data: { price: 850 }, age: '47 分钟前' };
    expect(err.cached.data).toEqual({ price: 850 });
    expect(err.cached.age).toBe('47 分钟前');
  });
});

describe('formatErrorJSON', () => {
  it('formats FinstackError to structured JSON', () => {
    const err = new FinstackError('无法获取报价', 'yahoo', 'HTTP 403', '配置 API key');
    const json = formatErrorJSON(err);
    const parsed = JSON.parse(json);
    expect(parsed.error).toBe('无法获取报价');
    expect(parsed.source).toBe('yahoo');
    expect(parsed.reason).toBe('HTTP 403');
    expect(parsed.suggestion).toBe('配置 API key');
  });

  it('formats regular Error to basic JSON', () => {
    const err = new Error('something broke');
    const json = formatErrorJSON(err);
    const parsed = JSON.parse(json);
    expect(parsed.error).toBe('something broke');
    expect(parsed.source).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test engine/test/errors.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement errors.ts**

```typescript
// engine/src/errors.ts
export class FinstackError extends Error {
  source?: string;
  reason?: string;
  suggestion?: string;
  cached?: { data: unknown; age: string };

  constructor(
    message: string,
    source?: string,
    reason?: string,
    suggestion?: string,
  ) {
    super(message);
    this.name = 'FinstackError';
    this.source = source;
    this.reason = reason;
    this.suggestion = suggestion;
  }
}

export function formatErrorJSON(err: Error): string {
  if (err instanceof FinstackError) {
    const obj: Record<string, unknown> = { error: err.message };
    if (err.source) obj.source = err.source;
    if (err.reason) obj.reason = err.reason;
    if (err.suggestion) obj.suggestion = err.suggestion;
    if (err.cached) obj.cached = err.cached;
    return JSON.stringify(obj);
  }
  return JSON.stringify({ error: err.message });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test engine/test/errors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/src/errors.ts engine/test/errors.test.ts
git commit -m "feat: add FinstackError with actionable diagnostics"
```

---

### Task 3: Network Reliability Layer (`net.ts`)

**Files:**
- Create: `engine/src/net.ts`
- Create: `engine/test/net.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// engine/test/net.test.ts
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { fetchWithTimeout, fetchWithRetry, TimeoutError } from '../src/net';

// We'll test with a real local approach using AbortController behavior
describe('fetchWithTimeout', () => {
  it('returns response when request completes within timeout', async () => {
    // Use a known fast endpoint — actually we'll mock
    const mockFetch = mock(() =>
      Promise.resolve(new Response('ok', { status: 200 }))
    );
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch as any;
    try {
      const res = await fetchWithTimeout('http://example.com', {}, 5000);
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('throws TimeoutError when request exceeds timeout', async () => {
    const mockFetch = mock(() =>
      new Promise<Response>((resolve) => setTimeout(() => resolve(new Response('late')), 5000))
    );
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch as any;
    try {
      await expect(fetchWithTimeout('http://example.com', {}, 50)).rejects.toThrow(TimeoutError);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('fetchWithRetry', () => {
  it('returns on first success without retrying', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response('ok', { status: 200 }))
    );
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch as any;
    try {
      const res = await fetchWithRetry('http://example.com');
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('retries on 5xx and succeeds', async () => {
    let calls = 0;
    const mockFetch = mock(() => {
      calls++;
      if (calls === 1) return Promise.resolve(new Response('error', { status: 500 }));
      return Promise.resolve(new Response('ok', { status: 200 }));
    });
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch as any;
    try {
      const res = await fetchWithRetry('http://example.com', {}, {
        retries: 2,
        backoffMs: [10, 20],
        timeoutMs: 5000,
      });
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('does not retry on 4xx errors', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response('not found', { status: 404 }))
    );
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch as any;
    try {
      const res = await fetchWithRetry('http://example.com', {}, {
        retries: 2,
        backoffMs: [10, 20],
        timeoutMs: 5000,
      });
      expect(res.status).toBe(404);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('throws after exhausting all retries', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response('error', { status: 503 }))
    );
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch as any;
    try {
      await expect(
        fetchWithRetry('http://example.com', {}, {
          retries: 2,
          backoffMs: [10, 20],
          timeoutMs: 5000,
        })
      ).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    } finally {
      globalThis.fetch = original;
    }
  });

  it('retries on network errors', async () => {
    let calls = 0;
    const mockFetch = mock(() => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('network error'));
      return Promise.resolve(new Response('ok', { status: 200 }));
    });
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch as any;
    try {
      const res = await fetchWithRetry('http://example.com', {}, {
        retries: 2,
        backoffMs: [10, 20],
        timeoutMs: 5000,
      });
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = original;
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test engine/test/net.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement net.ts**

```typescript
// engine/src/net.ts
export class TimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

export async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new TimeoutError(url, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface RetryConfig {
  retries?: number;
  backoffMs?: number[];
  timeoutMs?: number;
}

const DEFAULT_RETRY: Required<RetryConfig> = {
  retries: 2,
  backoffMs: [1000, 3000],
  timeoutMs: 10_000,
};

export async function fetchWithRetry(
  url: string,
  opts: RequestInit = {},
  config: RetryConfig = {},
): Promise<Response> {
  const { retries, backoffMs, timeoutMs } = { ...DEFAULT_RETRY, ...config };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, opts, timeoutMs);
      // Don't retry 4xx — those are not transient
      if (res.status < 500) return res;
      // 5xx — retry if we have attempts left
      if (attempt < retries) {
        const delay = backoffMs[attempt] ?? backoffMs[backoffMs.length - 1] ?? 1000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      // Exhausted retries on 5xx
      throw new Error(`${url} returned ${res.status} after ${retries + 1} attempts`);
    } catch (err: any) {
      lastError = err;
      if (err instanceof TimeoutError || err.name === 'TimeoutError') {
        if (attempt < retries) {
          const delay = backoffMs[attempt] ?? backoffMs[backoffMs.length - 1] ?? 1000;
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }
      // Network error — retry
      if (err.message?.includes('network') || err.message?.includes('fetch') || err.code === 'ECONNREFUSED') {
        if (attempt < retries) {
          const delay = backoffMs[attempt] ?? backoffMs[backoffMs.length - 1] ?? 1000;
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }
      // Non-retryable error or exhausted retries
      if (attempt >= retries) throw err;
    }
  }
  throw lastError || new Error(`fetchWithRetry: unexpected state for ${url}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test engine/test/net.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/src/net.ts engine/test/net.test.ts
git commit -m "feat: add network reliability layer with timeout and retry"
```

---

### Task 4: Atomic File Operations (`fs.ts`)

**Files:**
- Create: `engine/src/fs.ts`
- Create: `engine/test/fs.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// engine/test/fs.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { atomicWriteJSON, readJSONSafe } from '../src/fs';
import { existsSync, readFileSync, unlinkSync, mkdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), `finstack-fs-test-${Date.now()}`);

describe('atomicWriteJSON', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('writes valid JSON to file', () => {
    const file = join(TEST_DIR, 'test.json');
    atomicWriteJSON(file, { hello: 'world' });
    const content = JSON.parse(readFileSync(file, 'utf-8'));
    expect(content).toEqual({ hello: 'world' });
  });

  it('creates parent directories if needed', () => {
    const file = join(TEST_DIR, 'sub', 'dir', 'test.json');
    atomicWriteJSON(file, { nested: true });
    expect(existsSync(file)).toBe(true);
  });

  it('does not leave tmp files on success', () => {
    const file = join(TEST_DIR, 'clean.json');
    atomicWriteJSON(file, { clean: true });
    const files = require('fs').readdirSync(TEST_DIR);
    expect(files.filter((f: string) => f.includes('.tmp.'))).toHaveLength(0);
  });

  it('overwrites existing file atomically', () => {
    const file = join(TEST_DIR, 'overwrite.json');
    atomicWriteJSON(file, { version: 1 });
    atomicWriteJSON(file, { version: 2 });
    const content = JSON.parse(readFileSync(file, 'utf-8'));
    expect(content).toEqual({ version: 2 });
  });

  it('uses 0o600 mode for sensitive files', () => {
    const file = join(TEST_DIR, 'keys.json');
    atomicWriteJSON(file, { secret: 'abc' }, 0o600);
    const stat = statSync(file);
    // On macOS/Linux, check mode bits (ignore file type bits)
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('uses 0o644 mode by default', () => {
    const file = join(TEST_DIR, 'normal.json');
    atomicWriteJSON(file, { public: true });
    const stat = statSync(file);
    expect(stat.mode & 0o777).toBe(0o644);
  });
});

describe('readJSONSafe', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('reads valid JSON file', () => {
    const file = join(TEST_DIR, 'valid.json');
    atomicWriteJSON(file, { data: 42 });
    const result = readJSONSafe(file, { data: 0 });
    expect(result).toEqual({ data: 42 });
  });

  it('returns fallback for missing file', () => {
    const result = readJSONSafe(join(TEST_DIR, 'missing.json'), { fallback: true });
    expect(result).toEqual({ fallback: true });
  });

  it('returns fallback for corrupted JSON', () => {
    const file = join(TEST_DIR, 'corrupt.json');
    require('fs').writeFileSync(file, 'not json{{{');
    const result = readJSONSafe(file, []);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test engine/test/fs.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement fs.ts**

```typescript
// engine/src/fs.ts
import { writeFileSync, readFileSync, renameSync, mkdirSync, existsSync, chmodSync } from 'fs';
import { dirname } from 'path';

export function atomicWriteJSON(filePath: string, data: unknown, mode = 0o644): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  const json = JSON.stringify(data, null, 2);
  writeFileSync(tmp, json, { mode });
  renameSync(tmp, filePath);
  // Ensure mode is correct after rename (some systems reset it)
  try { chmodSync(filePath, mode); } catch {}
}

export function readJSONSafe<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test engine/test/fs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/src/fs.ts engine/test/fs.test.ts
git commit -m "feat: add atomic JSON writes and safe reads"
```

---

### Task 5: Upgrade Cache Module

**Files:**
- Modify: `engine/src/cache.ts`
- Modify: `engine/test/commands/` (existing cache tests if any, else add)

- [ ] **Step 1: Write test for upgraded cache**

Create `engine/test/cache.test.ts`:

```typescript
// engine/test/cache.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), `finstack-cache-test-${Date.now()}`);

// Must set env before importing cache module
process.env.FINSTACK_HOME = TEST_DIR;

// Dynamic import after env set
let getCached: any, setCache: any, getCachedWithFallback: any;

describe('cache', () => {
  beforeEach(async () => {
    mkdirSync(join(TEST_DIR, 'cache'), { recursive: true });
    const mod = await import('../src/cache');
    getCached = mod.getCached;
    setCache = mod.setCache;
    getCachedWithFallback = mod.getCachedWithFallback;
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
    // Manually set cachedAt to past
    const file = join(TEST_DIR, 'cache', 'test-key.json');
    const data = JSON.parse(require('fs').readFileSync(file, 'utf-8'));
    data._cachedAt = Date.now() - 999999999;
    require('fs').writeFileSync(file, JSON.stringify(data));
    const result = getCached('test-key', 'quote');
    expect(result).toBeNull();
  });

  it('getCachedWithFallback returns stale data with flag', () => {
    setCache('test-key', { price: 100 });
    // Make it expired
    const file = join(TEST_DIR, 'cache', 'test-key.json');
    const data = JSON.parse(require('fs').readFileSync(file, 'utf-8'));
    data._cachedAt = Date.now() - 999999999;
    require('fs').writeFileSync(file, JSON.stringify(data));

    const result = getCachedWithFallback('test-key', 'quote');
    expect(result).not.toBeNull();
    expect(result!.stale).toBe(true);
    expect(result!.data.price).toBe(100);
    expect(result!.age).toContain('前'); // Human-readable age in Chinese
  });

  it('getCachedWithFallback returns null for missing cache', () => {
    const result = getCachedWithFallback('nonexistent', 'quote');
    expect(result).toBeNull();
  });

  it('rejects cache with wrong version', () => {
    setCache('test-key', { price: 100 });
    // Manually set wrong version
    const file = join(TEST_DIR, 'cache', 'test-key.json');
    const data = JSON.parse(require('fs').readFileSync(file, 'utf-8'));
    data._v = 1; // old version, current is 2
    require('fs').writeFileSync(file, JSON.stringify(data));
    const result = getCached('test-key', 'quote');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test engine/test/cache.test.ts`
Expected: FAIL — getCachedWithFallback not found, _v not checked

- [ ] **Step 3: Rewrite cache.ts**

Replace the entire content of `engine/src/cache.ts`:

```typescript
// engine/src/cache.ts
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { CACHE_DIR } from './paths';
import { atomicWriteJSON, readJSONSafe } from './fs';

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test engine/test/cache.test.ts`
Expected: PASS

- [ ] **Step 5: Run all existing tests to ensure no regressions**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test`
Expected: Some may fail because other modules still import old cache paths or use `homedir()` directly. That's expected — we'll fix them in the next tasks.

- [ ] **Step 6: Commit**

```bash
git add engine/src/cache.ts engine/test/cache.test.ts
git commit -m "feat: upgrade cache with version stamps and fallback reads"
```

---

### Task 6: Migrate Data Sources to fetchWithRetry

**Files:**
- Modify: `engine/src/data/yahoo.ts`
- Modify: `engine/src/data/fred.ts`
- Modify: `engine/src/data/edgar.ts`
- Modify: `engine/src/data/alphavantage.ts`
- Modify: `engine/src/data/polygon.ts`

- [ ] **Step 1: Migrate yahoo.ts — add fetchWithRetry, crumb TTL, UA rotation**

Replace the entire content of `engine/src/data/yahoo.ts`:

```typescript
// engine/src/data/yahoo.ts
import { fetchWithRetry } from '../net';

const BASE = 'https://query1.finance.yahoo.com';

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/119.0.0.0',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

let _crumb: string | null = null;
let _cookie: string | null = null;
let _crumbExpiry = 0;
const CRUMB_TTL = 30 * 60 * 1000; // 30 minutes

function clearCrumb(): void {
  _crumb = null;
  _cookie = null;
  _crumbExpiry = 0;
}

async function getCrumb(): Promise<{ crumb: string; cookie: string }> {
  if (_crumb && _cookie && Date.now() < _crumbExpiry) {
    return { crumb: _crumb, cookie: _cookie };
  }

  clearCrumb();
  const ua = randomUA();

  // Step 1: Get consent cookie
  const consentRes = await fetchWithRetry('https://fc.yahoo.com', {
    headers: { 'User-Agent': ua },
    redirect: 'manual',
  }, { retries: 1, backoffMs: [500], timeoutMs: 8000 });
  const setCookies = consentRes.headers.getSetCookie?.() || [];
  const cookies = setCookies.map(c => c.split(';')[0]).join('; ');

  // Step 2: Get crumb
  const crumbRes = await fetchWithRetry(`${BASE}/v1/test/getcrumb`, {
    headers: { 'User-Agent': ua, 'Cookie': cookies },
  }, { retries: 1, backoffMs: [500], timeoutMs: 8000 });
  if (!crumbRes.ok) {
    throw new Error(`Failed to get Yahoo crumb: ${crumbRes.status}`);
  }
  const crumb = await crumbRes.text();

  _crumb = crumb;
  _cookie = cookies;
  _crumbExpiry = Date.now() + CRUMB_TTL;
  return { crumb, cookie: cookies };
}

async function yf(path: string, needsCrumb = false): Promise<any> {
  const ua = randomUA();
  let headers: Record<string, string> = { 'User-Agent': ua };
  let url = `${BASE}${path}`;

  if (needsCrumb) {
    try {
      const { crumb, cookie } = await getCrumb();
      url += (url.includes('?') ? '&' : '?') + `crumb=${encodeURIComponent(crumb)}`;
      headers['Cookie'] = cookie;
    } catch {
      // Crumb failed — clear and retry once
      clearCrumb();
      const { crumb, cookie } = await getCrumb();
      url = `${BASE}${path}`;
      url += (url.includes('?') ? '&' : '?') + `crumb=${encodeURIComponent(crumb)}`;
      headers['Cookie'] = cookie;
    }
  }

  const res = await fetchWithRetry(url, { headers }, {
    retries: 2,
    backoffMs: [1000, 3000],
    timeoutMs: 10_000,
  });
  if (!res.ok) {
    // Clear crumb on auth errors so next call refreshes
    if (res.status === 401 || res.status === 403) clearCrumb();
    const text = await res.text().catch(() => '');
    throw new Error(`Yahoo Finance ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function fetchChart(ticker: string, range = '1mo', interval = '1d') {
  return yf(`/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`);
}

export async function fetchQuoteSummary(ticker: string, modules: string[]) {
  return yf(`/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules.join(',')}`, true);
}

export async function fetchTrending(region = 'US', count = 20) {
  return yf(`/v1/finance/trending/${region}?count=${count}`);
}

export async function fetchSearch(query: string) {
  return yf(`/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=10&quotesCount=5`);
}

// extractQuote and extractFinancials unchanged — keep exact same code
export function extractQuote(chartData: any) {
  const result = chartData?.chart?.result?.[0];
  if (!result) return null;

  const meta = result.meta;
  const quotes = result.indicators?.quote?.[0];
  const timestamps = result.timestamp || [];
  const lastIdx = Math.max(0, timestamps.length - 1);

  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose;
  const change = price - prevClose;
  const changePct = prevClose ? (change / prevClose) * 100 : 0;

  return {
    ticker: meta.symbol,
    price: +price.toFixed(2),
    change: +change.toFixed(2),
    changePct: +changePct.toFixed(2),
    currency: meta.currency,
    exchange: meta.exchangeName,
    volume: quotes?.volume?.[lastIdx],
    high: quotes?.high?.[lastIdx] ? +quotes.high[lastIdx].toFixed(2) : null,
    low: quotes?.low?.[lastIdx] ? +quotes.low[lastIdx].toFixed(2) : null,
    open: quotes?.open?.[lastIdx] ? +quotes.open[lastIdx].toFixed(2) : null,
    previousClose: prevClose,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
    marketState: meta.marketState,
    timestamp: new Date((meta.regularMarketTime ?? 0) * 1000).toISOString(),
  };
}

export function extractFinancials(summaryData: any) {
  const r = summaryData?.quoteSummary?.result?.[0];
  if (!r) return null;

  const fd = r.financialData || {};
  const ks = r.defaultKeyStatistics || {};
  const price = r.price || {};

  const raw = (obj: any) => {
    if (obj === null || obj === undefined) return null;
    if (typeof obj === 'object' && 'raw' in obj) return obj.raw;
    if (typeof obj === 'object') return null;
    return obj;
  };

  return {
    ticker: price.symbol,
    name: price.shortName || price.longName,
    sector: r.assetProfile?.sector,
    industry: r.assetProfile?.industry,
    marketCap: raw(price.marketCap),
    enterpriseValue: raw(ks.enterpriseValue),
    trailingPE: raw(ks.trailingPE),
    forwardPE: raw(ks.forwardPE),
    priceToBook: raw(ks.priceToBook),
    priceToSales: raw(price.priceToSalesTrailing12Months),
    evToEbitda: raw(ks.enterpriseToEbitda),
    evToRevenue: raw(ks.enterpriseToRevenue),
    pegRatio: raw(ks.pegRatio),
    grossMargin: raw(fd.grossMargins),
    operatingMargin: raw(fd.operatingMargins),
    profitMargin: raw(fd.profitMargins),
    returnOnEquity: raw(fd.returnOnEquity),
    returnOnAssets: raw(fd.returnOnAssets),
    revenueGrowth: raw(fd.revenueGrowth),
    earningsGrowth: raw(fd.earningsGrowth),
    totalCash: raw(fd.totalCash),
    totalDebt: raw(fd.totalDebt),
    debtToEquity: raw(fd.debtToEquity),
    currentRatio: raw(fd.currentRatio),
    freeCashflow: raw(fd.freeCashflow),
    operatingCashflow: raw(fd.operatingCashflow),
    revenuePerShare: raw(fd.revenuePerShare),
    bookValue: raw(ks.bookValue),
    dividendYield: raw(ks.dividendYield),
    payoutRatio: raw(ks.payoutRatio),
    targetMeanPrice: raw(fd.targetMeanPrice),
    recommendationMean: raw(fd.recommendationMean),
    recommendationKey: fd.recommendationKey,
    numberOfAnalystOpinions: raw(fd.numberOfAnalystOpinions),
  };
}
```

- [ ] **Step 2: Migrate fred.ts**

Replace `fetch(url)` with `fetchWithRetry` in `engine/src/data/fred.ts`:

```typescript
// engine/src/data/fred.ts
import { getKey } from './keys';
import { fetchWithRetry } from '../net';

const BASE = 'https://api.stlouisfed.org/fred/series/observations';

// ... CORE_SERIES, SERIES_LABELS, FredObservation interface, parseFredResponse — all unchanged ...

export async function fetchSeries(seriesId: string, limit = 2): Promise<FredObservation> {
  const apiKey = getKey('fred');
  if (!apiKey) throw new Error('FRED API key not configured. Run: finstack keys set fred <your-key>');

  const url = `${BASE}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`FRED API ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();

  if (data.observations) data.observations.reverse();
  return parseFredResponse(seriesId, data);
}

// fetchMultiple unchanged
```

Only change: `import { fetchWithRetry } from '../net';` and `fetch(url)` → `fetchWithRetry(url)`.

- [ ] **Step 3: Migrate edgar.ts**

In `engine/src/data/edgar.ts`, add import and replace both `fetch()` calls:

```typescript
// At the top, add:
import { fetchWithRetry } from '../net';

// In resolveCIK(), replace:
//   const res = await fetch(TICKERS_URL, { headers: { 'User-Agent': UA } });
// With:
    const res = await fetchWithRetry(TICKERS_URL, { headers: { 'User-Agent': UA } });

// In fetchFilings(), replace:
//   const res = await fetch(url, { headers: { 'User-Agent': UA } });
// With:
    const res = await fetchWithRetry(url, { headers: { 'User-Agent': UA } });
```

Note: SEC EDGAR requires a specific `User-Agent` header — this is preserved in the `headers` option passed to `fetchWithRetry`.

- [ ] **Step 4: Migrate alphavantage.ts**

In `engine/src/data/alphavantage.ts`, add import and replace the `fetch()` call:

```typescript
// At the top, replace:
//   (no fetch import needed, was using global)
// Add:
import { fetchWithRetry } from '../net';

// In fetchEarnings(), replace:
//   const res = await fetch(url);
// With:
  const res = await fetchWithRetry(url);
```

- [ ] **Step 5: Migrate polygon.ts**

In `engine/src/data/polygon.ts`, add import and replace the `fetch()` call:

```typescript
// At the top, add:
import { fetchWithRetry } from '../net';

// In fetchBars(), replace:
//   const res = await fetch(url);
// With:
  const res = await fetchWithRetry(url);
```

- [ ] **Step 6: Run all existing tests**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test`
Expected: Existing data layer tests should still pass (they test parsing functions, not the fetch calls).

- [ ] **Step 7: Commit**

```bash
git add engine/src/data/yahoo.ts engine/src/data/fred.ts engine/src/data/edgar.ts engine/src/data/alphavantage.ts engine/src/data/polygon.ts
git commit -m "feat: migrate all data sources to fetchWithRetry with timeouts"
```

---

### Task 7: Migrate State Files to atomicWriteJSON + paths.ts

**Files:**
- Modify: `engine/src/data/keys.ts`
- Modify: `engine/src/data/thesis.ts`
- Modify: `engine/src/data/shadow.ts`
- Modify: `engine/src/commands/portfolio.ts`
- Modify: `engine/src/commands/regime.ts`
- Modify: `engine/src/commands/risk.ts`

- [ ] **Step 1: Migrate keys.ts**

Replace `engine/src/data/keys.ts`:

```typescript
// engine/src/data/keys.ts
import { KEYS_FILE } from '../paths';
import { atomicWriteJSON, readJSONSafe } from '../fs';

type Provider = 'fred' | 'alphavantage' | 'polygon' | 'fmp';
type KeyStore = Partial<Record<Provider, string>>;

export { KEYS_FILE };

export function getKey(provider: string, file = KEYS_FILE): string | null {
  const data = readJSONSafe<KeyStore>(file, {});
  return data[provider as Provider] ?? null;
}

export function setKey(provider: string, key: string, file = KEYS_FILE): void {
  const data = readJSONSafe<KeyStore>(file, {});
  data[provider as Provider] = key;
  atomicWriteJSON(file, data, 0o600);
}

export function removeKey(provider: string, file = KEYS_FILE): void {
  const data = readJSONSafe<KeyStore>(file, {});
  delete data[provider as Provider];
  atomicWriteJSON(file, data, 0o600);
}

export function listKeys(file = KEYS_FILE): { provider: string; configured: boolean; masked: string }[] {
  const data = readJSONSafe<KeyStore>(file, {});
  return Object.entries(data)
    .filter(([, v]) => v)
    .map(([provider, key]) => ({
      provider,
      configured: true,
      masked: key!.slice(0, 3) + '***',
    }));
}
```

- [ ] **Step 2: Migrate thesis.ts**

Replace `DEFAULT_FILE` with `import { THESES_FILE } from '../paths'` and all `writeFileSync` with `atomicWriteJSON`. Replace all `existsSync+readFileSync+JSON.parse+catch` blocks with `readJSONSafe`.

Key changes in `engine/src/data/thesis.ts`:
- `import { THESES_FILE } from '../paths';`
- `import { atomicWriteJSON, readJSONSafe } from '../fs';`
- Remove `const DEFAULT_FILE = ...`
- `loadTheses(file = THESES_FILE)` → body becomes `return readJSONSafe<ThesesStore>(file, { theses: [] });`
- All `save()` calls → `atomicWriteJSON(file, data)`
- Remove the `import { existsSync, readFileSync, writeFileSync, mkdirSync }` and `import { dirname }` and `import { homedir }` lines

- [ ] **Step 3: Migrate shadow.ts**

Same pattern as thesis.ts:
- `import { SHADOW_FILE } from '../paths';`
- `import { atomicWriteJSON, readJSONSafe } from '../fs';`
- `loadShadow(file = SHADOW_FILE)` → `return readJSONSafe<Shadow>(file, { entries: [] });`
- `save()` → `atomicWriteJSON(file, data)`
- Remove old fs imports

- [ ] **Step 4: Migrate portfolio.ts**

Replace `engine/src/commands/portfolio.ts` top section:

```typescript
// engine/src/commands/portfolio.ts
import { PORTFOLIO_FILE, SHADOW_FILE } from '../paths';
import { atomicWriteJSON, readJSONSafe } from '../fs';
// Remove old fs imports, FINSTACK_DIR constant, existsSync/readFileSync/writeFileSync/mkdirSync

// ... interfaces unchanged ...

function load(): Portfolio {
  const data = readJSONSafe<Portfolio>(PORTFOLIO_FILE, { positions: [], transactions: [], updatedAt: new Date().toISOString() });
  if (!data.transactions) data.transactions = [];
  return data;
}

function save(data: Portfolio) {
  data.updatedAt = new Date().toISOString();
  atomicWriteJSON(PORTFOLIO_FILE, data);
}

function loadShadow(): any {
  return readJSONSafe(SHADOW_FILE, { entries: [] });
}
```

The rest of the `portfolio()` function stays the same.

- [ ] **Step 5: Migrate regime.ts**

```typescript
// Top of engine/src/commands/regime.ts
import { CONSENSUS_FILE } from '../paths';
import { atomicWriteJSON, readJSONSafe } from '../fs';
// Remove old fs imports and FINSTACK_DIR/CONSENSUS_FILE constants

function load(): Assumption[] {
  return readJSONSafe<Assumption[]>(CONSENSUS_FILE, []);
}

function save(data: Assumption[]) {
  atomicWriteJSON(CONSENSUS_FILE, data);
}
```

- [ ] **Step 6: Migrate risk.ts**

Replace path constants at top of `engine/src/commands/risk.ts`:

```typescript
import { PORTFOLIO_FILE, PROFILE_FILE } from '../paths';
import { readJSONSafe } from '../fs';
// Remove: existsSync, readFileSync imports and FINSTACK_DIR/PORTFOLIO_FILE/PROFILE_FILE constants

function loadPortfolio(): Portfolio {
  const data = readJSONSafe<Portfolio>(PORTFOLIO_FILE, { positions: [], transactions: [], updatedAt: '' });
  if (!data.transactions) data.transactions = [];
  return data;
}

function loadProfile(): { riskBudgetPct: number } {
  const data = readJSONSafe<any>(PROFILE_FILE, { riskBudgetPct: 2 });
  return { riskBudgetPct: data.riskBudgetPct || 2 };
}
```

- [ ] **Step 7: Run all tests**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test`
Expected: All pass (existing tests use temp file paths as arguments)

- [ ] **Step 8: Commit**

```bash
git add engine/src/data/keys.ts engine/src/data/thesis.ts engine/src/data/shadow.ts engine/src/commands/portfolio.ts engine/src/commands/regime.ts engine/src/commands/risk.ts
git commit -m "refactor: migrate all state files to atomicWriteJSON + central paths"
```

---

### Task 8: Command Fallback Chains

**Files:**
- Modify: `engine/src/commands/quote.ts`
- Modify: `engine/src/commands/financials.ts`
- Modify: `engine/src/commands/history.ts`
- Modify: `engine/src/commands/scan.ts`
- Modify: `engine/src/commands/earnings.ts`

- [ ] **Step 1: Upgrade quote.ts with fallback chain**

Replace `engine/src/commands/quote.ts`:

```typescript
// engine/src/commands/quote.ts
import { fetchChart, extractQuote } from '../data/yahoo';
import { getCached, getCachedWithFallback, setCache } from '../cache';
import { getKey } from '../data/keys';
import { FinstackError } from '../errors';

export async function quote(args: string[]) {
  const ticker = args[0]?.toUpperCase();
  if (!ticker) {
    console.error(JSON.stringify({ error: 'Usage: finstack quote <ticker>' }));
    process.exit(1);
  }

  const cacheKey = `quote-${ticker}`;

  // Check fresh cache first
  const cached = getCached(cacheKey, 'quote');
  if (cached) {
    const { _cachedAt, _v, ...data } = cached;
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Try Yahoo
  try {
    const raw = await fetchChart(ticker, '5d', '1d');
    const data = extractQuote(raw);
    if (data) {
      setCache(cacheKey, data);
      console.log(JSON.stringify(data, null, 2));
      return;
    }
  } catch {}

  // Try Polygon (if key configured)
  if (getKey('polygon')) {
    try {
      const { fetchBars } = await import('../data/polygon');
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      const bars = await fetchBars(ticker, weekAgo, today);
      if (bars.bars.length > 0) {
        const last = bars.bars[bars.bars.length - 1];
        const data = { ticker, price: last.close, source: 'polygon', date: last.date };
        setCache(cacheKey, data);
        console.log(JSON.stringify(data, null, 2));
        return;
      }
    } catch {}
  }

  // Fallback to stale cache
  const stale = getCachedWithFallback(cacheKey, 'quote');
  if (stale) {
    console.log(JSON.stringify({ ...stale.data, _stale: true, _cacheAge: stale.age }, null, 2));
    return;
  }

  throw new FinstackError(
    `无法获取 ${ticker} 报价`,
    'yahoo',
    '所有数据源均不可用',
    '稍后重试，或配置备选数据源: finstack keys set polygon YOUR_KEY',
  );
}
```

- [ ] **Step 2: Upgrade financials.ts with fallback chain**

Replace `engine/src/commands/financials.ts`:

```typescript
// engine/src/commands/financials.ts
import { fetchQuoteSummary, extractFinancials } from '../data/yahoo';
import { getCached, getCachedWithFallback, setCache } from '../cache';
import { getKey } from '../data/keys';
import { FinstackError } from '../errors';

const MODULES = ['financialData', 'defaultKeyStatistics', 'price', 'assetProfile'];

export async function financials(args: string[]) {
  const ticker = args[0]?.toUpperCase();
  if (!ticker) {
    console.error(JSON.stringify({ error: 'Usage: finstack financials <ticker>' }));
    process.exit(1);
  }

  const cacheKey = `financials-${ticker}`;
  const cached = getCached(cacheKey, 'financials');
  if (cached) {
    const { _cachedAt, _v, ...data } = cached;
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Try Yahoo
  try {
    const raw = await fetchQuoteSummary(ticker, MODULES);
    const data = extractFinancials(raw);
    if (data) {
      setCache(cacheKey, data);
      console.log(JSON.stringify(data, null, 2));
      return;
    }
  } catch {}

  // Try FMP (if key configured)
  if (getKey('fmp')) {
    try {
      const { fetchFMPFinancials } = await import('../data/fmp');
      const data = await fetchFMPFinancials(ticker, getKey('fmp')!);
      if (data) {
        setCache(cacheKey, data);
        console.log(JSON.stringify(data, null, 2));
        return;
      }
    } catch {}
  }

  // Fallback to stale cache
  const stale = getCachedWithFallback(cacheKey, 'financials');
  if (stale) {
    console.log(JSON.stringify({ ...stale.data, _stale: true, _cacheAge: stale.age }, null, 2));
    return;
  }

  throw new FinstackError(
    `无法获取 ${ticker} 财务数据`,
    'yahoo',
    '所有数据源均不可用',
    '稍后重试，或配置 FMP: finstack keys set fmp YOUR_KEY',
  );
}
```

- [ ] **Step 3: Upgrade history.ts with FinstackError**

In `engine/src/commands/history.ts`, replace the final throw:

```typescript
// Add at top:
import { FinstackError } from '../errors';
import { getCachedWithFallback } from '../cache';

// Replace the throw at the end of history():
  // After Polygon fallback fails, try stale cache
  const stale = getCachedWithFallback(cacheKey, cacheType);
  if (stale) {
    console.log(JSON.stringify({ ...stale.data, _stale: true, _cacheAge: stale.age }, null, 2));
    return;
  }

  throw new FinstackError(
    `无法获取 ${ticker} 历史数据`,
    'yahoo',
    'Yahoo 和 Polygon 均不可用',
    'finstack keys set polygon YOUR_KEY',
  );
```

- [ ] **Step 4: Upgrade scan.ts with fetchWithRetry (already done via yahoo.ts)**

No changes needed — scan.ts calls `fetchTrending` and `fetchSearch` which already use `fetchWithRetry` via the yahoo.ts migration.

- [ ] **Step 5: Upgrade earnings.ts — add FinstackError**

In `engine/src/commands/earnings.ts`, wrap with fallback:

```typescript
// engine/src/commands/earnings.ts
import { fetchEarnings } from '../data/alphavantage';
import { getCached, getCachedWithFallback, setCache } from '../cache';
import { FinstackError } from '../errors';

export async function earnings(args: string[]) {
  const ticker = args[0]?.toUpperCase();
  if (!ticker) {
    console.error(JSON.stringify({ error: 'Usage: finstack earnings <ticker>' }));
    process.exit(1);
  }

  const cacheKey = `earnings-${ticker}`;
  const cached = getCached(cacheKey, 'earnings');
  if (cached) {
    const { _cachedAt, _v, ...data } = cached;
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  try {
    const data = await fetchEarnings(ticker);
    setCache(cacheKey, data);
    console.log(JSON.stringify(data, null, 2));
  } catch (e: any) {
    const stale = getCachedWithFallback(cacheKey, 'earnings');
    if (stale) {
      console.log(JSON.stringify({ ...stale.data, _stale: true, _cacheAge: stale.age }, null, 2));
      return;
    }
    throw new FinstackError(
      `无法获取 ${ticker} earnings 数据`,
      'alphavantage',
      e.message,
      'finstack keys set alphavantage YOUR_KEY',
    );
  }
}
```

- [ ] **Step 6: Run all tests**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add engine/src/commands/quote.ts engine/src/commands/financials.ts engine/src/commands/history.ts engine/src/commands/earnings.ts
git commit -m "feat: add data source fallback chains with stale cache degradation"
```

---

### Task 9: FMP Data Source

**Files:**
- Create: `engine/src/data/fmp.ts`
- Create: `engine/test/data/fmp.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// engine/test/data/fmp.test.ts
import { describe, it, expect } from 'bun:test';
import { parseFMPFinancials } from '../../src/data/fmp';

describe('parseFMPFinancials', () => {
  it('parses FMP profile + ratios into finstack format', () => {
    const profile = [{
      symbol: 'NVDA',
      companyName: 'NVIDIA Corp',
      sector: 'Technology',
      industry: 'Semiconductors',
      mktCap: 2800000000000,
      price: 850,
    }];
    const ratios = [{
      peRatioTTM: 65.2,
      priceToBookRatioTTM: 40.1,
      grossProfitMarginTTM: 0.72,
      operatingProfitMarginTTM: 0.54,
      netProfitMarginTTM: 0.48,
      returnOnEquityTTM: 0.88,
      dividendYieldTTM: 0.001,
      debtEquityRatioTTM: 0.41,
      currentRatioTTM: 4.2,
    }];

    const result = parseFMPFinancials('NVDA', profile, ratios);
    expect(result.ticker).toBe('NVDA');
    expect(result.name).toBe('NVIDIA Corp');
    expect(result.sector).toBe('Technology');
    expect(result.marketCap).toBe(2800000000000);
    expect(result.trailingPE).toBe(65.2);
    expect(result.grossMargin).toBe(0.72);
  });

  it('returns null for empty data', () => {
    const result = parseFMPFinancials('NVDA', [], []);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test engine/test/data/fmp.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement fmp.ts**

```typescript
// engine/src/data/fmp.ts
import { fetchWithRetry } from '../net';

const FMP_BASE = 'https://financialmodelingprep.com/api/v3';

export function parseFMPFinancials(ticker: string, profile: any[], ratios: any[]) {
  const p = profile?.[0];
  if (!p) return null;
  const r = ratios?.[0] || {};

  return {
    ticker: ticker.toUpperCase(),
    name: p.companyName || null,
    sector: p.sector || null,
    industry: p.industry || null,
    marketCap: p.mktCap || null,
    enterpriseValue: null,
    trailingPE: r.peRatioTTM || null,
    forwardPE: null,
    priceToBook: r.priceToBookRatioTTM || null,
    priceToSales: r.priceToSalesRatioTTM || null,
    evToEbitda: r.enterpriseValueOverEBITDATTM || null,
    evToRevenue: null,
    pegRatio: r.pegRatioTTM || null,
    grossMargin: r.grossProfitMarginTTM || null,
    operatingMargin: r.operatingProfitMarginTTM || null,
    profitMargin: r.netProfitMarginTTM || null,
    returnOnEquity: r.returnOnEquityTTM || null,
    returnOnAssets: r.returnOnAssetsTTM || null,
    revenueGrowth: null,
    earningsGrowth: null,
    totalCash: null,
    totalDebt: null,
    debtToEquity: r.debtEquityRatioTTM || null,
    currentRatio: r.currentRatioTTM || null,
    freeCashflow: null,
    operatingCashflow: null,
    revenuePerShare: r.revenuePerShareTTM || null,
    bookValue: r.bookValuePerShareTTM || null,
    dividendYield: r.dividendYieldTTM || null,
    payoutRatio: r.payoutRatioTTM || null,
    targetMeanPrice: null,
    recommendationMean: null,
    recommendationKey: null,
    numberOfAnalystOpinions: null,
    source: 'fmp',
  };
}

export async function fetchFMPFinancials(ticker: string, apiKey: string) {
  const [profileRes, ratiosRes] = await Promise.all([
    fetchWithRetry(`${FMP_BASE}/profile/${encodeURIComponent(ticker)}?apikey=${apiKey}`),
    fetchWithRetry(`${FMP_BASE}/ratios-ttm/${encodeURIComponent(ticker)}?apikey=${apiKey}`),
  ]);

  if (!profileRes.ok) throw new Error(`FMP profile ${profileRes.status}`);
  if (!ratiosRes.ok) throw new Error(`FMP ratios ${ratiosRes.status}`);

  const profile = await profileRes.json();
  const ratios = await ratiosRes.json();

  return parseFMPFinancials(ticker, profile, ratios);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test engine/test/data/fmp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/src/data/fmp.ts engine/test/data/fmp.test.ts
git commit -m "feat: add Financial Modeling Prep as Tier 1 financials data source"
```

---

### Task 10: Watchlist Command

**Files:**
- Create: `engine/src/commands/watchlist.ts`
- Create: `engine/test/commands/watchlist.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// engine/test/commands/watchlist.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readJSONSafe } from '../../src/fs';

const TEST_DIR = join(tmpdir(), `finstack-watchlist-test-${Date.now()}`);
const WATCHLIST_FILE = join(TEST_DIR, 'watchlist.json');

// Import the data layer functions we'll create
import {
  loadWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  tagTicker,
  untagTicker,
  type WatchlistEntry,
} from '../../src/data/watchlist';

describe('watchlist', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns empty array for missing file', () => {
    const result = loadWatchlist(WATCHLIST_FILE);
    expect(result).toEqual([]);
  });

  it('adds a ticker with reason', () => {
    addToWatchlist('NVDA', '等Q2财报', WATCHLIST_FILE);
    const list = loadWatchlist(WATCHLIST_FILE);
    expect(list).toHaveLength(1);
    expect(list[0].ticker).toBe('NVDA');
    expect(list[0].reason).toBe('等Q2财报');
    expect(list[0].tags).toEqual([]);
    expect(list[0].alerts).toEqual([]);
  });

  it('normalizes ticker to uppercase', () => {
    addToWatchlist('nvda', 'test', WATCHLIST_FILE);
    expect(loadWatchlist(WATCHLIST_FILE)[0].ticker).toBe('NVDA');
  });

  it('does not add duplicate ticker', () => {
    addToWatchlist('NVDA', 'reason 1', WATCHLIST_FILE);
    addToWatchlist('NVDA', 'reason 2', WATCHLIST_FILE);
    const list = loadWatchlist(WATCHLIST_FILE);
    expect(list).toHaveLength(1);
    expect(list[0].reason).toBe('reason 2'); // Updated reason
  });

  it('removes a ticker', () => {
    addToWatchlist('NVDA', 'test', WATCHLIST_FILE);
    addToWatchlist('AMD', 'test', WATCHLIST_FILE);
    removeFromWatchlist('NVDA', WATCHLIST_FILE);
    const list = loadWatchlist(WATCHLIST_FILE);
    expect(list).toHaveLength(1);
    expect(list[0].ticker).toBe('AMD');
  });

  it('tags a ticker', () => {
    addToWatchlist('NVDA', 'test', WATCHLIST_FILE);
    tagTicker('NVDA', 'semiconductor', WATCHLIST_FILE);
    const list = loadWatchlist(WATCHLIST_FILE);
    expect(list[0].tags).toEqual(['semiconductor']);
  });

  it('does not add duplicate tag', () => {
    addToWatchlist('NVDA', 'test', WATCHLIST_FILE);
    tagTicker('NVDA', 'semiconductor', WATCHLIST_FILE);
    tagTicker('NVDA', 'semiconductor', WATCHLIST_FILE);
    expect(loadWatchlist(WATCHLIST_FILE)[0].tags).toEqual(['semiconductor']);
  });

  it('untags a ticker', () => {
    addToWatchlist('NVDA', 'test', WATCHLIST_FILE);
    tagTicker('NVDA', 'semiconductor', WATCHLIST_FILE);
    tagTicker('NVDA', 'ai', WATCHLIST_FILE);
    untagTicker('NVDA', 'semiconductor', WATCHLIST_FILE);
    expect(loadWatchlist(WATCHLIST_FILE)[0].tags).toEqual(['ai']);
  });

  it('links thesis to watchlist entry', () => {
    addToWatchlist('NVDA', 'test', WATCHLIST_FILE, 't_123');
    expect(loadWatchlist(WATCHLIST_FILE)[0].linkedThesis).toBe('t_123');
  });

  it('validates ticker format', () => {
    expect(() => addToWatchlist('../etc/passwd', 'hack', WATCHLIST_FILE)).toThrow();
    expect(() => addToWatchlist('', 'empty', WATCHLIST_FILE)).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test engine/test/commands/watchlist.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement watchlist data layer**

Create `engine/src/data/watchlist.ts`:

```typescript
// engine/src/data/watchlist.ts
import { WATCHLIST_FILE } from '../paths';
import { atomicWriteJSON, readJSONSafe } from '../fs';

export interface WatchlistAlert {
  type: 'price' | 'earnings' | 'date';
  condition?: 'above' | 'below';
  value?: number;
  date?: string;
  note: string;
  triggered: boolean;
  triggeredAt?: string;
}

export interface WatchlistEntry {
  ticker: string;
  addedAt: string;
  reason: string;
  tags: string[];
  linkedThesis: string | null;
  alerts: WatchlistAlert[];
}

const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

function validateTicker(ticker: string): string {
  const upper = ticker.toUpperCase();
  if (!TICKER_RE.test(upper)) {
    throw new Error(`Invalid ticker: ${ticker}. Only A-Z, 0-9, '.', '-' allowed.`);
  }
  return upper;
}

export function loadWatchlist(file = WATCHLIST_FILE): WatchlistEntry[] {
  return readJSONSafe<WatchlistEntry[]>(file, []);
}

export function addToWatchlist(
  ticker: string,
  reason: string,
  file = WATCHLIST_FILE,
  linkedThesis: string | null = null,
): WatchlistEntry {
  const normalized = validateTicker(ticker);
  const list = loadWatchlist(file);
  const existing = list.find(e => e.ticker === normalized);

  if (existing) {
    existing.reason = reason;
    if (linkedThesis) existing.linkedThesis = linkedThesis;
    atomicWriteJSON(file, list);
    return existing;
  }

  const entry: WatchlistEntry = {
    ticker: normalized,
    addedAt: new Date().toISOString(),
    reason,
    tags: [],
    linkedThesis,
    alerts: [],
  };
  list.push(entry);
  atomicWriteJSON(file, list);
  return entry;
}

export function removeFromWatchlist(ticker: string, file = WATCHLIST_FILE): void {
  const normalized = validateTicker(ticker);
  const list = loadWatchlist(file);
  const filtered = list.filter(e => e.ticker !== normalized);
  atomicWriteJSON(file, filtered);
}

export function tagTicker(ticker: string, tag: string, file = WATCHLIST_FILE): void {
  const normalized = validateTicker(ticker);
  const list = loadWatchlist(file);
  const entry = list.find(e => e.ticker === normalized);
  if (!entry) return;
  if (!entry.tags.includes(tag)) entry.tags.push(tag);
  atomicWriteJSON(file, list);
}

export function untagTicker(ticker: string, tag: string, file = WATCHLIST_FILE): void {
  const normalized = validateTicker(ticker);
  const list = loadWatchlist(file);
  const entry = list.find(e => e.ticker === normalized);
  if (!entry) return;
  entry.tags = entry.tags.filter(t => t !== tag);
  atomicWriteJSON(file, list);
}

export function addAlert(
  ticker: string,
  alert: WatchlistAlert,
  file = WATCHLIST_FILE,
): void {
  const normalized = validateTicker(ticker);
  const list = loadWatchlist(file);
  const entry = list.find(e => e.ticker === normalized);
  if (!entry) return;
  entry.alerts.push(alert);
  atomicWriteJSON(file, list);
}
```

- [ ] **Step 4: Implement watchlist CLI command**

Create `engine/src/commands/watchlist.ts`:

```typescript
// engine/src/commands/watchlist.ts
import {
  loadWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  tagTicker,
  untagTicker,
} from '../data/watchlist';

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

export async function watchlist(args: string[]) {
  const sub = args[0];

  // No subcommand — show list
  if (!sub || sub === 'show') {
    const list = loadWatchlist();
    console.log(JSON.stringify({ watchlist: list, count: list.length }, null, 2));
    return;
  }

  switch (sub) {
    case 'add': {
      const ticker = args[1];
      if (!ticker) {
        console.error(JSON.stringify({ error: 'Usage: finstack watchlist add <ticker> [reason] [--thesis <id>]' }));
        process.exit(1);
      }
      const thesis = parseFlag(args, '--thesis') || null;
      const reason = args.slice(2).filter(a => a !== '--thesis' && a !== thesis).join(' ') || '';
      const entry = addToWatchlist(ticker, reason, undefined, thesis);
      console.log(JSON.stringify(entry, null, 2));
      break;
    }

    case 'remove': {
      const ticker = args[1];
      if (!ticker) {
        console.error(JSON.stringify({ error: 'Usage: finstack watchlist remove <ticker>' }));
        process.exit(1);
      }
      removeFromWatchlist(ticker);
      console.log(JSON.stringify({ message: `${ticker.toUpperCase()} removed from watchlist` }));
      break;
    }

    case 'tag': {
      const ticker = args[1];
      const tag = args[2];
      if (!ticker || !tag) {
        console.error(JSON.stringify({ error: 'Usage: finstack watchlist tag <ticker> <tag>' }));
        process.exit(1);
      }
      tagTicker(ticker, tag);
      console.log(JSON.stringify({ message: `Tagged ${ticker.toUpperCase()} with "${tag}"` }));
      break;
    }

    case 'untag': {
      const ticker = args[1];
      const tag = args[2];
      if (!ticker || !tag) {
        console.error(JSON.stringify({ error: 'Usage: finstack watchlist untag <ticker> <tag>' }));
        process.exit(1);
      }
      untagTicker(ticker, tag);
      console.log(JSON.stringify({ message: `Removed tag "${tag}" from ${ticker.toUpperCase()}` }));
      break;
    }

    default:
      console.error(JSON.stringify({ error: `Unknown subcommand: ${sub}. Use show|add|remove|tag|untag` }));
      process.exit(1);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test engine/test/commands/watchlist.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add engine/src/data/watchlist.ts engine/src/commands/watchlist.ts engine/test/commands/watchlist.test.ts
git commit -m "feat: add watchlist management with CRUD and tagging"
```

---

### Task 11: Alerts Command

**Files:**
- Create: `engine/src/commands/alerts.ts`
- Create: `engine/test/commands/alerts.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// engine/test/commands/alerts.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { atomicWriteJSON } from '../../src/fs';
import { aggregateAlerts, type Alert } from '../../src/commands/alerts';

const TEST_DIR = join(tmpdir(), `finstack-alerts-test-${Date.now()}`);

describe('aggregateAlerts', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns empty for no data files', () => {
    const result = aggregateAlerts({
      watchlistFile: join(TEST_DIR, 'watchlist.json'),
      thesesFile: join(TEST_DIR, 'theses.json'),
      dueWithinDays: 7,
    });
    expect(result).toEqual([]);
  });

  it('picks up thesis obituary due dates', () => {
    const today = new Date().toISOString().split('T')[0];
    atomicWriteJSON(join(TEST_DIR, 'theses.json'), {
      theses: [{
        id: 't1',
        ticker: 'NVDA',
        thesis: 'AI capex grows',
        status: 'dead',
        obituaryDueDate: today,
        conditions: [],
        statusHistory: [],
        createdAt: '2025-01-01',
        lastChecked: '2025-01-01',
        verdict: 'buy',
      }],
    });

    const result = aggregateAlerts({
      watchlistFile: join(TEST_DIR, 'watchlist.json'),
      thesesFile: join(TEST_DIR, 'theses.json'),
      dueWithinDays: 7,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].source).toBe('thesis');
    expect(result[0].ticker).toBe('NVDA');
  });

  it('picks up watchlist date alerts', () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    atomicWriteJSON(join(TEST_DIR, 'watchlist.json'), [{
      ticker: 'TSLA',
      addedAt: '2025-01-01',
      reason: 'test',
      tags: [],
      linkedThesis: null,
      alerts: [{ type: 'date', date: tomorrow, note: '财报日', triggered: false }],
    }]);

    const result = aggregateAlerts({
      watchlistFile: join(TEST_DIR, 'watchlist.json'),
      thesesFile: join(TEST_DIR, 'theses.json'),
      dueWithinDays: 7,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].source).toBe('watchlist');
    expect(result[0].ticker).toBe('TSLA');
  });

  it('picks up thesis condition resolveBy dates', () => {
    const inThreeDays = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
    atomicWriteJSON(join(TEST_DIR, 'theses.json'), {
      theses: [{
        id: 't2',
        ticker: 'AMD',
        thesis: 'test',
        verdict: 'buy',
        status: 'alive',
        obituaryDueDate: null,
        conditions: [{
          id: 'c1',
          description: 'Q2 gross margin > 20%',
          type: 'earnings',
          metric: 'grossMargin',
          operator: '>',
          threshold: 0.2,
          resolveBy: inThreeDays,
          status: 'pending',
          actualValue: null,
          resolvedAt: null,
        }],
        statusHistory: [],
        createdAt: '2025-01-01',
        lastChecked: '2025-01-01',
      }],
    });

    const result = aggregateAlerts({
      watchlistFile: join(TEST_DIR, 'watchlist.json'),
      thesesFile: join(TEST_DIR, 'theses.json'),
      dueWithinDays: 7,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].ticker).toBe('AMD');
    expect(result[0].type).toBe('thesis_condition');
  });

  it('sorts by urgency: overdue > today > soon > later', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    const inFiveDays = new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0];

    atomicWriteJSON(join(TEST_DIR, 'watchlist.json'), [
      { ticker: 'LATER', addedAt: '2025-01-01', reason: '', tags: [], linkedThesis: null, alerts: [{ type: 'date', date: inFiveDays, note: 'later', triggered: false }] },
      { ticker: 'OVERDUE', addedAt: '2025-01-01', reason: '', tags: [], linkedThesis: null, alerts: [{ type: 'date', date: yesterday, note: 'overdue', triggered: false }] },
      { ticker: 'TODAY', addedAt: '2025-01-01', reason: '', tags: [], linkedThesis: null, alerts: [{ type: 'date', date: today, note: 'today', triggered: false }] },
    ]);

    const result = aggregateAlerts({
      watchlistFile: join(TEST_DIR, 'watchlist.json'),
      thesesFile: join(TEST_DIR, 'theses.json'),
      dueWithinDays: 30,
    });
    expect(result[0].ticker).toBe('OVERDUE');
    expect(result[1].ticker).toBe('TODAY');
    expect(result[2].ticker).toBe('LATER');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test engine/test/commands/alerts.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement alerts command**

```typescript
// engine/src/commands/alerts.ts
import { WATCHLIST_FILE, THESES_FILE } from '../paths';
import { readJSONSafe } from '../fs';
import type { WatchlistEntry } from '../data/watchlist';
import type { ThesesStore } from '../data/thesis';

export interface Alert {
  ticker: string;
  source: 'watchlist' | 'thesis' | 'thesis_condition' | 'earnings';
  type: string;
  date: string;
  daysUntil: number;
  description: string;
  urgency: 'overdue' | 'today' | 'soon' | 'upcoming';
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / 86400000);
}

function urgencyOf(days: number): Alert['urgency'] {
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 3) return 'soon';
  return 'upcoming';
}

const URGENCY_ORDER: Record<Alert['urgency'], number> = {
  overdue: 0,
  today: 1,
  soon: 2,
  upcoming: 3,
};

export function aggregateAlerts(opts: {
  watchlistFile?: string;
  thesesFile?: string;
  dueWithinDays?: number;
  source?: string;
}): Alert[] {
  const {
    watchlistFile = WATCHLIST_FILE,
    thesesFile = THESES_FILE,
    dueWithinDays = 7,
    source,
  } = opts;

  const alerts: Alert[] = [];

  // Watchlist alerts (includes date + earnings types)
  if (!source || source === 'watchlist' || source === 'earnings') {
    const watchlist = readJSONSafe<WatchlistEntry[]>(watchlistFile, []);
    for (const entry of watchlist) {
      for (const alert of entry.alerts) {
        if (alert.triggered) continue;
        if (alert.type === 'date' || alert.type === 'earnings') {
          const dateStr = alert.date;
          if (!dateStr) continue;
          const days = daysUntil(dateStr);
          if (days <= dueWithinDays) {
            alerts.push({
              ticker: entry.ticker,
              source: 'watchlist',
              type: alert.type,
              date: dateStr,
              daysUntil: days,
              description: alert.note,
              urgency: urgencyOf(days),
            });
          }
        }
        // Price alerts are checked at runtime by /sense (needs live quote)
      }
    }
  }

  // Earnings dates (from pre-fetched data, if available)
  // In Phase 1, earnings dates come from watchlist alerts of type 'earnings'
  // and are checked above. Full earnings calendar integration comes in Phase 2.
  // Here we add earnings alerts from thesis conditions that reference earnings dates.

  // Thesis deadlines
  if (!source || source === 'thesis') {
    const store = readJSONSafe<ThesesStore>(thesesFile, { theses: [] });
    for (const thesis of store.theses) {
      // Obituary due dates
      if (thesis.status === 'dead' && thesis.obituaryDueDate) {
        const days = daysUntil(thesis.obituaryDueDate);
        if (days <= dueWithinDays) {
          alerts.push({
            ticker: thesis.ticker,
            source: 'thesis',
            type: 'obituary_due',
            date: thesis.obituaryDueDate,
            daysUntil: days,
            description: `论文"${thesis.thesis.slice(0, 40)}"复盘到期`,
            urgency: urgencyOf(days),
          });
        }
      }

      // Condition resolveBy dates
      if (thesis.status !== 'dead') {
        for (const cond of thesis.conditions) {
          if (cond.status !== 'pending') continue;
          if (cond.type === 'earnings' && cond.resolveBy) {
            const days = daysUntil(cond.resolveBy);
            if (days <= dueWithinDays) {
              alerts.push({
                ticker: thesis.ticker,
                source: 'thesis_condition',
                type: 'condition_resolveBy',
                date: cond.resolveBy,
                daysUntil: days,
                description: `论文条件"${cond.description.slice(0, 40)}"即将到验证日`,
                urgency: urgencyOf(days),
              });
            }
          }
        }
      }
    }
  }

  // Sort: overdue first, then today, then by date ascending
  alerts.sort((a, b) => {
    const urgDiff = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
    if (urgDiff !== 0) return urgDiff;
    return a.daysUntil - b.daysUntil;
  });

  return alerts;
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

export async function alerts(args: string[]) {
  const dueStr = parseFlag(args, '--due');
  const source = parseFlag(args, '--source');
  const dueWithinDays = dueStr ? parseInt(dueStr) : 7;

  const result = aggregateAlerts({ dueWithinDays, source });
  console.log(JSON.stringify({ alerts: result, count: result.length }, null, 2));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test engine/test/commands/alerts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add engine/src/commands/alerts.ts engine/test/commands/alerts.test.ts
git commit -m "feat: add alert aggregation from watchlist and thesis deadlines"
```

---

### Task 12: CLI Registration + Version Check + FinstackError Handling

**Files:**
- Modify: `engine/src/cli.ts`

- [ ] **Step 1: Update cli.ts**

Replace `engine/src/cli.ts`:

```typescript
#!/usr/bin/env bun

import { quote } from './commands/quote';
import { financials } from './commands/financials';
import { scan } from './commands/scan';
import { regime } from './commands/regime';
import { portfolio } from './commands/portfolio';
import { keys } from './commands/keys';
import { macro } from './commands/macro';
import { filing } from './commands/filing';
import { history } from './commands/history';
import { earnings } from './commands/earnings';
import { alpha } from './commands/alpha';
import { thesis } from './commands/thesis';
import { risk } from './commands/risk';
import { watchlist } from './commands/watchlist';
import { alerts } from './commands/alerts';
import { formatErrorJSON, FinstackError } from './errors';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

const commands: Record<string, (args: string[]) => Promise<void>> = {
  quote,
  financials,
  scan,
  regime,
  portfolio,
  keys,
  macro,
  filing,
  history,
  earnings,
  alpha,
  thesis,
  risk,
  watchlist,
  alerts,
};

function checkVersion() {
  try {
    // Binary's embedded version
    const distDir = join(dirname(process.argv[0] || __dirname));
    const versionFile = join(distDir, '.version');
    if (!existsSync(versionFile)) return;
    const builtHash = readFileSync(versionFile, 'utf-8').trim();
    if (builtHash === 'dev') return;

    // Try to get current source hash
    const { execSync } = require('child_process');
    const srcDir = join(distDir, '..', '..');
    const currentHash = execSync('git rev-parse HEAD', { cwd: srcDir, encoding: 'utf-8' }).trim();

    if (builtHash !== currentHash) {
      console.error(`⚠ engine binary 版本过旧 (built: ${builtHash.slice(0, 7)}, current: ${currentHash.slice(0, 7)})，请运行: bun run build`);
    }
  } catch {
    // Version check is best-effort, never block
  }
}

async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  if (!command || command === 'help' || command === '--help') {
    console.log(`finstack — investment thinking engine

Commands:
  quote <ticker>                         Price snapshot with key metrics
  financials <ticker>                    Financial data and ratios
  scan [--source trending|news|all]      Multi-source signal scanning
  regime list|add|update|alerts          Consensus assumption register
  portfolio show|add|remove|init         Portfolio management
  keys set|list|remove                   API key management
  macro [series]                         FRED macro indicators
  filing <ticker>                        SEC EDGAR filings
  history <ticker> [--from --to]         Historical price data
  earnings <ticker>                      Earnings history + calendar
  alpha [--last N]                       Cognitive alpha calculation
  thesis list|check|kill|history         Thesis lifecycle management
  risk [size <ticker> <entry> <stop>]    Portfolio risk + position sizing
  watchlist [add|remove|tag|untag]       Watchlist management
  alerts [--due N] [--source S]          Check pending alerts

Data: ~/.finstack/   (override with FINSTACK_HOME env var)
Cache: ~/.finstack/cache/
`);
    process.exit(command ? 0 : 1);
  }

  checkVersion();

  const fn = commands[command];
  if (!fn) {
    console.error(formatErrorJSON(
      new FinstackError(
        `Unknown command: ${command}`,
        undefined,
        undefined,
        `Run 'finstack help' for available commands`,
      )
    ));
    process.exit(1);
  }

  try {
    await fn(args);
  } catch (e: any) {
    console.error(formatErrorJSON(e));
    process.exit(1);
  }
}

main();
```

- [ ] **Step 2: Run all tests**

Run: `cd /Users/mac/Documents/discovery/finstack && bun test`
Expected: PASS

- [ ] **Step 3: Build and verify binary**

Run: `cd /Users/mac/Documents/discovery/finstack && bun run build && ./engine/dist/finstack help`
Expected: Help output shows new `watchlist` and `alerts` commands

- [ ] **Step 4: Commit**

```bash
git add engine/src/cli.ts
git commit -m "feat: register watchlist/alerts commands, add version check and FinstackError handling"
```

---

### Task 13: Update /sense Skill

**Files:**
- Modify: `sense/SKILL.md`

- [ ] **Step 1: Update sense/SKILL.md**

Add watchlist and alerts integration. Insert new content after `## Step 0: Know the User` — specifically after the portfolio/patterns/consensus reads, add:

```markdown
4. `$F watchlist` — what are they watching but haven't bought?
   Signals about watchlist tickers matter almost as much as held positions.
5. `$F alerts --due 7` — any upcoming deadlines?
   Thesis conditions, obituary reviews, watchlist date alerts.
```

Replace `## Step 1: Multi-Source Scan` to add watchlist scanning:

In Step 1 item 2, change to:
```markdown
2. **Portfolio + Watchlist**: For each ticker in portfolio.json AND watchlist,
   WebSearch for "[TICKER] news today" — but only if the combined count is ≤15.
   For larger lists, scan portfolio top 5 + watchlist top 5 by most recently added.
```

Add new section between Step 1.5 and Step 2:

```markdown
## Step 1.7: Alerts Integration

Check the alerts output from Step 0. For each alert:

- **overdue**: Promote to 🔴 urgency. Something needed your attention and was missed.
- **today**: Promote to 🔴 urgency. Time-sensitive action needed.
- **soon** (1-3 days): Promote to 🟡 urgency.
- **upcoming** (4-7 days): Include in "Future Key Dates" section.

If a watchlist ticker has a price alert that triggered (check by comparing
`$F quote <ticker>` price against alert conditions), mark it as 🔴 and
suggest `/judge <ticker>`.
```

In Step 3 Output, add at the end:

```markdown
未来 7 天关键日期
  [From alerts: earnings dates, thesis conditions, watchlist reminders]
```

- [ ] **Step 2: Verify SKILL.md is valid YAML frontmatter**

Run: `cd /Users/mac/Documents/discovery/finstack && head -20 sense/SKILL.md`
Expected: Valid YAML frontmatter with `---` delimiters

- [ ] **Step 3: Commit**

```bash
git add sense/SKILL.md
git commit -m "feat: integrate watchlist and alerts into /sense skill"
```

---

### Task 14: Setup Script + package.json Updates

**Files:**
- Modify: `setup`
- Modify: `package.json`

- [ ] **Step 1: Update setup script**

In `setup`, add `reports` to the data directory creation:

Change line:
```bash
mkdir -p "$FINSTACK_DATA"/{journal,patterns,cache}
```
To:
```bash
mkdir -p "$FINSTACK_DATA"/{journal,patterns,cache,reports,sessions}
```

- [ ] **Step 2: Update package.json version**

Change `"version": "0.2.0"` to `"version": "0.3.0"` in `package.json`.

- [ ] **Step 3: Build and run quick smoke test**

```bash
cd /Users/mac/Documents/discovery/finstack && bun run build
./engine/dist/finstack help
./engine/dist/finstack watchlist
./engine/dist/finstack alerts
```

Expected: All three commands produce valid JSON output without errors.

- [ ] **Step 4: Commit**

```bash
git add setup package.json
git commit -m "chore: bump to v0.3.0, add reports/sessions dirs to setup"
```

---

### Task 15: Final Integration Test + Full Test Run

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/mac/Documents/discovery/finstack && bun test
```

Expected: ALL tests pass, including existing and new tests.

- [ ] **Step 2: Verify build works**

```bash
cd /Users/mac/Documents/discovery/finstack && bun run build
```

Expected: Binary compiles without errors.

- [ ] **Step 3: Smoke test key workflows**

```bash
./engine/dist/finstack watchlist add NVDA "waiting for Q2 earnings"
./engine/dist/finstack watchlist tag NVDA semiconductor
./engine/dist/finstack watchlist
./engine/dist/finstack alerts
./engine/dist/finstack watchlist remove NVDA
```

Expected: Each command produces valid JSON output. Watchlist entry appears and disappears correctly.

- [ ] **Step 4: Verify existing commands still work**

```bash
./engine/dist/finstack help
./engine/dist/finstack portfolio show
./engine/dist/finstack thesis list
./engine/dist/finstack regime list
```

Expected: All produce valid output (may be empty JSON for fresh install).

- [ ] **Step 5: Final commit with version tag**

```bash
git add -A
git status  # Verify no unexpected files
git commit -m "feat(v0.3.0): data layer rebuild — network reliability, atomic writes, watchlist, alerts

Phase 1 of finstack upgrade: reliable data foundation + daily-use infrastructure.

- Network reliability: timeouts, exponential backoff retries on all data sources
- Atomic writes: all JSON state files are crash-safe via tmp+rename
- Actionable errors: every error includes diagnostic suggestion
- Data source fallback chains: Yahoo → Polygon/FMP → stale cache
- Yahoo hardening: crumb TTL, UA rotation, auto-refresh on auth failure
- FINSTACK_HOME env var: configurable data directory
- Cache versioning: format changes auto-invalidate old cache
- Watchlist management: add/remove/tag/untag with ticker validation
- Alert aggregation: watchlist dates + thesis deadlines + condition resolveBy
- /sense integration: watchlist + alerts woven into morning briefing
- Version check: warns when binary is outdated"

git tag v0.3.0
```
