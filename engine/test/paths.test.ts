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
  });

  it('uses ~/.finstack by default', async () => {
    delete process.env.FINSTACK_HOME;
    const mod = await import('../src/paths');
    expect(mod.FINSTACK_HOME).toContain('.finstack');
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
