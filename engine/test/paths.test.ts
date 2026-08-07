// engine/test/paths.test.ts
import { afterEach, describe, expect, it } from 'bun:test';
import { paths } from '../src/paths';

describe('paths', () => {
  const originalEnv = process.env.FINSTACK_HOME;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.FINSTACK_HOME;
    } else {
      process.env.FINSTACK_HOME = originalEnv;
    }
  });

  it('uses ~/.finstack by default', () => {
    delete process.env.FINSTACK_HOME;
    expect(paths.FINSTACK_HOME).toContain('.finstack');
  });

  it('derives every path from FINSTACK_HOME', () => {
    const root = paths.FINSTACK_HOME;
    expect(paths.CACHE_DIR).toStartWith(root);
    expect(paths.JOURNAL_DIR).toStartWith(root);
    expect(paths.PATTERNS_DIR).toStartWith(root);
    expect(paths.REPORTS_DIR).toStartWith(root);
    expect(paths.PORTFOLIO_FILE).toStartWith(root);
    expect(paths.THESES_FILE).toStartWith(root);
    expect(paths.SHADOW_FILE).toStartWith(root);
    expect(paths.CONSENSUS_FILE).toStartWith(root);
    expect(paths.KEYS_FILE).toStartWith(root);
    expect(paths.WATCHLIST_FILE).toStartWith(root);
    expect(paths.PROFILE_FILE).toStartWith(root);
  });

  // The reason paths are getters rather than constants. With `export const X =
  // join(process.env.FINSTACK_HOME, ...)` the value froze at module load, so
  // the documented override only worked if the variable was set before the
  // module graph loaded — and every in-process test shared one directory.
  it('reflects a change to FINSTACK_HOME without re-importing', () => {
    process.env.FINSTACK_HOME = '/tmp/finstack-a';
    expect(paths.PORTFOLIO_FILE).toBe('/tmp/finstack-a/portfolio.json');

    process.env.FINSTACK_HOME = '/tmp/finstack-b';
    expect(paths.PORTFOLIO_FILE).toBe('/tmp/finstack-b/portfolio.json');
  });

  it('keeps every path in step after a change', () => {
    process.env.FINSTACK_HOME = '/tmp/finstack-c';
    expect(paths.CACHE_DIR).toBe('/tmp/finstack-c/cache');
    expect(paths.KEYS_FILE).toBe('/tmp/finstack-c/keys.json');
    expect(paths.JOURNAL_DIR).toBe('/tmp/finstack-c/journal');
  });
});
