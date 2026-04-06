// engine/test/commands/watchlist.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  tagTicker,
  untagTicker,
} from '../../src/data/watchlist';

const TEST_DIR = join(tmpdir(), `finstack-watchlist-test-${Date.now()}`);
const WATCHLIST_FILE = join(TEST_DIR, 'watchlist.json');

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
    addToWatchlist('NVDA', 'waiting for Q2 earnings', WATCHLIST_FILE);
    const list = loadWatchlist(WATCHLIST_FILE);
    expect(list).toHaveLength(1);
    expect(list[0].ticker).toBe('NVDA');
    expect(list[0].reason).toBe('waiting for Q2 earnings');
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
    expect(list[0].reason).toBe('reason 2');
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
