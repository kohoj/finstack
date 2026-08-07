/**
 * Concurrency tests for state files.
 *
 * finstack state is mutated by read-modify-write cycles (load JSON, mutate the
 * array, write it back). Without a lock, two processes that interleave lose one
 * of the two updates: both read the same base, both write, last write wins.
 *
 * This is not theoretical. Skills run engine commands in parallel — /sense
 * fetches quotes concurrently while updating theses.json, and a user can run a
 * second Codex session at any time.
 *
 * These tests spawn real subprocesses. In-process concurrency would not
 * reproduce the bug: Bun's event loop makes each synchronous read-modify-write
 * atomic by accident, so the race only appears across processes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJSONSafe } from '../src/fs';

const CLI = join(import.meta.dir, '..', 'src', 'cli.ts');
const TEST_HOME = join(tmpdir(), `finstack-concurrency-${Date.now()}`);

function run(args: string[]): Promise<number> {
  const proc = Bun.spawn(['bun', 'run', CLI, ...args], {
    env: { ...process.env, FINSTACK_HOME: TEST_HOME },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  return proc.exited;
}

beforeEach(() => {
  mkdirSync(join(TEST_HOME, 'cache'), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('portfolio.json concurrent writes', () => {
  it('keeps every position when adds run in parallel', async () => {
    await run(['portfolio', 'init']);

    // Distinct tickers: every add must survive, so the expected end state is
    // unambiguous. Same-ticker adds would merge and hide a lost update.
    const tickers = Array.from({ length: 20 }, (_, i) => `T${String(i).padStart(3, '0')}`);

    await Promise.all(tickers.map(t => run(['portfolio', 'add', t, '10', '100'])));

    const portfolio = readJSONSafe<{ positions: { ticker: string }[] }>(
      join(TEST_HOME, 'portfolio.json'),
      { positions: [] },
    );

    const saved = new Set(portfolio.positions.map(p => p.ticker));
    const missing = tickers.filter(t => !saved.has(t));

    expect(missing).toEqual([]);
    expect(portfolio.positions).toHaveLength(tickers.length);
  }, 60_000);

  it('records every transaction when adds run in parallel', async () => {
    await run(['portfolio', 'init']);

    const tickers = Array.from({ length: 20 }, (_, i) => `X${String(i).padStart(3, '0')}`);
    await Promise.all(tickers.map(t => run(['portfolio', 'add', t, '5', '50'])));

    const portfolio = readJSONSafe<{ transactions: unknown[] }>(join(TEST_HOME, 'portfolio.json'), {
      transactions: [],
    });

    // The transaction log is the audit trail /reflect reads. A dropped entry
    // is a silently rewritten history, which is worse than a dropped position.
    expect(portfolio.transactions).toHaveLength(tickers.length);
  }, 60_000);
});

describe('watchlist.json concurrent writes', () => {
  it('keeps every entry when adds run in parallel', async () => {
    const tickers = Array.from({ length: 20 }, (_, i) => `W${String(i).padStart(3, '0')}`);

    await Promise.all(tickers.map(t => run(['watchlist', 'add', t, 'concurrency test'])));

    const list = readJSONSafe<{ ticker: string }[]>(join(TEST_HOME, 'watchlist.json'), []);
    const saved = new Set(list.map(w => w.ticker));

    expect(tickers.filter(t => !saved.has(t))).toEqual([]);
  }, 60_000);
});

describe('consensus.json concurrent writes', () => {
  it('keeps every assumption when adds run in parallel', async () => {
    const texts = Array.from({ length: 15 }, (_, i) => `assumption-${i}`);

    await Promise.all(texts.map(t => run(['regime', 'add', t])));

    const assumptions = readJSONSafe<{ assumption: string }[]>(
      join(TEST_HOME, 'consensus.json'),
      [],
    );

    expect(assumptions).toHaveLength(texts.length);
  }, 60_000);
});
