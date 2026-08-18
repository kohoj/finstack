// engine/test/data/equity.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeDrawdown, loadEquity, recordEquity } from '../../src/data/equity';

// Bind to a private file, like thesis.test.ts, rather than the env-derived
// paths.EQUITY_FILE: a concurrently scheduled sibling test file can repoint
// FINSTACK_HOME mid-test, so sharing the env path leaks state across tests.
const TEST_DIR = join(tmpdir(), `.finstack-test-equity-${Date.now()}`);
const FILE = join(TEST_DIR, 'equity.json');

describe('equity curve + drawdown', () => {
  beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterEach(() => {
    if (existsSync(FILE)) unlinkSync(FILE);
  });

  it('starts empty with zero drawdown', () => {
    const dd = computeDrawdown(loadEquity(FILE));
    expect(dd.peak).toBeNull();
    expect(dd.current).toBeNull();
    expect(dd.drawdownPct).toBe(0);
  });

  it('records a snapshot and sets the initial peak', () => {
    const h = recordEquity(10000, '2026-01-02', FILE);
    expect(h.snapshots).toHaveLength(1);
    expect(h.peak).toBe(10000);
    expect(h.peakDate).toBe('2026-01-02');
    expect(computeDrawdown(h).drawdownPct).toBe(0);
  });

  it('ratchets the peak up but never down', () => {
    recordEquity(10000, '2026-01-02', FILE);
    recordEquity(30000, '2026-01-03', FILE);
    const h = recordEquity(27000, '2026-01-04', FILE);
    expect(h.peak).toBe(30000);
    expect(h.peakDate).toBe('2026-01-03');
    const dd = computeDrawdown(h);
    expect(dd.current).toBe(27000);
    expect(dd.drawdownPct).toBe(10); // (30000-27000)/30000
  });

  it('computes peak-to-current drawdown across days', () => {
    recordEquity(25000, '2026-01-10', FILE);
    const h = recordEquity(20000, '2026-01-18', FILE);
    const dd = computeDrawdown(h);
    expect(dd.peak).toBe(25000);
    expect(dd.current).toBe(20000);
    expect(dd.drawdownPct).toBe(20);
  });

  it('same-day re-mark updates current but preserves a higher peak', () => {
    // A lower intraday re-mark must not erase the peak set earlier the same day.
    recordEquity(25000, '2026-01-18', FILE);
    const h = recordEquity(20000, '2026-01-18', FILE);
    expect(h.snapshots).toHaveLength(1);
    expect(h.peak).toBe(25000);
    const dd = computeDrawdown(h);
    expect(dd.current).toBe(20000);
    expect(dd.drawdownPct).toBe(20);
  });

  it('drawdown is zero at a fresh all-time high', () => {
    recordEquity(10000, '2026-01-02', FILE);
    const h = recordEquity(12000, '2026-01-03', FILE);
    expect(computeDrawdown(h).drawdownPct).toBe(0);
  });
});
