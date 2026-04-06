/**
 * Input validation edge case tests.
 * Covers bugs discovered during dogfooding.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { calculatePositionSize } from '../../src/commands/risk';
import {
  addToWatchlist,
  tagTicker,
  untagTicker,
} from '../../src/data/watchlist';

const TEST_DIR = join(tmpdir(), `finstack-validation-test-${Date.now()}`);
const WATCHLIST_FILE = join(TEST_DIR, 'watchlist.json');

describe('position sizing edge cases', () => {
  it('returns 0 shares when stop equals entry', () => {
    const result = calculatePositionSize(100000, 2, 100, 100);
    expect(result.shares).toBe(0);
  });

  it('handles very small risk per share', () => {
    // Entry 100, stop 99.99 = $0.01 risk per share
    const result = calculatePositionSize(100000, 2, 100, 99.99);
    expect(result.shares).toBeGreaterThan(0);
    expect(result.riskDollars).toBe(2000);
  });

  it('handles very large portfolio values', () => {
    const result = calculatePositionSize(10_000_000, 2, 500, 450);
    expect(result.shares).toBe(4000); // 200k risk budget / 50 risk per share
    expect(result.positionDollars).toBe(2000000);
  });
});

describe('watchlist tag on non-existent ticker', () => {
  beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('tagTicker returns false for non-existent ticker', () => {
    const result = tagTicker('NONEXIST', 'ai', WATCHLIST_FILE);
    expect(result).toBe(false);
  });

  it('tagTicker returns true for existing ticker', () => {
    addToWatchlist('NVDA', 'test', WATCHLIST_FILE);
    const result = tagTicker('NVDA', 'ai', WATCHLIST_FILE);
    expect(result).toBe(true);
  });
});

describe('ticker validation edge cases', () => {
  beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('rejects ticker with spaces', () => {
    expect(() => addToWatchlist('NV DA', 'test', WATCHLIST_FILE)).toThrow();
  });

  it('rejects ticker with shell metacharacters', () => {
    expect(() => addToWatchlist('$(whoami)', 'test', WATCHLIST_FILE)).toThrow();
    expect(() => addToWatchlist('`ls`', 'test', WATCHLIST_FILE)).toThrow();
    expect(() => addToWatchlist('A;B', 'test', WATCHLIST_FILE)).toThrow();
  });

  it('accepts BRK.B style tickers', () => {
    addToWatchlist('BRK.B', 'test', WATCHLIST_FILE);
    expect(true).toBe(true); // didn't throw
  });

  it('accepts BF-B style tickers', () => {
    addToWatchlist('BF-B', 'test', WATCHLIST_FILE);
    expect(true).toBe(true);
  });

  it('rejects ticker longer than 10 chars', () => {
    expect(() => addToWatchlist('TOOLONGTICKE', 'test', WATCHLIST_FILE)).toThrow();
  });
});
