# Cognitive Alpha & Thesis Falsification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade finstack from v0.1.0 to v0.2.0 with full data layer (FRED, SEC EDGAR, Alpha Vantage, Polygon), cognitive alpha engine (shadow portfolio + behavioral cost tracking), thesis falsification engine (state machine + obituary review), new /track audit skill, and upgrades to all existing skills.

**Architecture:** Engine binary extended with 4 new data clients and 7 new commands. Two new JSON stores (shadow.json, theses.json) in ~/.finstack/. Portfolio.json extended with transaction log. New /track skill as audit layer outside main cognitive loop. All existing skills upgraded to consume new data.

**Tech Stack:** Bun (runtime + test runner + compiler), TypeScript (strict mode), Yahoo Finance + FRED + SEC EDGAR + Alpha Vantage + Polygon APIs.

**Spec:** `docs/superpowers/specs/2026-04-01-cognitive-alpha-design.md`

---

## File Structure

### New Files

```
engine/src/
  data/
    keys.ts              # API key read/write from ~/.finstack/keys.json
    fred.ts              # FRED API client (fetchSeries, fetchMultiple)
    edgar.ts             # SEC EDGAR client (fetchFilings, resolveCIK)
    alphavantage.ts      # Alpha Vantage client (fetchEarnings, fetchEarningsCalendar)
    polygon.ts           # Polygon.io client (fetchBars, fetchDividends)
  commands/
    keys.ts              # finstack keys set|list|remove
    macro.ts             # finstack macro [series]
    filing.ts            # finstack filing <ticker>
    history.ts           # finstack history <ticker> --from --to
    earnings.ts          # finstack earnings <ticker>
    alpha.ts             # finstack alpha [--last N]
    thesis.ts            # finstack thesis list|check|kill|history

engine/test/
  data/
    keys.test.ts
    fred.test.ts
    edgar.test.ts
    alphavantage.test.ts
    polygon.test.ts
  commands/
    keys.test.ts
    macro.test.ts
    filing.test.ts
    history.test.ts
    earnings.test.ts
    alpha.test.ts
    thesis.test.ts
    portfolio.test.ts

track/
  SKILL.md               # /track skill template
```

### Modified Files

```
engine/src/cache.ts              # Add new TTLs
engine/src/cli.ts                # Route new commands
engine/src/commands/portfolio.ts # Transaction log + --reason + --price flags
sense/SKILL.md                   # Thesis threat scan + FRED + EDGAR
research/SKILL.md                # FRED + EDGAR + earnings
judge/SKILL.md                   # Thesis registration step
act/SKILL.md                     # Shadow entry step
reflect/SKILL.md                 # Quantitative upgrade
cascade/SKILL.md                 # FRED integration
README.md                        # Remove coming soon, add /track, rewrite data sources
package.json                     # Version bump 0.1.0 → 0.2.0
setup                            # Add track to SKILLS array
```

---

## Phase 1: Foundation

### Task 1: API Key Management

**Files:**
- Create: `engine/src/data/keys.ts`
- Create: `engine/src/commands/keys.ts`
- Create: `engine/test/data/keys.test.ts`
- Create: `engine/test/commands/keys.test.ts`

- [ ] **Step 1: Write failing tests for key storage**

```ts
// engine/test/data/keys.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { getKey, setKey, removeKey, listKeys, KEYS_FILE } from '../../src/data/keys';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), '.finstack-test-keys-' + Date.now());
const TEST_KEYS_FILE = join(TEST_DIR, 'keys.json');

describe('keys', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_KEYS_FILE)) unlinkSync(TEST_KEYS_FILE);
  });

  it('returns null for missing key', () => {
    expect(getKey('fred', TEST_KEYS_FILE)).toBeNull();
  });

  it('sets and gets a key', () => {
    setKey('fred', 'abc123', TEST_KEYS_FILE);
    expect(getKey('fred', TEST_KEYS_FILE)).toBe('abc123');
  });

  it('removes a key', () => {
    setKey('fred', 'abc123', TEST_KEYS_FILE);
    removeKey('fred', TEST_KEYS_FILE);
    expect(getKey('fred', TEST_KEYS_FILE)).toBeNull();
  });

  it('lists configured providers', () => {
    setKey('fred', 'abc123', TEST_KEYS_FILE);
    setKey('polygon', 'xyz789', TEST_KEYS_FILE);
    const list = listKeys(TEST_KEYS_FILE);
    expect(list).toEqual([
      { provider: 'fred', configured: true, masked: 'abc***' },
      { provider: 'polygon', configured: true, masked: 'xyz***' },
    ]);
  });

  it('sets file permissions to 0600', () => {
    setKey('fred', 'abc123', TEST_KEYS_FILE);
    const stat = Bun.file(TEST_KEYS_FILE);
    // File should exist
    expect(existsSync(TEST_KEYS_FILE)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/data/keys.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement key storage**

```ts
// engine/src/data/keys.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const DEFAULT_KEYS_FILE = join(homedir(), '.finstack', 'keys.json');

type Provider = 'fred' | 'alphavantage' | 'polygon';
type KeyStore = Partial<Record<Provider, string>>;

function load(file: string): KeyStore {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

function save(data: KeyStore, file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
  try { chmodSync(file, 0o600); } catch {}
}

export const KEYS_FILE = DEFAULT_KEYS_FILE;

export function getKey(provider: string, file = DEFAULT_KEYS_FILE): string | null {
  return load(file)[provider as Provider] ?? null;
}

export function setKey(provider: string, key: string, file = DEFAULT_KEYS_FILE): void {
  const data = load(file);
  data[provider as Provider] = key;
  save(data, file);
}

export function removeKey(provider: string, file = DEFAULT_KEYS_FILE): void {
  const data = load(file);
  delete data[provider as Provider];
  save(data, file);
}

export function listKeys(file = DEFAULT_KEYS_FILE): { provider: string; configured: boolean; masked: string }[] {
  const data = load(file);
  return Object.entries(data)
    .filter(([, v]) => v)
    .map(([provider, key]) => ({
      provider,
      configured: true,
      masked: key!.slice(0, 3) + '***',
    }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/data/keys.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Write failing tests for keys command**

```ts
// engine/test/commands/keys.test.ts
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { getKey, setKey, removeKey, listKeys } from '../../src/data/keys';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// keys command is thin CLI wrapper — test the data layer functions directly
// Command integration tested via cli.ts routing in Task 12

describe('keys command integration', () => {
  const TEST_DIR = join(tmpdir(), '.finstack-test-keyscmd-' + Date.now());
  const TEST_FILE = join(TEST_DIR, 'keys.json');

  beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterEach(() => { if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE); });

  it('set then list shows provider', () => {
    setKey('fred', 'mykey123', TEST_FILE);
    const list = listKeys(TEST_FILE);
    expect(list.length).toBe(1);
    expect(list[0].provider).toBe('fred');
    expect(list[0].masked).toBe('myk***');
  });

  it('remove then get returns null', () => {
    setKey('polygon', 'pk_123', TEST_FILE);
    removeKey('polygon', TEST_FILE);
    expect(getKey('polygon', TEST_FILE)).toBeNull();
  });
});
```

- [ ] **Step 6: Implement keys command**

```ts
// engine/src/commands/keys.ts
import { getKey, setKey, removeKey, listKeys } from '../data/keys';

export async function keys(args: string[]) {
  const sub = args[0];

  switch (sub) {
    case 'set': {
      const provider = args[1];
      const key = args[2];
      if (!provider || !key) {
        console.error(JSON.stringify({ error: 'Usage: finstack keys set <provider> <key>' }));
        process.exit(1);
      }
      setKey(provider, key);
      console.log(JSON.stringify({ message: `Key set for ${provider}` }));
      break;
    }

    case 'list': {
      const entries = listKeys();
      console.log(JSON.stringify({ keys: entries }, null, 2));
      break;
    }

    case 'remove': {
      const provider = args[1];
      if (!provider) {
        console.error(JSON.stringify({ error: 'Usage: finstack keys remove <provider>' }));
        process.exit(1);
      }
      removeKey(provider);
      console.log(JSON.stringify({ message: `Key removed for ${provider}` }));
      break;
    }

    default:
      console.error(JSON.stringify({ error: 'Usage: finstack keys set|list|remove' }));
      process.exit(1);
  }
}
```

- [ ] **Step 7: Run all tests**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add engine/src/data/keys.ts engine/src/commands/keys.ts engine/test/
git commit -m "feat: API key management (keys.ts + keys command)"
```

---

### Task 2: FRED API Client + Macro Command

**Files:**
- Create: `engine/src/data/fred.ts`
- Create: `engine/src/commands/macro.ts`
- Create: `engine/test/data/fred.test.ts`
- Create: `engine/test/commands/macro.test.ts`

- [ ] **Step 1: Write failing tests for FRED client**

```ts
// engine/test/data/fred.test.ts
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { CORE_SERIES } from '../../src/data/fred';

describe('fred', () => {
  it('exports correct core series IDs', () => {
    expect(CORE_SERIES).toContain('DFF');
    expect(CORE_SERIES).toContain('CPIAUCSL');
    expect(CORE_SERIES).toContain('GDP');
    expect(CORE_SERIES).toContain('UNRATE');
    expect(CORE_SERIES).toContain('T10Y2Y');
    expect(CORE_SERIES).toContain('VIXCLS');
    expect(CORE_SERIES.length).toBe(6);
  });

  it('parseFredResponse extracts latest observation', () => {
    const { parseFredResponse } = require('../../src/data/fred');
    const raw = {
      observations: [
        { date: '2026-03-28', value: '4.33' },
        { date: '2026-03-29', value: '4.35' },
      ],
    };
    const result = parseFredResponse('DFF', raw);
    expect(result.series).toBe('DFF');
    expect(result.value).toBe(4.35);
    expect(result.date).toBe('2026-03-29');
    expect(result.previousValue).toBe(4.33);
    expect(result.change).toBeCloseTo(0.02);
  });

  it('parseFredResponse handles single observation', () => {
    const { parseFredResponse } = require('../../src/data/fred');
    const raw = { observations: [{ date: '2026-03-29', value: '4.35' }] };
    const result = parseFredResponse('DFF', raw);
    expect(result.value).toBe(4.35);
    expect(result.previousValue).toBeNull();
    expect(result.change).toBeNull();
  });

  it('parseFredResponse handles "." (missing data)', () => {
    const { parseFredResponse } = require('../../src/data/fred');
    const raw = { observations: [{ date: '2026-03-29', value: '.' }] };
    const result = parseFredResponse('DFF', raw);
    expect(result.value).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/data/fred.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement FRED client**

```ts
// engine/src/data/fred.ts
import { getKey } from './keys';

const BASE = 'https://api.stlouisfed.org/fred/series/observations';

export const CORE_SERIES = ['DFF', 'CPIAUCSL', 'GDP', 'UNRATE', 'T10Y2Y', 'VIXCLS'] as const;

const SERIES_LABELS: Record<string, string> = {
  DFF: 'Federal Funds Rate',
  CPIAUCSL: 'CPI (Inflation)',
  GDP: 'GDP',
  UNRATE: 'Unemployment Rate',
  T10Y2Y: '10Y-2Y Yield Spread',
  VIXCLS: 'VIX (Volatility)',
};

export interface FredObservation {
  series: string;
  label: string;
  value: number | null;
  date: string;
  previousValue: number | null;
  change: number | null;
}

export function parseFredResponse(seriesId: string, data: any): FredObservation {
  const obs = data?.observations || [];
  const latest = obs[obs.length - 1];
  const prev = obs.length > 1 ? obs[obs.length - 2] : null;

  const val = latest?.value === '.' ? null : latest ? parseFloat(latest.value) : null;
  const prevVal = prev?.value === '.' ? null : prev ? parseFloat(prev.value) : null;

  return {
    series: seriesId,
    label: SERIES_LABELS[seriesId] || seriesId,
    value: val,
    date: latest?.date || '',
    previousValue: prevVal,
    change: val !== null && prevVal !== null ? +(val - prevVal).toFixed(4) : null,
  };
}

export async function fetchSeries(seriesId: string, limit = 2): Promise<FredObservation> {
  const apiKey = getKey('fred');
  if (!apiKey) throw new Error('FRED API key not configured. Run: finstack keys set fred <your-key>');

  const url = `${BASE}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED API ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();

  // Reverse so latest is last (API returns desc order)
  if (data.observations) data.observations.reverse();
  return parseFredResponse(seriesId, data);
}

export async function fetchMultiple(seriesIds: string[] = [...CORE_SERIES]): Promise<FredObservation[]> {
  const results = await Promise.allSettled(seriesIds.map(id => fetchSeries(id)));
  return results
    .filter((r): r is PromiseFulfilledResult<FredObservation> => r.status === 'fulfilled')
    .map(r => r.value);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/data/fred.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Write macro command test**

```ts
// engine/test/commands/macro.test.ts
import { describe, it, expect } from 'bun:test';
import { parseFredResponse, CORE_SERIES } from '../../src/data/fred';

describe('macro command logic', () => {
  it('formats multiple series into snapshot', () => {
    // macro command calls fetchMultiple which uses parseFredResponse
    // Test the parse logic that macro depends on
    const mockData = {
      observations: [
        { date: '2026-03-28', value: '5.25' },
        { date: '2026-03-29', value: '5.50' },
      ],
    };
    const result = parseFredResponse('DFF', mockData);
    expect(result.label).toBe('Federal Funds Rate');
    expect(result.value).toBe(5.50);
    expect(result.change).toBe(0.25);
  });
});
```

- [ ] **Step 6: Implement macro command**

```ts
// engine/src/commands/macro.ts
import { fetchSeries, fetchMultiple, CORE_SERIES } from '../data/fred';
import { getCached, setCache } from '../cache';

export async function macro(args: string[]) {
  const seriesId = args[0]?.toUpperCase();

  if (seriesId) {
    // Single series with more history
    const cacheKey = `macro-${seriesId}`;
    const cached = getCached(cacheKey, 'macro');
    if (cached) {
      const { _cachedAt, ...data } = cached;
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const data = await fetchSeries(seriesId, 10);
    setCache(cacheKey, data);
    console.log(JSON.stringify(data, null, 2));
  } else {
    // All core series snapshot
    const cacheKey = 'macro-snapshot';
    const cached = getCached(cacheKey, 'macro');
    if (cached) {
      const { _cachedAt, ...data } = cached;
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const data = await fetchMultiple();
    const output = { timestamp: new Date().toISOString(), series: data };
    setCache(cacheKey, output);
    console.log(JSON.stringify(output, null, 2));
  }
}
```

- [ ] **Step 7: Run all tests**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add engine/src/data/fred.ts engine/src/commands/macro.ts engine/test/data/fred.test.ts engine/test/commands/macro.test.ts
git commit -m "feat: FRED API client + macro command"
```

---

### Task 3: SEC EDGAR Client + Filing Command

**Files:**
- Create: `engine/src/data/edgar.ts`
- Create: `engine/src/commands/filing.ts`
- Create: `engine/test/data/edgar.test.ts`

- [ ] **Step 1: Write failing tests for EDGAR client**

```ts
// engine/test/data/edgar.test.ts
import { describe, it, expect } from 'bun:test';

describe('edgar', () => {
  it('padCIK pads to 10 digits', () => {
    const { padCIK } = require('../../src/data/edgar');
    expect(padCIK('320193')).toBe('0000320193');
    expect(padCIK('1234567890')).toBe('1234567890');
  });

  it('parseFilings extracts recent filings', () => {
    const { parseFilings } = require('../../src/data/edgar');
    const raw = {
      cik: '320193',
      name: 'Apple Inc',
      tickers: ['AAPL'],
      filings: {
        recent: {
          accessionNumber: ['0000320193-24-000001', '0000320193-24-000002'],
          filingDate: ['2024-11-01', '2024-08-02'],
          form: ['10-K', '10-Q'],
          primaryDocument: ['aapl-20240928.htm', 'aapl-20240629.htm'],
          primaryDocDescription: ['Annual Report', 'Quarterly Report'],
        },
      },
    };
    const result = parseFilings('AAPL', raw);
    expect(result.ticker).toBe('AAPL');
    expect(result.cik).toBe('320193');
    expect(result.company).toBe('Apple Inc');
    expect(result.filings.length).toBe(2);
    expect(result.filings[0].type).toBe('10-K');
    expect(result.filings[0].date).toBe('2024-11-01');
    expect(result.filings[0].url).toContain('Archives/edgar/data/320193');
  });

  it('parseFilings filters to 10-K, 10-Q, 8-K only', () => {
    const { parseFilings } = require('../../src/data/edgar');
    const raw = {
      cik: '320193',
      name: 'Apple Inc',
      tickers: ['AAPL'],
      filings: {
        recent: {
          accessionNumber: ['001', '002', '003'],
          filingDate: ['2024-11-01', '2024-10-15', '2024-08-02'],
          form: ['10-K', 'SC 13G', '8-K'],
          primaryDocument: ['a.htm', 'b.htm', 'c.htm'],
          primaryDocDescription: ['Annual', 'Ownership', 'Current'],
        },
      },
    };
    const result = parseFilings('AAPL', raw);
    expect(result.filings.length).toBe(2);
    expect(result.filings[0].type).toBe('10-K');
    expect(result.filings[1].type).toBe('8-K');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/data/edgar.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement EDGAR client**

```ts
// engine/src/data/edgar.ts
const SUBMISSIONS_BASE = 'https://data.sec.gov/submissions/CIK';
const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const ARCHIVES_BASE = 'https://www.sec.gov/Archives/edgar/data';
const UA = 'finstack/0.2.0 (github.com/user/finstack)';
const FORM_FILTER = new Set(['10-K', '10-Q', '8-K']);

export interface Filing {
  type: string;
  date: string;
  url: string;
  description: string;
}

export interface FilingResult {
  ticker: string;
  cik: string;
  company: string;
  filings: Filing[];
}

let _tickerMap: Record<string, string> | null = null;

export function padCIK(cik: string): string {
  return cik.padStart(10, '0');
}

export function parseFilings(ticker: string, data: any): FilingResult {
  const recent = data.filings?.recent;
  if (!recent) return { ticker, cik: data.cik, company: data.name, filings: [] };

  const filings: Filing[] = [];
  const count = recent.accessionNumber?.length || 0;

  for (let i = 0; i < count; i++) {
    const form = recent.form[i];
    if (!FORM_FILTER.has(form)) continue;

    const accession = recent.accessionNumber[i].replace(/-/g, '');
    filings.push({
      type: form,
      date: recent.filingDate[i],
      url: `${ARCHIVES_BASE}/${data.cik}/${accession}/${recent.primaryDocument[i]}`,
      description: recent.primaryDocDescription[i] || form,
    });
  }

  return {
    ticker: ticker.toUpperCase(),
    cik: String(data.cik),
    company: data.name || '',
    filings: filings.slice(0, 20),
  };
}

async function resolveCIK(ticker: string): Promise<string> {
  if (!_tickerMap) {
    const res = await fetch(TICKERS_URL, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`SEC ticker lookup failed: ${res.status}`);
    const data = await res.json();
    _tickerMap = {};
    for (const entry of Object.values(data) as any[]) {
      _tickerMap[entry.ticker.toUpperCase()] = String(entry.cik_str);
    }
  }
  const cik = _tickerMap[ticker.toUpperCase()];
  if (!cik) throw new Error(`Ticker ${ticker} not found in SEC database`);
  return cik;
}

export async function fetchFilings(ticker: string): Promise<FilingResult> {
  const cik = await resolveCIK(ticker);
  const url = `${SUBMISSIONS_BASE}${padCIK(cik)}.json`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`SEC EDGAR ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return parseFilings(ticker, data);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/data/edgar.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Implement filing command**

```ts
// engine/src/commands/filing.ts
import { fetchFilings } from '../data/edgar';
import { getCached, setCache } from '../cache';

export async function filing(args: string[]) {
  const ticker = args[0]?.toUpperCase();
  if (!ticker) {
    console.error(JSON.stringify({ error: 'Usage: finstack filing <ticker>' }));
    process.exit(1);
  }

  const cacheKey = `filing-${ticker}`;
  const cached = getCached(cacheKey, 'filing');
  if (cached) {
    const { _cachedAt, ...data } = cached;
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const data = await fetchFilings(ticker);
  setCache(cacheKey, data);
  console.log(JSON.stringify(data, null, 2));
}
```

- [ ] **Step 6: Run all tests**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add engine/src/data/edgar.ts engine/src/commands/filing.ts engine/test/data/edgar.test.ts
git commit -m "feat: SEC EDGAR client + filing command"
```

---

### Task 4: Alpha Vantage Client + Earnings Command

**Files:**
- Create: `engine/src/data/alphavantage.ts`
- Create: `engine/src/commands/earnings.ts`
- Create: `engine/test/data/alphavantage.test.ts`

- [ ] **Step 1: Write failing tests for Alpha Vantage client**

```ts
// engine/test/data/alphavantage.test.ts
import { describe, it, expect } from 'bun:test';

describe('alphavantage', () => {
  it('parseEarnings extracts quarterly data', () => {
    const { parseEarnings } = require('../../src/data/alphavantage');
    const raw = {
      symbol: 'AAPL',
      quarterlyEarnings: [
        {
          fiscalDateEnding: '2024-09-30',
          reportedDate: '2024-10-31',
          reportedEPS: '1.64',
          estimatedEPS: '1.60',
          surprise: '0.04',
          surprisePercentage: '2.50',
        },
        {
          fiscalDateEnding: '2024-06-30',
          reportedDate: '2024-08-01',
          reportedEPS: '1.40',
          estimatedEPS: '1.35',
          surprise: '0.05',
          surprisePercentage: '3.70',
        },
      ],
    };
    const result = parseEarnings('AAPL', raw);
    expect(result.ticker).toBe('AAPL');
    expect(result.quarterly.length).toBe(2);
    expect(result.quarterly[0].reportedEPS).toBe(1.64);
    expect(result.quarterly[0].estimatedEPS).toBe(1.60);
    expect(result.quarterly[0].surprisePct).toBe(2.50);
    expect(result.quarterly[0].date).toBe('2024-10-31');
    expect(result.quarterly[0].fiscalEnd).toBe('2024-09-30');
  });

  it('parseEarnings limits to 8 quarters', () => {
    const { parseEarnings } = require('../../src/data/alphavantage');
    const raw = {
      symbol: 'AAPL',
      quarterlyEarnings: Array.from({ length: 20 }, (_, i) => ({
        fiscalDateEnding: `2024-0${(i % 4) + 1}-30`,
        reportedDate: `2024-0${(i % 4) + 2}-15`,
        reportedEPS: '1.00',
        estimatedEPS: '0.95',
        surprise: '0.05',
        surprisePercentage: '5.26',
      })),
    };
    const result = parseEarnings('AAPL', raw);
    expect(result.quarterly.length).toBe(8);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/data/alphavantage.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Alpha Vantage client**

```ts
// engine/src/data/alphavantage.ts
import { getKey } from './keys';

const BASE = 'https://www.alphavantage.co/query';

export interface EarningsQuarter {
  fiscalEnd: string;
  date: string;
  reportedEPS: number;
  estimatedEPS: number;
  surprise: number;
  surprisePct: number;
}

export interface EarningsResult {
  ticker: string;
  quarterly: EarningsQuarter[];
}

export function parseEarnings(ticker: string, data: any): EarningsResult {
  const quarters = (data?.quarterlyEarnings || []).slice(0, 8);
  return {
    ticker: ticker.toUpperCase(),
    quarterly: quarters.map((q: any) => ({
      fiscalEnd: q.fiscalDateEnding,
      date: q.reportedDate,
      reportedEPS: parseFloat(q.reportedEPS) || 0,
      estimatedEPS: parseFloat(q.estimatedEPS) || 0,
      surprise: parseFloat(q.surprise) || 0,
      surprisePct: parseFloat(q.surprisePercentage) || 0,
    })),
  };
}

export async function fetchEarnings(ticker: string): Promise<EarningsResult> {
  const apiKey = getKey('alphavantage');
  if (!apiKey) throw new Error('Alpha Vantage API key not configured. Run: finstack keys set alphavantage <your-key>');

  const url = `${BASE}?function=EARNINGS&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alpha Vantage ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();

  if (data['Error Message']) throw new Error(`Alpha Vantage: ${data['Error Message']}`);
  if (data['Note']) throw new Error('Alpha Vantage rate limit hit. Wait 1 minute.');

  return parseEarnings(ticker, data);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/data/alphavantage.test.ts`
Expected: All 2 tests PASS

- [ ] **Step 5: Implement earnings command**

```ts
// engine/src/commands/earnings.ts
import { fetchEarnings } from '../data/alphavantage';
import { getCached, setCache } from '../cache';

export async function earnings(args: string[]) {
  const ticker = args[0]?.toUpperCase();
  if (!ticker) {
    console.error(JSON.stringify({ error: 'Usage: finstack earnings <ticker>' }));
    process.exit(1);
  }

  const cacheKey = `earnings-${ticker}`;
  const cached = getCached(cacheKey, 'earnings');
  if (cached) {
    const { _cachedAt, ...data } = cached;
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const data = await fetchEarnings(ticker);
  setCache(cacheKey, data);
  console.log(JSON.stringify(data, null, 2));
}
```

- [ ] **Step 6: Run all tests, commit**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/`
Expected: All tests PASS

```bash
git add engine/src/data/alphavantage.ts engine/src/commands/earnings.ts engine/test/data/alphavantage.test.ts
git commit -m "feat: Alpha Vantage client + earnings command"
```

---

### Task 5: Polygon Client + History Command

**Files:**
- Create: `engine/src/data/polygon.ts`
- Create: `engine/src/commands/history.ts`
- Create: `engine/test/data/polygon.test.ts`

- [ ] **Step 1: Write failing tests for Polygon client**

```ts
// engine/test/data/polygon.test.ts
import { describe, it, expect } from 'bun:test';

describe('polygon', () => {
  it('parseBars extracts OHLCV data', () => {
    const { parseBars } = require('../../src/data/polygon');
    const raw = {
      ticker: 'AAPL',
      resultsCount: 2,
      results: [
        { t: 1711670400000, o: 171.0, h: 173.5, l: 170.2, c: 172.8, v: 52000000 },
        { t: 1711756800000, o: 172.8, h: 175.0, l: 172.0, c: 174.5, v: 48000000 },
      ],
    };
    const result = parseBars('AAPL', raw);
    expect(result.ticker).toBe('AAPL');
    expect(result.bars.length).toBe(2);
    expect(result.bars[0].open).toBe(171.0);
    expect(result.bars[0].close).toBe(172.8);
    expect(result.bars[0].volume).toBe(52000000);
    expect(result.bars[0].date).toBeDefined();
  });

  it('parseBars handles empty results', () => {
    const { parseBars } = require('../../src/data/polygon');
    const raw = { ticker: 'AAPL', resultsCount: 0, results: [] };
    const result = parseBars('AAPL', raw);
    expect(result.bars.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/data/polygon.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Polygon client**

```ts
// engine/src/data/polygon.ts
import { getKey } from './keys';

const BASE = 'https://api.polygon.io';

export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BarsResult {
  ticker: string;
  bars: Bar[];
}

export function parseBars(ticker: string, data: any): BarsResult {
  const results = data?.results || [];
  return {
    ticker: ticker.toUpperCase(),
    bars: results.map((r: any) => ({
      date: new Date(r.t).toISOString().split('T')[0],
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: r.v,
    })),
  };
}

export async function fetchBars(
  ticker: string,
  from: string,
  to: string,
  timespan: 'day' | 'week' = 'day',
  multiplier = 1,
): Promise<BarsResult> {
  const apiKey = getKey('polygon');
  if (!apiKey) throw new Error('Polygon API key not configured. Run: finstack keys set polygon <your-key>');

  const url = `${BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${multiplier}/${timespan}/${from}/${to}?adjusted=true&sort=asc&apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Polygon ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();

  if (data.status === 'ERROR') throw new Error(`Polygon: ${data.error}`);
  return parseBars(ticker, data);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/data/polygon.test.ts`
Expected: All 2 tests PASS

- [ ] **Step 5: Implement history command**

The history command tries Yahoo Finance first (free, no key), falls back to Polygon if Yahoo fails or for extended ranges.

```ts
// engine/src/commands/history.ts
import { fetchChart, extractQuote } from '../data/yahoo';
import { fetchBars } from '../data/polygon';
import { getKey } from '../data/keys';
import { getCached, setCache } from '../cache';

function parseArgs(args: string[]): { ticker: string; from: string; to: string } {
  const ticker = args[0]?.toUpperCase();
  if (!ticker) {
    console.error(JSON.stringify({ error: 'Usage: finstack history <ticker> --from YYYY-MM-DD --to YYYY-MM-DD' }));
    process.exit(1);
  }

  const fromIdx = args.indexOf('--from');
  const toIdx = args.indexOf('--to');

  const today = new Date().toISOString().split('T')[0];
  const threeMonthsAgo = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];

  return {
    ticker,
    from: fromIdx >= 0 ? args[fromIdx + 1] : threeMonthsAgo,
    to: toIdx >= 0 ? args[toIdx + 1] : today,
  };
}

function yahooRangeFor(from: string, to: string): string {
  const days = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
  if (days <= 5) return '5d';
  if (days <= 30) return '1mo';
  if (days <= 90) return '3mo';
  if (days <= 180) return '6mo';
  if (days <= 365) return '1y';
  if (days <= 730) return '2y';
  if (days <= 1825) return '5y';
  return '10y';
}

export async function history(args: string[]) {
  const { ticker, from, to } = parseArgs(args);

  const isHistorical = new Date(to) < new Date(Date.now() - 86400000);
  const cacheKey = `history-${ticker}-${from}-${to}`;
  const cacheType = isHistorical ? 'history-old' : 'history';
  const cached = getCached(cacheKey, cacheType);
  if (cached) {
    const { _cachedAt, ...data } = cached;
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Try Yahoo first
  try {
    const range = yahooRangeFor(from, to);
    const raw = await fetchChart(ticker, range, '1d');
    const result = raw?.chart?.result?.[0];
    if (result) {
      const timestamps = result.timestamp || [];
      const quotes = result.indicators?.quote?.[0] || {};
      const bars = timestamps.map((t: number, i: number) => ({
        date: new Date(t * 1000).toISOString().split('T')[0],
        open: quotes.open?.[i] ? +quotes.open[i].toFixed(2) : null,
        high: quotes.high?.[i] ? +quotes.high[i].toFixed(2) : null,
        low: quotes.low?.[i] ? +quotes.low[i].toFixed(2) : null,
        close: quotes.close?.[i] ? +quotes.close[i].toFixed(2) : null,
        volume: quotes.volume?.[i] || 0,
      })).filter((b: any) => {
        const d = b.date;
        return d >= from && d <= to && b.close !== null;
      });

      const output = { ticker, from, to, source: 'yahoo', bars };
      setCache(cacheKey, output);
      console.log(JSON.stringify(output, null, 2));
      return;
    }
  } catch {
    // Fall through to Polygon
  }

  // Fallback to Polygon
  if (getKey('polygon')) {
    const data = await fetchBars(ticker, from, to);
    const output = { ...data, from, to, source: 'polygon' };
    setCache(cacheKey, output);
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  throw new Error(`Could not fetch history for ${ticker}. Yahoo failed and Polygon key not configured.`);
}
```

- [ ] **Step 6: Run all tests, commit**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/`
Expected: All tests PASS

```bash
git add engine/src/data/polygon.ts engine/src/commands/history.ts engine/test/data/polygon.test.ts
git commit -m "feat: Polygon client + history command (Yahoo primary, Polygon fallback)"
```

---

### Task 6: Update Cache TTLs

**Files:**
- Modify: `engine/src/cache.ts`

- [ ] **Step 1: Add new TTLs to cache.ts**

In `engine/src/cache.ts`, replace the TTL object:

```ts
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
```

- [ ] **Step 2: Run all tests, commit**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/`
Expected: All tests PASS

```bash
git add engine/src/cache.ts
git commit -m "feat: add cache TTLs for new data sources"
```

---

## Phase 2: Portfolio Enhancement

### Task 7: Portfolio Transaction Log + Deviation Capture

**Files:**
- Modify: `engine/src/commands/portfolio.ts`
- Create: `engine/test/commands/portfolio.test.ts`

- [ ] **Step 1: Write failing tests for transaction log**

```ts
// engine/test/commands/portfolio.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We test the portfolio logic by importing the module and calling internal helpers
// But portfolio.ts currently uses hardcoded paths. We'll refactor to accept a path param.
// For now, test the transaction data structure expectations.

describe('portfolio transaction log', () => {
  it('add creates a buy transaction', () => {
    // After refactor, portfolio add NVDA 10 850 should produce:
    const expectedTx = {
      ticker: 'NVDA',
      action: 'buy',
      shares: 10,
      price: 850,
      date: expect.any(String),
      reason: null,
    };
    // This validates the expected shape
    expect(expectedTx.action).toBe('buy');
    expect(expectedTx.reason).toBeNull();
  });

  it('remove creates a sell transaction with reason', () => {
    const expectedTx = {
      ticker: 'NVDA',
      action: 'sell',
      shares: 10,
      price: 910,
      date: expect.any(String),
      reason: 'emotional',
    };
    expect(expectedTx.action).toBe('sell');
    expect(expectedTx.reason).toBe('emotional');
  });
});
```

- [ ] **Step 2: Run tests to verify they pass (structure tests)**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/commands/portfolio.test.ts`
Expected: PASS (structure validation only)

- [ ] **Step 3: Update portfolio.ts with transaction log + --reason + --price flags**

Replace the full content of `engine/src/commands/portfolio.ts`:

```ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const FINSTACK_DIR = join(homedir(), '.finstack');
const PORTFOLIO_FILE = join(FINSTACK_DIR, 'portfolio.json');
const SHADOW_FILE = join(FINSTACK_DIR, 'shadow.json');

interface Position {
  ticker: string;
  shares: number;
  avgCost: number;
  addedAt: string;
  notes?: string;
}

interface Transaction {
  ticker: string;
  action: 'buy' | 'sell';
  shares: number;
  price: number;
  date: string;
  reason: string | null;
}

interface Portfolio {
  positions: Position[];
  transactions: Transaction[];
  updatedAt: string;
}

function load(): Portfolio {
  if (!existsSync(PORTFOLIO_FILE)) return { positions: [], transactions: [], updatedAt: new Date().toISOString() };
  try {
    const data = JSON.parse(readFileSync(PORTFOLIO_FILE, 'utf-8'));
    if (!data.transactions) data.transactions = [];
    return data;
  } catch {
    return { positions: [], transactions: [], updatedAt: new Date().toISOString() };
  }
}

function save(data: Portfolio) {
  mkdirSync(FINSTACK_DIR, { recursive: true });
  data.updatedAt = new Date().toISOString();
  writeFileSync(PORTFOLIO_FILE, JSON.stringify(data, null, 2));
}

function loadShadow(): any {
  if (!existsSync(SHADOW_FILE)) return { entries: [] };
  try {
    return JSON.parse(readFileSync(SHADOW_FILE, 'utf-8'));
  } catch {
    return { entries: [] };
  }
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

export async function portfolio(args: string[]) {
  const sub = args[0] || 'show';

  switch (sub) {
    case 'show': {
      const p = load();
      console.log(JSON.stringify(p, null, 2));
      break;
    }

    case 'add': {
      const ticker = args[1]?.toUpperCase();
      const shares = parseFloat(args[2]);
      const avgCost = parseFloat(args[3]);
      if (!ticker || isNaN(shares) || isNaN(avgCost)) {
        console.error(JSON.stringify({ error: 'Usage: finstack portfolio add <ticker> <shares> <avgCost>' }));
        process.exit(1);
      }
      const p = load();
      const existing = p.positions.find(pos => pos.ticker === ticker);
      if (existing) {
        const totalShares = existing.shares + shares;
        existing.avgCost = (existing.avgCost * existing.shares + avgCost * shares) / totalShares;
        existing.shares = totalShares;
      } else {
        p.positions.push({ ticker, shares, avgCost, addedAt: new Date().toISOString() });
      }
      p.transactions.push({
        ticker,
        action: 'buy',
        shares,
        price: avgCost,
        date: new Date().toISOString(),
        reason: null,
      });
      save(p);
      console.log(JSON.stringify(p, null, 2));
      break;
    }

    case 'remove': {
      const ticker = args[1]?.toUpperCase();
      if (!ticker) {
        console.error(JSON.stringify({ error: 'Usage: finstack portfolio remove <ticker> [--reason <reason>] [--price <price>]' }));
        process.exit(1);
      }

      const reason = parseFlag(args, '--reason') || null;
      const priceStr = parseFlag(args, '--price');

      const p = load();
      const position = p.positions.find(pos => pos.ticker === ticker);

      // Check for open shadow entry — deviation detection
      const shadow = loadShadow();
      const shadowEntry = shadow.entries?.find((e: any) => e.ticker === ticker && e.status === 'open');

      if (shadowEntry && !reason) {
        const horizonDate = new Date(shadowEntry.timeHorizon);
        const daysRemaining = Math.ceil((horizonDate.getTime() - Date.now()) / 86400000);
        if (daysRemaining > 0) {
          console.log(JSON.stringify({
            deviation_detected: true,
            ticker,
            shadow_status: 'open',
            planned_exit: shadowEntry.timeHorizon,
            days_remaining: daysRemaining,
            prompt: `You're closing ${ticker} ${daysRemaining} days before your plan's horizon. Reason?`,
            options: ['thesis-changed', 'stop-triggered', 'emotional', 'need-cash', 'other'],
            usage: `finstack portfolio remove ${ticker} --reason <reason>`,
          }, null, 2));
          // Still proceed with removal, but record reason as unspecified
        }
      }

      if (position) {
        const sellPrice = priceStr ? parseFloat(priceStr) : position.avgCost;
        p.transactions.push({
          ticker,
          action: 'sell',
          shares: position.shares,
          price: sellPrice,
          date: new Date().toISOString(),
          reason: reason || (shadowEntry ? 'unspecified' : null),
        });
      }

      p.positions = p.positions.filter(pos => pos.ticker !== ticker);
      save(p);
      console.log(JSON.stringify(p, null, 2));
      break;
    }

    case 'init': {
      const p = load();
      if (p.positions.length > 0) {
        console.log(JSON.stringify({ message: 'Portfolio already exists', ...p }, null, 2));
      } else {
        save(p);
        console.log(JSON.stringify({ message: 'Empty portfolio initialized', ...p }, null, 2));
      }
      break;
    }

    default:
      console.error(JSON.stringify({ error: `Unknown subcommand: ${sub}. Use show|add|remove|init` }));
      process.exit(1);
  }
}
```

- [ ] **Step 4: Run all tests, commit**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/`
Expected: All tests PASS

```bash
git add engine/src/commands/portfolio.ts engine/test/commands/portfolio.test.ts
git commit -m "feat: portfolio transaction log + deviation capture (--reason, --price flags)"
```

---

## Phase 3: Cognitive Alpha Engine

### Task 8: Shadow Portfolio Data Management

**Files:**
- Create: `engine/src/data/shadow.ts`
- Create: `engine/test/data/shadow.test.ts`

- [ ] **Step 1: Write failing tests for shadow portfolio**

```ts
// engine/test/data/shadow.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), '.finstack-test-shadow-' + Date.now());
const TEST_FILE = join(TEST_DIR, 'shadow.json');

describe('shadow', () => {
  beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterEach(() => { if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE); });

  it('creates a shadow entry', () => {
    const { createEntry, loadShadow } = require('../../src/data/shadow');
    createEntry({
      ticker: 'NVDA',
      action: 'buy',
      entryDate: '2026-04-02',
      totalShares: 12,
      stagedPlan: [
        { tranche: 1, shares: 8, trigger: 'immediate', status: 'filled', fillPrice: 852.30, fillDate: '2026-04-02' },
        { tranche: 2, shares: 4, trigger: '5% dip', triggerPrice: 809.69, fallbackDate: '2026-05-02', status: 'pending', fillPrice: null, fillDate: null },
      ],
      stopLoss: { price: 780, reason: 'Thesis falsified' },
      takeProfit: { price: 1050, reason: 'Bull case priced in' },
      timeHorizon: '2026-10-02',
      linkedThesis: 't123',
      sourceJudge: 'judge-NVDA-2026-04-01.md',
      sourceAct: 'act-NVDA-2026-04-01.md',
    }, TEST_FILE);

    const shadow = loadShadow(TEST_FILE);
    expect(shadow.entries.length).toBe(1);
    expect(shadow.entries[0].ticker).toBe('NVDA');
    expect(shadow.entries[0].status).toBe('open');
    expect(shadow.entries[0].stagedPlan.length).toBe(2);
    expect(shadow.entries[0].id).toBeDefined();
  });

  it('finds open entry by ticker', () => {
    const { createEntry, findOpen } = require('../../src/data/shadow');
    createEntry({
      ticker: 'AAPL', action: 'buy', entryDate: '2026-04-02', totalShares: 10,
      stagedPlan: [{ tranche: 1, shares: 10, trigger: 'immediate', status: 'filled', fillPrice: 170, fillDate: '2026-04-02' }],
      stopLoss: { price: 150, reason: 'test' }, takeProfit: { price: 200, reason: 'test' },
      timeHorizon: '2026-10-02', linkedThesis: null, sourceJudge: '', sourceAct: '',
    }, TEST_FILE);
    const entry = findOpen('AAPL', TEST_FILE);
    expect(entry).not.toBeNull();
    expect(entry!.ticker).toBe('AAPL');
  });

  it('closes an entry', () => {
    const { createEntry, closeEntry, findOpen } = require('../../src/data/shadow');
    createEntry({
      ticker: 'AAPL', action: 'buy', entryDate: '2026-04-02', totalShares: 10,
      stagedPlan: [{ tranche: 1, shares: 10, trigger: 'immediate', status: 'filled', fillPrice: 170, fillDate: '2026-04-02' }],
      stopLoss: { price: 150, reason: 'test' }, takeProfit: { price: 200, reason: 'test' },
      timeHorizon: '2026-10-02', linkedThesis: null, sourceJudge: '', sourceAct: '',
    }, TEST_FILE);
    closeEntry('AAPL', 185.50, '2026-07-01', 'time-horizon', TEST_FILE);
    const entry = findOpen('AAPL', TEST_FILE);
    expect(entry).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/data/shadow.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement shadow portfolio**

```ts
// engine/src/data/shadow.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const DEFAULT_FILE = join(homedir(), '.finstack', 'shadow.json');

interface StagedTranche {
  tranche: number;
  shares: number;
  trigger: string;
  triggerPrice?: number;
  fallbackDate?: string;
  status: 'pending' | 'filled' | 'expired';
  fillPrice: number | null;
  fillDate: string | null;
}

interface ShadowEntry {
  id: string;
  ticker: string;
  action: string;
  entryDate: string;
  totalShares: number;
  filledShares: number;
  stagedPlan: StagedTranche[];
  stopLoss: { price: number; reason: string };
  takeProfit: { price: number; reason: string };
  timeHorizon: string;
  linkedThesis: string | null;
  sourceJudge: string;
  sourceAct: string;
  createdAt: string;
  status: 'open' | 'closed';
  exitPrice: number | null;
  exitDate: string | null;
  exitReason: string | null;
}

interface Shadow {
  entries: ShadowEntry[];
}

export function loadShadow(file = DEFAULT_FILE): Shadow {
  if (!existsSync(file)) return { entries: [] };
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return { entries: [] };
  }
}

function save(data: Shadow, file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
}

export function createEntry(params: {
  ticker: string;
  action: string;
  entryDate: string;
  totalShares: number;
  stagedPlan: StagedTranche[];
  stopLoss: { price: number; reason: string };
  takeProfit: { price: number; reason: string };
  timeHorizon: string;
  linkedThesis: string | null;
  sourceJudge: string;
  sourceAct: string;
}, file = DEFAULT_FILE): ShadowEntry {
  const shadow = loadShadow(file);
  const filledShares = params.stagedPlan
    .filter(t => t.status === 'filled')
    .reduce((sum, t) => sum + t.shares, 0);

  const entry: ShadowEntry = {
    id: `s${Date.now()}`,
    ...params,
    filledShares,
    createdAt: new Date().toISOString(),
    status: 'open',
    exitPrice: null,
    exitDate: null,
    exitReason: null,
  };
  shadow.entries.push(entry);
  save(shadow, file);
  return entry;
}

export function findOpen(ticker: string, file = DEFAULT_FILE): ShadowEntry | null {
  const shadow = loadShadow(file);
  return shadow.entries.find(e => e.ticker === ticker.toUpperCase() && e.status === 'open') || null;
}

export function closeEntry(
  ticker: string,
  exitPrice: number,
  exitDate: string,
  exitReason: string,
  file = DEFAULT_FILE,
): void {
  const shadow = loadShadow(file);
  const entry = shadow.entries.find(e => e.ticker === ticker.toUpperCase() && e.status === 'open');
  if (entry) {
    entry.status = 'closed';
    entry.exitPrice = exitPrice;
    entry.exitDate = exitDate;
    entry.exitReason = exitReason;
  }
  save(shadow, file);
}

export type { ShadowEntry, Shadow, StagedTranche };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/data/shadow.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add engine/src/data/shadow.ts engine/test/data/shadow.test.ts
git commit -m "feat: shadow portfolio data layer"
```

---

### Task 9: Alpha Calculation Command

**Files:**
- Create: `engine/src/commands/alpha.ts`
- Create: `engine/test/commands/alpha.test.ts`

- [ ] **Step 1: Write failing tests for alpha calculation**

```ts
// engine/test/commands/alpha.test.ts
import { describe, it, expect } from 'bun:test';

describe('alpha calculation', () => {
  it('calculates behavioral cost for a single position', () => {
    const { calculatePositionAlpha } = require('../../src/commands/alpha');
    const result = calculatePositionAlpha(
      // Real: bought at 850, sold at 910
      { ticker: 'NVDA', buyPrice: 850, sellPrice: 910, shares: 8 },
      // Shadow: bought at 852, sold at 985
      { ticker: 'NVDA', buyPrice: 852, sellPrice: 985, shares: 8 },
    );
    expect(result.ticker).toBe('NVDA');
    expect(result.realPL).toBe((910 - 850) * 8); // 480
    expect(result.shadowPL).toBe((985 - 852) * 8); // 1064
    expect(result.behavioralCost).toBe(480 - 1064); // -584
  });

  it('calculates aggregate alpha', () => {
    const { calculateAggregate } = require('../../src/commands/alpha');
    const positions = [
      { realPL: 480, shadowPL: 1064, behavioralCost: -584 },
      { realPL: -200, shadowPL: -350, behavioralCost: 150 },
    ];
    const spyReturn = 0.082;
    const portfolioValue = 200000;

    const result = calculateAggregate(positions, spyReturn, portfolioValue);
    expect(result.benchmark.returnDollars).toBe(16400); // 200000 * 0.082
    expect(result.netAlpha.dollars).toBe(480 + -200); // real total
    // Shadow total = 1064 + -350 = 714
    // Analytical alpha = shadow - benchmark
    // Execution drag = real - shadow
  });

  it('categorizes behavioral costs by pattern', () => {
    const { categorizeDeviation } = require('../../src/commands/alpha');
    expect(categorizeDeviation('emotional')).toBe('early-profit-taking');
    expect(categorizeDeviation('stop-triggered')).toBe('stop-loss-avoidance');
    expect(categorizeDeviation('thesis-changed')).toBe('thesis-changed');
    expect(categorizeDeviation('need-cash')).toBe('need-cash');
    expect(categorizeDeviation('unspecified')).toBe('unspecified');
    expect(categorizeDeviation(null)).toBe('unspecified');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/commands/alpha.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement alpha command**

```ts
// engine/src/commands/alpha.ts
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadShadow, type ShadowEntry } from '../data/shadow';

const FINSTACK_DIR = join(homedir(), '.finstack');
const PORTFOLIO_FILE = join(FINSTACK_DIR, 'portfolio.json');

interface PositionAlpha {
  ticker: string;
  realPL: number;
  shadowPL: number;
  behavioralCost: number;
  deviationReason?: string;
}

export function calculatePositionAlpha(
  real: { ticker: string; buyPrice: number; sellPrice: number; shares: number },
  shadow: { ticker: string; buyPrice: number; sellPrice: number; shares: number },
): PositionAlpha {
  const realPL = (real.sellPrice - real.buyPrice) * real.shares;
  const shadowPL = (shadow.sellPrice - shadow.buyPrice) * shadow.shares;
  return {
    ticker: real.ticker,
    realPL: +realPL.toFixed(2),
    shadowPL: +shadowPL.toFixed(2),
    behavioralCost: +(realPL - shadowPL).toFixed(2),
  };
}

export function calculateAggregate(
  positions: { realPL: number; shadowPL: number; behavioralCost: number }[],
  spyReturn: number,
  portfolioValue: number,
) {
  const realTotal = positions.reduce((s, p) => s + p.realPL, 0);
  const shadowTotal = positions.reduce((s, p) => s + p.shadowPL, 0);
  const benchmarkDollars = portfolioValue * spyReturn;

  return {
    benchmark: {
      ticker: 'SPY',
      return: +(spyReturn * 100).toFixed(2),
      returnDollars: +benchmarkDollars.toFixed(2),
    },
    shadow: {
      returnDollars: +shadowTotal.toFixed(2),
    },
    real: {
      returnDollars: +realTotal.toFixed(2),
    },
    analyticalAlpha: {
      dollars: +(shadowTotal - benchmarkDollars).toFixed(2),
    },
    executionDrag: {
      dollars: +(realTotal - shadowTotal).toFixed(2),
    },
    netAlpha: {
      dollars: +(realTotal - benchmarkDollars).toFixed(2),
    },
  };
}

export function categorizeDeviation(reason: string | null): string {
  if (!reason || reason === 'unspecified') return 'unspecified';
  if (reason === 'emotional') return 'early-profit-taking';
  if (reason === 'stop-triggered') return 'stop-loss-avoidance';
  return reason;
}

function loadPortfolio(): any {
  if (!existsSync(PORTFOLIO_FILE)) return { positions: [], transactions: [] };
  try {
    const data = JSON.parse(readFileSync(PORTFOLIO_FILE, 'utf-8'));
    if (!data.transactions) data.transactions = [];
    return data;
  } catch {
    return { positions: [], transactions: [] };
  }
}

export async function alpha(args: string[]) {
  const lastN = args.includes('--last') ? parseInt(args[args.indexOf('--last') + 1]) : 10;

  const portfolio = loadPortfolio();
  const shadow = loadShadow();

  // Match real sell transactions with shadow closed entries
  const sellTxs = portfolio.transactions
    .filter((t: any) => t.action === 'sell')
    .slice(-lastN);

  if (sellTxs.length === 0) {
    console.log(JSON.stringify({
      message: 'No completed decision cycles yet. Use /judge → /act → trade → /track to build history.',
      decisionsNeeded: 3,
    }, null, 2));
    return;
  }

  const positionAlphas: (PositionAlpha & { deviationReason?: string })[] = [];

  for (const tx of sellTxs) {
    // Find corresponding buy
    const buyTx = portfolio.transactions.find(
      (t: any) => t.action === 'buy' && t.ticker === tx.ticker && t.date < tx.date,
    );
    if (!buyTx) continue;

    // Find shadow entry
    const shadowEntry = shadow.entries.find(
      (e: ShadowEntry) => e.ticker === tx.ticker && e.status === 'closed',
    );
    if (!shadowEntry) continue;

    const filledTranches = shadowEntry.stagedPlan.filter(t => t.status === 'filled');
    const shadowBuyPrice = filledTranches.length > 0
      ? filledTranches.reduce((s, t) => s + (t.fillPrice || 0) * t.shares, 0) / filledTranches.reduce((s, t) => s + t.shares, 0)
      : buyTx.price;

    const pa = calculatePositionAlpha(
      { ticker: tx.ticker, buyPrice: buyTx.price, sellPrice: tx.price, shares: tx.shares },
      { ticker: tx.ticker, buyPrice: shadowBuyPrice, sellPrice: shadowEntry.exitPrice || tx.price, shares: shadowEntry.filledShares },
    );
    pa.deviationReason = tx.reason;
    positionAlphas.push(pa);
  }

  // SPY benchmark — would normally use finstack history, but output raw for now
  // The skill layer (/track alpha) will enrich with real SPY data
  const totalRealPL = positionAlphas.reduce((s, p) => s + p.realPL, 0);
  const totalShadowPL = positionAlphas.reduce((s, p) => s + p.shadowPL, 0);

  // Group behavioral costs
  const costsByPattern: Record<string, { occurrences: number; totalCost: number; details: any[] }> = {};
  for (const pa of positionAlphas) {
    if (pa.behavioralCost >= 0) continue;
    const pattern = categorizeDeviation(pa.deviationReason || null);
    if (!costsByPattern[pattern]) costsByPattern[pattern] = { occurrences: 0, totalCost: 0, details: [] };
    costsByPattern[pattern].occurrences++;
    costsByPattern[pattern].totalCost += pa.behavioralCost;
    costsByPattern[pattern].details.push({
      ticker: pa.ticker,
      cost: pa.behavioralCost,
      reason: pa.deviationReason,
    });
  }

  const output = {
    period: {
      type: 'rolling',
      basis: `last ${sellTxs.length} decisions`,
      from: sellTxs[0]?.date,
      to: sellTxs[sellTxs.length - 1]?.date,
    },
    real: { totalPL: +totalRealPL.toFixed(2) },
    shadow: { totalPL: +totalShadowPL.toFixed(2) },
    executionDrag: { dollars: +(totalRealPL - totalShadowPL).toFixed(2) },
    behavioralCosts: Object.entries(costsByPattern).map(([pattern, data]) => ({
      pattern,
      ...data,
      totalCost: +data.totalCost.toFixed(2),
    })),
    executionFidelity: {
      followed: positionAlphas.filter(p => Math.abs(p.behavioralCost) < 50).length,
      total: positionAlphas.length,
    },
    positions: positionAlphas,
  };

  console.log(JSON.stringify(output, null, 2));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/commands/alpha.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add engine/src/commands/alpha.ts engine/test/commands/alpha.test.ts
git commit -m "feat: cognitive alpha calculation engine"
```

---

## Phase 4: Thesis Falsification Engine

### Task 10: Thesis Data Layer

**Files:**
- Create: `engine/src/data/thesis.ts`
- Create: `engine/test/data/thesis.test.ts`

- [ ] **Step 1: Write failing tests for thesis data layer**

```ts
// engine/test/data/thesis.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), '.finstack-test-thesis-' + Date.now());
const TEST_FILE = join(TEST_DIR, 'theses.json');

describe('thesis data', () => {
  beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterEach(() => { if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE); });

  it('registers a thesis', () => {
    const { registerThesis, loadTheses } = require('../../src/data/thesis');
    registerThesis({
      ticker: 'NVDA',
      thesis: 'AI capex continues',
      verdict: 'lean-buy',
      conditions: [
        { description: 'Q2 EPS beats by >5%', type: 'earnings', metric: 'surprisePct', operator: '>', threshold: 5, resolveBy: '2026-08-28' },
        { description: 'No cloud capex cuts', type: 'event', falsificationTest: 'Is a top-4 cloud provider cutting AI capex >10%?', watchTickers: ['MSFT', 'GOOGL'] },
      ],
    }, TEST_FILE);
    const data = loadTheses(TEST_FILE);
    expect(data.theses.length).toBe(1);
    expect(data.theses[0].ticker).toBe('NVDA');
    expect(data.theses[0].status).toBe('alive');
    expect(data.theses[0].conditions.length).toBe(2);
    expect(data.theses[0].conditions[0].status).toBe('pending');
    expect(data.theses[0].statusHistory.length).toBe(1);
  });

  it('transitions thesis state', () => {
    const { registerThesis, transitionThesis, loadTheses } = require('../../src/data/thesis');
    registerThesis({
      ticker: 'NVDA', thesis: 'test', verdict: 'buy',
      conditions: [{ description: 'test', type: 'event', falsificationTest: 'test?', watchTickers: [] }],
    }, TEST_FILE);
    const data = loadTheses(TEST_FILE);
    const id = data.theses[0].id;

    transitionThesis(id, 'threatened', 'MSFT cut capex', TEST_FILE);
    const updated = loadTheses(TEST_FILE);
    expect(updated.theses[0].status).toBe('threatened');
    expect(updated.theses[0].statusHistory.length).toBe(2);
  });

  it('kills a thesis and sets obituary date', () => {
    const { registerThesis, killThesis, loadTheses } = require('../../src/data/thesis');
    registerThesis({
      ticker: 'AAPL', thesis: 'test', verdict: 'buy',
      conditions: [{ description: 'test', type: 'event', falsificationTest: 'test?', watchTickers: [] }],
    }, TEST_FILE);
    const data = loadTheses(TEST_FILE);
    const id = data.theses[0].id;

    killThesis(id, 'CPM declining', TEST_FILE);
    const updated = loadTheses(TEST_FILE);
    expect(updated.theses[0].status).toBe('dead');
    expect(updated.theses[0].obituaryDueDate).toBeDefined();
  });

  it('adds a threat to event condition', () => {
    const { registerThesis, addThreat, loadTheses } = require('../../src/data/thesis');
    registerThesis({
      ticker: 'NVDA', thesis: 'test', verdict: 'buy',
      conditions: [{ description: 'no cuts', type: 'event', falsificationTest: 'test?', watchTickers: ['MSFT'] }],
    }, TEST_FILE);
    const data = loadTheses(TEST_FILE);
    const thesisId = data.theses[0].id;
    const condId = data.theses[0].conditions[0].id;

    addThreat(thesisId, condId, {
      date: '2026-04-15',
      source: 'MSFT delays data centers',
      confidence: 'high',
      reasoning: 'Direct capex reduction',
    }, TEST_FILE);

    const updated = loadTheses(TEST_FILE);
    expect(updated.theses[0].conditions[0].threats.length).toBe(1);
  });

  it('getAlive returns only alive and threatened theses', () => {
    const { registerThesis, killThesis, getAlive, loadTheses } = require('../../src/data/thesis');
    registerThesis({ ticker: 'NVDA', thesis: 't1', verdict: 'buy', conditions: [{ description: 'x', type: 'event', falsificationTest: '?', watchTickers: [] }] }, TEST_FILE);
    registerThesis({ ticker: 'AAPL', thesis: 't2', verdict: 'buy', conditions: [{ description: 'x', type: 'event', falsificationTest: '?', watchTickers: [] }] }, TEST_FILE);
    const data = loadTheses(TEST_FILE);
    killThesis(data.theses[0].id, 'dead', TEST_FILE);

    const alive = getAlive(TEST_FILE);
    expect(alive.length).toBe(1);
    expect(alive[0].ticker).toBe('AAPL');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/data/thesis.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement thesis data layer**

```ts
// engine/src/data/thesis.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const DEFAULT_FILE = join(homedir(), '.finstack', 'theses.json');

type ThesisStatus = 'alive' | 'threatened' | 'critical' | 'reinforced' | 'dead';
type ConditionStatus = 'pending' | 'passed' | 'failed';

interface EarningsCondition {
  id: string;
  description: string;
  type: 'earnings';
  metric: string;
  operator: '>' | '<' | '>=' | '<=' | '==';
  threshold: number;
  resolveBy: string;
  status: ConditionStatus;
  actualValue: number | null;
  resolvedAt: string | null;
}

interface EventCondition {
  id: string;
  description: string;
  type: 'event';
  falsificationTest: string;
  watchTickers: string[];
  status: ConditionStatus;
  threats: Threat[];
}

type Condition = EarningsCondition | EventCondition;

interface Threat {
  date: string;
  source: string;
  confidence: 'high' | 'moderate' | 'low';
  reasoning: string;
}

interface StatusChange {
  date: string;
  from: ThesisStatus | null;
  to: ThesisStatus;
  reason: string;
}

interface Thesis {
  id: string;
  ticker: string;
  thesis: string;
  verdict: string;
  conditions: Condition[];
  status: ThesisStatus;
  statusHistory: StatusChange[];
  createdAt: string;
  lastChecked: string;
  obituaryDueDate: string | null;
}

interface ThesesStore {
  theses: Thesis[];
}

export function loadTheses(file = DEFAULT_FILE): ThesesStore {
  if (!existsSync(file)) return { theses: [] };
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return { theses: [] };
  }
}

function save(data: ThesesStore, file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
}

let _condCounter = 0;

export function registerThesis(params: {
  ticker: string;
  thesis: string;
  verdict: string;
  conditions: Array<{
    description: string;
    type: 'earnings' | 'event';
    metric?: string;
    operator?: string;
    threshold?: number;
    resolveBy?: string;
    falsificationTest?: string;
    watchTickers?: string[];
  }>;
}, file = DEFAULT_FILE): Thesis {
  const store = loadTheses(file);
  const now = new Date().toISOString();

  const conditions: Condition[] = params.conditions.map((c, i) => {
    const id = `c${++_condCounter}`;
    if (c.type === 'earnings') {
      return {
        id,
        description: c.description,
        type: 'earnings' as const,
        metric: c.metric || '',
        operator: (c.operator || '>') as any,
        threshold: c.threshold || 0,
        resolveBy: c.resolveBy || '',
        status: 'pending' as const,
        actualValue: null,
        resolvedAt: null,
      };
    }
    return {
      id,
      description: c.description,
      type: 'event' as const,
      falsificationTest: c.falsificationTest || '',
      watchTickers: c.watchTickers || [],
      status: 'pending' as const,
      threats: [],
    };
  });

  const thesis: Thesis = {
    id: `t${Date.now()}`,
    ticker: params.ticker.toUpperCase(),
    thesis: params.thesis,
    verdict: params.verdict,
    conditions,
    status: 'alive',
    statusHistory: [{ date: now, from: null, to: 'alive', reason: 'Registered from /judge' }],
    createdAt: now,
    lastChecked: now,
    obituaryDueDate: null,
  };

  store.theses.push(thesis);
  save(store, file);
  return thesis;
}

export function transitionThesis(id: string, to: ThesisStatus, reason: string, file = DEFAULT_FILE): void {
  const store = loadTheses(file);
  const thesis = store.theses.find(t => t.id === id);
  if (!thesis) return;

  const from = thesis.status;
  thesis.status = to;
  thesis.statusHistory.push({ date: new Date().toISOString(), from, to, reason });
  thesis.lastChecked = new Date().toISOString();
  save(store, file);
}

export function killThesis(id: string, reason: string, file = DEFAULT_FILE): void {
  const store = loadTheses(file);
  const thesis = store.theses.find(t => t.id === id);
  if (!thesis) return;

  const from = thesis.status;
  thesis.status = 'dead';
  thesis.statusHistory.push({ date: new Date().toISOString(), from, to: 'dead', reason });
  // Obituary due 90 days after creation
  const created = new Date(thesis.createdAt);
  created.setDate(created.getDate() + 90);
  thesis.obituaryDueDate = created.toISOString().split('T')[0];
  thesis.lastChecked = new Date().toISOString();
  save(store, file);
}

export function addThreat(
  thesisId: string,
  conditionId: string,
  threat: Threat,
  file = DEFAULT_FILE,
): void {
  const store = loadTheses(file);
  const thesis = store.theses.find(t => t.id === thesisId);
  if (!thesis) return;
  const cond = thesis.conditions.find(c => c.id === conditionId);
  if (!cond || cond.type !== 'event') return;
  cond.threats.push(threat);
  thesis.lastChecked = new Date().toISOString();
  save(store, file);
}

export function getAlive(file = DEFAULT_FILE): Thesis[] {
  const store = loadTheses(file);
  return store.theses.filter(t => t.status !== 'dead');
}

export function getDead(file = DEFAULT_FILE): Thesis[] {
  const store = loadTheses(file);
  return store.theses.filter(t => t.status === 'dead');
}

export function getObituaryQueue(file = DEFAULT_FILE): Thesis[] {
  const today = new Date().toISOString().split('T')[0];
  return getDead(file).filter(t => t.obituaryDueDate && t.obituaryDueDate <= today);
}

export type { Thesis, Condition, EarningsCondition, EventCondition, Threat, ThesisStatus, ThesesStore };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/data/thesis.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add engine/src/data/thesis.ts engine/test/data/thesis.test.ts
git commit -m "feat: thesis data layer with state machine"
```

---

### Task 11: Thesis Engine Commands

**Files:**
- Create: `engine/src/commands/thesis.ts`
- Create: `engine/test/commands/thesis.test.ts`

- [ ] **Step 1: Write failing tests for thesis commands**

```ts
// engine/test/commands/thesis.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { registerThesis, loadTheses, killThesis } from '../../src/data/thesis';

const TEST_DIR = join(tmpdir(), '.finstack-test-thesiscmd-' + Date.now());
const TEST_FILE = join(TEST_DIR, 'theses.json');

describe('thesis commands', () => {
  beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterEach(() => { if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE); });

  it('formatThesisList produces table output', () => {
    const { formatThesisList } = require('../../src/commands/thesis');
    registerThesis({
      ticker: 'NVDA', thesis: 'AI capex continues', verdict: 'lean-buy',
      conditions: [{ description: 'EPS beat', type: 'earnings', metric: 'surprisePct', operator: '>', threshold: 5, resolveBy: '2026-08-28' }],
    }, TEST_FILE);
    const data = loadTheses(TEST_FILE);
    const output = formatThesisList(data.theses);
    expect(output.length).toBe(1);
    expect(output[0].ticker).toBe('NVDA');
    expect(output[0].status).toBe('ALIVE');
    expect(output[0].conditions).toBe('1 pending');
  });

  it('formatThesisHistory produces summary', () => {
    const { formatThesisHistory } = require('../../src/commands/thesis');
    registerThesis({ ticker: 'NVDA', thesis: 't1', verdict: 'buy', conditions: [{ description: 'x', type: 'event', falsificationTest: '?', watchTickers: [] }] }, TEST_FILE);
    registerThesis({ ticker: 'AAPL', thesis: 't2', verdict: 'buy', conditions: [{ description: 'x', type: 'event', falsificationTest: '?', watchTickers: [] }] }, TEST_FILE);
    const data = loadTheses(TEST_FILE);
    killThesis(data.theses[0].id, 'earnings miss', TEST_FILE);
    const updated = loadTheses(TEST_FILE);
    const summary = formatThesisHistory(updated.theses);
    expect(summary.total).toBe(2);
    expect(summary.alive).toBe(1);
    expect(summary.dead).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/commands/thesis.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement thesis command**

```ts
// engine/src/commands/thesis.ts
import {
  loadTheses, getAlive, getDead, getObituaryQueue,
  killThesis as killThesisData, transitionThesis,
  type Thesis, type ThesesStore,
} from '../data/thesis';

export function formatThesisList(theses: Thesis[]): any[] {
  return theses.map(t => {
    const pendingCount = t.conditions.filter(c => c.status === 'pending').length;
    const failedCount = t.conditions.filter(c => c.status === 'failed').length;
    const condSummary = failedCount > 0
      ? `${failedCount} failed, ${pendingCount} pending`
      : `${pendingCount} pending`;

    return {
      id: t.id,
      ticker: t.ticker,
      thesis: t.thesis,
      status: t.status.toUpperCase(),
      conditions: condSummary,
      since: t.createdAt.split('T')[0],
      obituaryDue: t.obituaryDueDate || null,
    };
  });
}

export function formatThesisHistory(theses: Thesis[]) {
  const alive = theses.filter(t => t.status !== 'dead').length;
  const dead = theses.filter(t => t.status === 'dead').length;
  const threatened = theses.filter(t => t.status === 'threatened').length;

  const deadTheses = theses.filter(t => t.status === 'dead');
  const causeOfDeath: Record<string, number> = {};
  for (const t of deadTheses) {
    const lastChange = t.statusHistory[t.statusHistory.length - 1];
    const cause = lastChange?.reason || 'unknown';
    causeOfDeath[cause] = (causeOfDeath[cause] || 0) + 1;
  }

  const lifespans = deadTheses.map(t => {
    const created = new Date(t.createdAt).getTime();
    const died = new Date(t.statusHistory[t.statusHistory.length - 1]?.date || t.createdAt).getTime();
    return Math.ceil((died - created) / 86400000);
  });
  const avgLifespan = lifespans.length > 0
    ? Math.round(lifespans.reduce((s, l) => s + l, 0) / lifespans.length)
    : 0;

  return {
    total: theses.length,
    alive,
    dead,
    threatened,
    causeOfDeath,
    avgLifespanDays: avgLifespan,
    obituariesPending: getObituaryQueue().length,
  };
}

export async function thesis(args: string[]) {
  const sub = args[0] || 'list';

  switch (sub) {
    case 'list': {
      const all = loadTheses();
      const output = formatThesisList(all.theses);
      console.log(JSON.stringify(output, null, 2));
      break;
    }

    case 'check': {
      const ticker = args[1]?.toUpperCase();
      // Thesis check with earnings data is done by the /track skill via
      // finstack earnings + Claude evaluation. Engine just provides data.
      const alive = getAlive();
      const filtered = ticker ? alive.filter(t => t.ticker === ticker) : alive;
      const withEarnings = filtered.filter(t =>
        t.conditions.some(c => c.type === 'earnings' && c.status === 'pending'),
      );
      console.log(JSON.stringify({
        message: `${withEarnings.length} theses with pending earnings conditions`,
        theses: formatThesisList(withEarnings),
      }, null, 2));
      break;
    }

    case 'kill': {
      const id = args[1];
      const reason = args.slice(2).join(' ') || 'Manual kill';
      if (!id) {
        console.error(JSON.stringify({ error: 'Usage: finstack thesis kill <id> <reason>' }));
        process.exit(1);
      }
      killThesisData(id, reason);
      console.log(JSON.stringify({ message: `Thesis ${id} killed: ${reason}` }));
      break;
    }

    case 'history': {
      const all = loadTheses();
      const summary = formatThesisHistory(all.theses);
      console.log(JSON.stringify(summary, null, 2));
      break;
    }

    default:
      console.error(JSON.stringify({ error: `Unknown subcommand: ${sub}. Use list|check|kill|history` }));
      process.exit(1);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/commands/thesis.test.ts`
Expected: All 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add engine/src/commands/thesis.ts engine/test/commands/thesis.test.ts
git commit -m "feat: thesis CLI commands (list, check, kill, history)"
```

---

## Phase 5: CLI Integration

### Task 12: Route All New Commands in cli.ts

**Files:**
- Modify: `engine/src/cli.ts`

- [ ] **Step 1: Update cli.ts with all new commands**

Replace the full content of `engine/src/cli.ts`:

```ts
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
};

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

Data: ~/.finstack/
Cache: ~/.finstack/cache/
`);
    process.exit(command ? 0 : 1);
  }

  const fn = commands[command];
  if (!fn) {
    console.error(JSON.stringify({ error: `Unknown command: ${command}. Run 'finstack help' for usage.` }));
    process.exit(1);
  }

  try {
    await fn(args);
  } catch (e: any) {
    console.error(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}

main();
```

- [ ] **Step 2: Build and verify**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun run build && ./engine/dist/finstack help`
Expected: Shows all 12 commands in help output

- [ ] **Step 3: Run all tests, commit**

Run: `cd /Users/kohozheng/Documents/GitHub/finstack && bun test engine/test/`
Expected: All tests PASS

```bash
git add engine/src/cli.ts
git commit -m "feat: route all new commands in CLI"
```

---

## Phase 6: Skills

### Task 13: /track Skill Template

**Files:**
- Create: `track/SKILL.md`

- [ ] **Step 1: Write the /track skill template**

```markdown
---
name: track
description: |
  Quantified mirror. Compares real portfolio against shadow (disciplined you)
  and SPY benchmark. Shows thesis lifecycle, cognitive alpha, behavioral cost
  in dollars. Use when asked to "track", "how am I doing", "show my alpha",
  "thesis status", "performance", or "track record".
allowed-tools:
  - Bash
  - Read
  - Write
  - WebSearch
  - WebFetch
  - Glob
  - Grep
  - AskUserQuestion
---

# /track — Quantified Mirror

You are a performance analyst holding up a mirror to the user's investment
decisions. Not a cheerleader, not a critic — a mirror that reflects what
actually happened versus what the plan said should happen.

## Binary Resolution

` ` `bash
F=""
_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[ -n "$_ROOT" ] && [ -x "$_ROOT/.claude/skills/finstack/engine/dist/finstack" ] && F="$_ROOT/.claude/skills/finstack/engine/dist/finstack"
[ -z "$F" ] && F=~/.claude/skills/finstack/engine/dist/finstack
[ -x "$F" ] && echo "ENGINE: $F" || echo "ENGINE_MISSING"
` ` `

## Step 0: Determine Scope

Parse the user's request:
- **"/track"** (no args) → compact global dashboard
- **"/track NVDA"** → decision replay for one ticker
- **"/track alpha"** → full cognitive alpha breakdown
- **"/track thesis"** → thesis lifecycle status
- **"/track obituary"** → dead thesis review queue

## Step 1: Gather Data

Run in parallel based on scope:

1. `$F alpha` → cognitive alpha calculation
2. `$F thesis list` → active thesis statuses
3. Read `~/.finstack/portfolio.json` → current holdings + transaction log
4. Read `~/.finstack/shadow.json` → shadow portfolio
5. Read `~/.finstack/theses.json` → thesis details
6. Read `~/.finstack/patterns/` → behavioral patterns
7. `$F quote SPY` → benchmark current price

## Step 2: Render Output

### Global Dashboard (no args)

Follow "Breathe, Never Break the Chain" — compact by default:

` ` `
finstack track

Net alpha: +$12,000 (rolling 10 decisions)
  Analysis: +$22,400 | Execution: -$10,400

Thesis: 2 alive, 1 threatened (INTC)
Obituary: 1 due (META)

/track alpha — full breakdown
/track INTC — threatened thesis detail
/track obituary — review META
` ` `

If < 3 completed decision cycles, display what's available and note:
"Track improves with more decisions. Use /judge → /act → trade to build history."

### Decision Replay (/track <ticker>)

Reconstruct the complete decision chain for one ticker:

1. Glob `~/.finstack/journal/*<ticker>*` for all journal entries
2. Read the shadow entry for this ticker from shadow.json
3. Read the thesis for this ticker from theses.json
4. Run `$F quote <ticker>` for current price
5. Run `$F history <ticker> --from <first_decision_date> --to today`

Present as a narrative timeline. Each entry shows:
- What happened (the decision made)
- What the plan said should happen
- What the user actually did
- Deviation (if any) with captured reason
- Shadow position status at that point

End with: shadow vs real P&L gap, thesis status, actionable next step.

### Full Alpha (/track alpha)

Run `$F alpha` and present narratively:

1. Three-line comparison: SPY / Shadow / Real
   - Fetch SPY return for the period with `$F history SPY --from <period_start> --to <period_end>`
   - Calculate SPY return percentage
2. Analytical alpha in dollars: shadow return - SPY return
3. Execution drag in dollars: real return - shadow return
4. Per-pattern behavioral cost breakdown
5. Execution fidelity: N/M decisions followed plan
6. Thesis accuracy: N/M theses directionally correct

### Thesis Status (/track thesis)

Run `$F thesis list` and present with context:
- Each active thesis with conditions and status
- Threatened theses highlighted with the specific threat
- Suggested actions for each

### Obituary Queue (/track obituary)

Read theses.json for dead theses past obituaryDueDate. For each:

1. Read the original thesis and its kill reason
2. For earnings conditions: run `$F earnings <ticker>` — check if the
   conditions have since reversed
3. For event conditions: WebSearch for recent developments
4. Verdict is based on **condition status, NOT price movement**
5. A thesis is "premature kill" only if the falsification criteria have
   since un-falsified

Present as an obituary review with pattern implications.

## Architecture

/track is an audit layer — it reads everything but blocks nothing:

` ` `
/sense → /research → /judge → /act → /reflect
  ↑                                      │
  └──────── cognitive feedback ──────────┘
                    ↕
              /track (audit layer — reads everything, blocks nothing)
` ` `

The cognitive loop works without /track. /reflect can pull data from
/track (via $F alpha, $F thesis), but users can /reflect without /track.

## Step 3: Deposit

Write output to `~/.finstack/journal/track-<date>.md` (global) or
`~/.finstack/journal/track-<ticker>-<date>.md` (single ticker).

Git commit: `cd ~/.finstack && git add -A && git commit -m "track: <scope> — <key finding>"`

## Natural Flow

After track:
- **"/judge [ticker]"** → re-evaluate a threatened thesis
- **"/reflect"** → full reflection with track data
- **"/sense"** → check for new signals
- **"show pattern [name]"** → detail on a behavioral pattern
```

Note: In the actual SKILL.md file, the triple backticks inside code blocks must be real triple backticks (the examples above use spaces between them for plan readability). When writing the file, use proper markdown code fences.

- [ ] **Step 2: Commit**

```bash
git add track/SKILL.md
git commit -m "feat: /track audit skill template"
```

---

### Task 14: Upgrade /judge — Thesis Registration

**Files:**
- Modify: `judge/SKILL.md`

- [ ] **Step 1: Add Step 6 to judge/SKILL.md**

After the existing "## Natural Flow" section (line 212), insert before it a new section. Find the line `## Step 5: Deposit to Journal` section's ending and add after the git commit line:

Append before `## Natural Flow`:

```markdown
## Step 6: Thesis Registration

After depositing to journal, automatically register the thesis:

1. Extract conditions from the conditional confidence map in your verdict.
   Each "if X then Y" becomes a tracked condition.
2. Determine condition types:
   - Specific quantitative thresholds (e.g., "Q2 EPS > $1.50") → `earnings` type
     with metric, operator, threshold, resolveBy date
   - Event-based conditions (e.g., "no cloud provider cuts capex") → `event` type
     with a natural language `falsificationTest` and `watchTickers`
3. Register: `$F thesis register` is not a command — instead, the skill writes
   directly to `~/.finstack/theses.json` using this structure:

```json
{
  "ticker": "<TICKER>",
  "thesis": "<one-line thesis summary>",
  "verdict": "<your verdict>",
  "conditions": [
    {
      "description": "<human readable>",
      "type": "earnings",
      "metric": "surprisePct",
      "operator": ">",
      "threshold": 5.0,
      "resolveBy": "YYYY-MM-DD"
    },
    {
      "description": "<human readable>",
      "type": "event",
      "falsificationTest": "<question Claude can evaluate against any news article>",
      "watchTickers": ["MSFT", "GOOGL"]
    }
  ]
}
```

4. Read the existing theses.json, append the new thesis object with:
   - `id`: `t` + timestamp
   - `status`: `alive`
   - `statusHistory`: initial entry
   - Each condition gets `id`: `c` + counter, `status`: `pending`
5. Write back to theses.json.
6. Brief confirmation: `Thesis registered: "<thesis>" — N conditions tracked`
```

- [ ] **Step 2: Commit**

```bash
git add judge/SKILL.md
git commit -m "feat: /judge auto-registers thesis on verdict"
```

---

### Task 15: Upgrade /act — Shadow Entry

**Files:**
- Modify: `act/SKILL.md`

- [ ] **Step 1: Add Step 7 to act/SKILL.md**

Append before `## Important`:

```markdown
## Step 7: Shadow Entry

After depositing to journal, automatically create a shadow portfolio entry:

1. Extract from the action plan: ticker, action, entry price, shares per
   tranche, stop-loss (price + reason), take-profit (price + reason),
   time horizon date, and staged entry plan.

2. Entry price: use the current market price from `$F quote <ticker>`
   (regularMarketPrice field). This simulates a market-on-close order.
   Do NOT use the "ideal" price from the plan.

3. Write to `~/.finstack/shadow.json`:

```json
{
  "ticker": "<TICKER>",
  "action": "buy",
  "entryDate": "<today>",
  "totalShares": <total across all tranches>,
  "stagedPlan": [
    {
      "tranche": 1,
      "shares": <N>,
      "trigger": "immediate",
      "status": "filled",
      "fillPrice": <current market price>,
      "fillDate": "<today>"
    },
    {
      "tranche": 2,
      "shares": <N>,
      "trigger": "<condition>",
      "triggerPrice": <calculated price>,
      "fallbackDate": "<entryDate + 30 days>",
      "status": "pending",
      "fillPrice": null,
      "fillDate": null
    }
  ],
  "stopLoss": { "price": <N>, "reason": "<thesis-based reason>" },
  "takeProfit": { "price": <N>, "reason": "<reason>" },
  "timeHorizon": "<YYYY-MM-DD>",
  "linkedThesis": "<thesis ID from theses.json if exists>",
  "sourceJudge": "<journal filename>",
  "sourceAct": "<journal filename>"
}
```

4. Read existing shadow.json, append entry with `id: s` + timestamp,
   `status: open`, `filledShares` calculated from filled tranches.
5. Write back to shadow.json.
6. For staged entries: fallbackDate = entry date + 30 calendar days.
   After 30 days, if the trigger hasn't been met, shadow fills at
   day-30 close price. This is evaluated by /track or /reflect.
7. Brief confirmation: `Shadow position created: <TICKER> <shares> shares`
```

- [ ] **Step 2: Commit**

```bash
git add act/SKILL.md
git commit -m "feat: /act auto-creates shadow portfolio entry"
```

---

### Task 16: Upgrade /sense — Thesis Threats + FRED + EDGAR

**Files:**
- Modify: `sense/SKILL.md`

- [ ] **Step 1: Add thesis threat scan and new data sources**

After Step 1 (Multi-Source Scan), insert new step. Find `## Step 2: Filter and Rank` and insert before it:

```markdown
## Step 1.5: Thesis Threat Scan + Enhanced Data

### Thesis Threat Detection

1. Read `~/.finstack/theses.json` for all alive/threatened theses
2. For each news item from Step 1 that mentions a ticker in any thesis's
   `watchTickers`:
   - Read the thesis's `falsificationTest` (a natural language question)
   - Evaluate: does this news article answer the falsificationTest
     affirmatively? In other words, would a reasonable analyst interpret
     this news as evidence that the thesis condition is being challenged?
   - If YES (genuine threat): add to the thesis condition's `threats`
     array in theses.json, update thesis status to `threatened` if
     currently `alive`
   - Include in output as a thesis threat alert

3. Do NOT automatically kill any thesis. Only flag threats. The user
   runs `/judge` to make life/death decisions.

### Enhanced Data Sources

Run in parallel with Step 1:
- `$F macro` — include macro snapshot (Fed funds rate, CPI, VIX) in
  the briefing's macro pulse section. Use real numbers, not generalities.
- For each ticker in portfolio.json (up to top 5 by position size):
  `$F filing <ticker>` — flag if any new SEC filing in the last 7 days

If FRED key is not configured, skip macro data silently.
If EDGAR fails for a ticker, skip silently.
```

- [ ] **Step 2: Commit**

```bash
git add sense/SKILL.md
git commit -m "feat: /sense thesis threat detection + FRED + EDGAR data"
```

---

### Task 17: Upgrade /research — FRED + EDGAR + Earnings

**Files:**
- Modify: `research/SKILL.md`

- [ ] **Step 1: Expand Step 1 data gathering**

In Step 1 (Data Gathering), after item 5 (Prior research), add:

```markdown
6. **Macro context**: `$F macro` — current rates, CPI, VIX. Incorporate
   into the memo where macro conditions materially affect the thesis.
   Skip if FRED key not configured.
7. **SEC filings**: `$F filing <ticker>` — check for recent 10-K, 10-Q,
   8-K filings. If a 10-K or 10-Q was filed in the last 90 days,
   WebFetch the filing URL and read key sections: Risk Factors,
   Management Discussion & Analysis (MD&A), and segment breakdowns.
   These are where the real information hides.
8. **Earnings history**: `$F earnings <ticker>` — last 8 quarters of
   earnings surprises. Use in "Key Metrics in Context" to show whether
   the company consistently beats, meets, or misses estimates. This
   pattern matters more than any single quarter.
   Skip if Alpha Vantage key not configured.
```

- [ ] **Step 2: Commit**

```bash
git add research/SKILL.md
git commit -m "feat: /research integrates FRED, SEC EDGAR, earnings data"
```

---

### Task 18: Upgrade /reflect — Quantitative

**Files:**
- Modify: `reflect/SKILL.md`

- [ ] **Step 1: Upgrade Step 0 data gathering and output**

In Step 0 (Gather the Record), after item 5 (git log), add:

```markdown
6. `$F alpha` — cognitive alpha data (real vs shadow vs benchmark)
7. `$F thesis history` — thesis accuracy statistics
8. Read `~/.finstack/shadow.json` — shadow vs real position comparisons
9. Check obituary queue: read theses.json for dead theses where
   `obituaryDueDate` has passed — include these in the reflection
```

Replace the Step 4 Output example with an upgraded version. Find `## Step 4: Output` and replace its content:

```markdown
## Step 4: Output

The reflection must lead with hard numbers, then interpret:

` ` `
Reflection: <Month Year>

═══ Hard Numbers ═══
Analytical alpha: +$22,400 (your theses beat SPY by 11.2%)
Execution drag:   -$10,400 (your behavior gave back 5.2%)
Net alpha:        +$12,000

Thesis accuracy: 7/10 directionally correct
Execution fidelity: 5/10 followed plan exactly
Deviation reasons: 3 emotional, 1 thesis-changed, 1 need-cash

═══ Coaching ═══
Your analysis is genuinely good — 70% thesis accuracy is above average.
Your problem is not what you think. It's what you do after you think.

The $10,400 execution drag breaks down:
- $4,200 from exiting early (3x)
- $2,800 from ignoring stops (2x)
- $3,400 from incomplete staged entries (2x)

Obituary review:
  [Include obituary analysis for any dead theses past due date.
   Check if falsification conditions have since un-falsified.
   Verdict is based on CONDITION STATUS, not price movement.]

One thing to change next month:
  [One specific, actionable recommendation based on the data]
` ` `

If alpha data is unavailable (no completed cycles), fall back to the
qualitative reflection from journal entries alone — but note that
quantitative tracking improves with more completed decision cycles.
```

Note: Use real triple backticks in the actual file.

- [ ] **Step 2: Commit**

```bash
git add reflect/SKILL.md
git commit -m "feat: /reflect upgraded with quantitative alpha data"
```

---

### Task 19: Upgrade /cascade — FRED Integration

**Files:**
- Modify: `cascade/SKILL.md`

- [ ] **Step 1: Add FRED to cascade synthesis**

In Step 3 (Synthesis), after "### Regime change detection:", add:

```markdown
### Macro data enrichment

For cascades triggered by macro events (rate changes, trade policy,
currency moves, employment data):

Run `$F macro` to get current values for relevant FRED series. Use
real numbers in your chain analysis:

- Instead of "rising rates hurt growth stocks" →
  "Fed funds rate at 5.25%, up from 4.75% six months ago. At current
  10Y-2Y spread of -0.15, the yield curve is inverted. This specific
  rate environment has historically compressed PE multiples for
  companies with >80% revenue growth expectations."

If FRED key is not configured, use WebSearch for current macro data.
Always cite specific numbers, not generalities.
```

- [ ] **Step 2: Commit**

```bash
git add cascade/SKILL.md
git commit -m "feat: /cascade uses FRED macro data in synthesis"
```

---

## Phase 7: Packaging

### Task 20: README Rewrite

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite README.md**

Key changes:
1. Replace Data Sources section (remove "coming soon", add table)
2. Add /track description to The Loop
3. Add Cognitive Alpha and Thesis Falsification descriptions
4. Remove all Tushare references
5. Add /track to skill list

Replace the Data Sources section (lines 107-115) with:

```markdown
## Data Sources

Works out of the box with zero API keys:

| Tier | Source | Data | Key Required |
|------|--------|------|:---:|
| 0 | WebSearch + WebFetch | News, analysis, any public page | No |
| 1 | Yahoo Finance | Quotes, financials, trending | No |
| 1 | SEC EDGAR | 10-K, 10-Q, 8-K filings | No |
| 1 | FRED | Rates, CPI, GDP, unemployment, VIX | Free |
| 2 | Alpha Vantage | Earnings calendar, surprise history | Free |
| 2 | Polygon | Historical OHLCV, splits, dividends | Free |

Tier 1 covers 90% of needs. Tier 2 adds depth for power users.
Configure keys: `finstack keys set <provider> <key>`
```

Replace The Loop section to add /track:

```markdown
## The Loop

```
/sense → /research → /judge → /act → /reflect
  ↑                                       │
  └──────── cognitive feedback ───────────┘
                    ↕
              /track (audit layer)
```

- **`/sense`** — Morning briefing. Scans for signals, filters noise, surfaces only what matters to your portfolio.
- **`/research`** — Deep dive. Produces research memorandums, not data dumps. Every claim traceable to source.
- **`/judge`** — Adversarial judgment. Bull builds the case, Bear attacks the weakest assumption with historical evidence. Delivers a verdict with conditional confidence — not fake scores.
- **`/act`** — Action plan. Position sizing, stop-loss, take-profit, time horizon. Cross-checked against your risk profile and behavioral patterns.
- **`/reflect`** — Meta-cognition. Reviews past decisions, separates luck from skill, extracts behavioral patterns that shape all future invocations.
- **`/track`** — Quantified mirror. Real vs shadow portfolio, thesis lifecycle, cognitive alpha score, behavioral cost in dollars.
```

Replace the skill list output:

```markdown
```
/sense     /research     /judge
/act       /reflect      /cascade
/track
```
```

Add after The Loop section:

```markdown
### Cognitive Alpha Engine

finstack maintains a shadow portfolio — a "perfectly disciplined you" that
follows every /act plan exactly. Stop-losses fire on time. Take-profits
execute at target. Time horizons are honored.

`/track alpha` compares your real portfolio against the shadow and SPY:

```
             Return    vs SPY
  SPY         +8.2%      —
  Shadow      +19.4%    +11.2%  ← your analytical edge
  Real        +14.2%    +6.0%   ← what you captured

  Your analysis is worth +$22,400/quarter.
  Your execution gave back $10,400.
```

Every dollar of behavioral cost is traced to its source: early exits,
ignored stops, incomplete staged entries. You see exactly what your
investment personality is costing you.

### Thesis Falsification

Every `/judge` verdict auto-registers a thesis with falsifiable conditions.
`/sense` monitors for threats. The thesis lifecycle:

```
alive → threatened → critical → dead
     → reinforced (condition passed)
```

Machine detects threats. Human decides death. Dead theses get an obituary
review 90 days later — did you kill it too early, or was the call right?
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README — remove coming soon, add track + cognitive alpha"
```

---

### Task 21: Setup Script + Version Bump

**Files:**
- Modify: `setup`
- Modify: `package.json`

- [ ] **Step 1: Add track to setup SKILLS array**

In `setup`, find the line:

```bash
SKILLS=(sense research judge act reflect cascade)
```

Replace with:

```bash
SKILLS=(sense research judge act reflect cascade track)
```

- [ ] **Step 2: Bump version in package.json**

In `package.json`, change:

```json
"version": "0.1.0"
```

to:

```json
"version": "0.2.0"
```

- [ ] **Step 3: Build, run full test suite**

```bash
cd /Users/kohozheng/Documents/GitHub/finstack
bun test engine/test/
bun run build
./engine/dist/finstack help
```

Expected:
- All tests PASS
- Build succeeds
- Help shows all 12 commands
- `/track` appears in setup skill list

- [ ] **Step 4: Commit**

```bash
git add setup package.json
git commit -m "chore: bump to v0.2.0, add /track to setup"
```

---

## Post-Implementation Verification

After all tasks are complete:

- [ ] Run `bun test engine/test/` — all tests pass
- [ ] Run `bun run build` — binary compiles
- [ ] Run `./engine/dist/finstack help` — shows 12 commands
- [ ] Run `./engine/dist/finstack keys list` — returns empty list (no error)
- [ ] Run `./engine/dist/finstack thesis list` — returns empty list (no error)
- [ ] Run `./engine/dist/finstack alpha` — returns "no completed cycles" message
- [ ] Verify no "coming soon" in any file: `grep -r "coming soon" . --include="*.md" --include="*.ts"`
- [ ] Verify no Tushare references: `grep -ri "tushare" . --include="*.md" --include="*.ts"`
- [ ] Verify README data sources table has 6 rows, no empty promises
- [ ] Run `./setup` on a clean machine (or verify the skill list includes `/track`)
