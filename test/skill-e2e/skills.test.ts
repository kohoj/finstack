/**
 * E2E tests for all nine skills.
 *
 * Each case drives a real skill through `claude -p` against fixture state and
 * asserts its structural contract: the engine commands it invokes, what it
 * writes to FINSTACK_HOME, and the markers its documented output format
 * requires.
 *
 * These do not assert on the analysis. A skill that writes a well-formed
 * journal entry containing bad reasoning is a reasoning bug, and no string
 * match will catch it — but a skill that stops writing journal entries, or
 * stops calling the engine, is a regression this will catch.
 *
 * Gated behind EVALS=1. Each case costs API calls and takes minutes.
 *   EVALS=1 bun test test/skill-e2e/
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { claudeAvailable, runSkill, type SkillResult, shouldRunE2E } from './runner';

const FIXTURES = join(import.meta.dir, 'fixtures');
const TIMEOUT = 5 * 60 * 1000;
const CASE_TIMEOUT = TIMEOUT + 30_000;

const RUN = shouldRunE2E() && claudeAvailable();

// Tests own the test home so they can inspect it; release it afterwards.
let active: SkillResult | undefined;

afterEach(() => {
  active?.cleanup();
  active = undefined;
});

async function run(skill: string, prompt = ''): Promise<SkillResult> {
  active = await runSkill(skill, prompt, { fixturesDir: FIXTURES, timeout: TIMEOUT });
  return active;
}

/** Journal entries whose filename contains the given fragment. */
function journalMatching(result: SkillResult, fragment: string): string[] {
  return result.journalFiles.filter(f => f.includes(fragment));
}

describe.skipIf(!RUN)('/sense', () => {
  it(
    'scans sources and writes a briefing',
    async () => {
      const r = await run('sense');

      expect(r.success).toBe(true);
      // sense reads the user's world before scanning it — a briefing that
      // ignores holdings is the generic market summary it exists to replace.
      expect(r.engineCommands).toContain('scan');
      expect(r.journalFiles.some(f => f.startsWith('sense-'))).toBe(true);
    },
    CASE_TIMEOUT,
  );
});

describe.skipIf(!RUN)('/research', () => {
  it(
    'gathers financials and writes a memo',
    async () => {
      const r = await run('research', 'NVDA');

      expect(r.success).toBe(true);
      expect(r.engineCommands).toContain('financials');
      expect(journalMatching(r, 'research-NVDA').length).toBeGreaterThan(0);
    },
    CASE_TIMEOUT,
  );

  it(
    'reports numbers in context rather than as a table',
    async () => {
      const r = await run('research', 'NVDA');

      // The skill explicitly forbids a metrics dump: every number must answer
      // "so what". A bare `PE: 45.2x | PB: 12.3x` line is the failure mode.
      expect(r.transcript).not.toMatch(/PE:\s*[\d.]+x\s*\|\s*PB:/);
    },
    CASE_TIMEOUT,
  );
});

describe.skipIf(!RUN)('/judge', () => {
  it(
    'runs an adversarial exchange and registers a thesis',
    async () => {
      const r = await run('judge', 'NVDA');

      expect(r.success).toBe(true);
      expect(r.engineCommands).toContain('quote');

      // Both sides must appear — a verdict with only a bull case is the
      // failure this skill is built to prevent.
      expect(r.transcript).toMatch(/bull/i);
      expect(r.transcript).toMatch(/bear/i);

      // Verdicts are conditional, not scored. "Confidence: 7/10" is the
      // anti-pattern the skill names explicitly.
      expect(r.transcript).not.toMatch(/confidence:\s*\d+\s*\/\s*10/i);
    },
    CASE_TIMEOUT,
  );

  it(
    'appends to theses.json without dropping existing entries',
    async () => {
      const r = await run('judge', 'AMD');

      const theses = r.readHomeFile('theses.json');
      expect(theses).not.toBeNull();
      // The fixture thesis must survive: /judge appends, it does not replace.
      expect(theses).toContain('t_test1');
    },
    CASE_TIMEOUT,
  );
});

describe.skipIf(!RUN)('/act', () => {
  it(
    'refuses to plan without a prior judgment',
    async () => {
      // No journal entry exists for TSLA in the fixtures. The skill's first
      // gate exists to stop impulse trades, so this must not produce a plan.
      const r = await run('act', 'TSLA');

      expect(r.transcript).toMatch(/judge/i);
    },
    CASE_TIMEOUT,
  );

  it(
    'sizes a position through the risk gate',
    async () => {
      const r = await run('act', 'NVDA');

      expect(r.success).toBe(true);
      // Sizing is computed, never estimated by the model.
      expect(r.engineCommands).toContain('risk');
    },
    CASE_TIMEOUT,
  );
});

describe.skipIf(!RUN)('/cascade', () => {
  it(
    'traces chains and maps them onto holdings',
    async () => {
      const r = await run('cascade', 'TSMC cuts capital expenditure 20%');

      expect(r.success).toBe(true);
      expect(journalMatching(r, 'cascade-').length).toBeGreaterThan(0);

      // The output is ordered by certainty, not by topic — that ordering is
      // what makes a speculative third-order claim legible as speculative.
      expect(r.transcript).toMatch(/first[- ]order/i);
    },
    CASE_TIMEOUT,
  );
});

describe.skipIf(!RUN)('/track', () => {
  it(
    'compares the real portfolio against the shadow',
    async () => {
      const r = await run('track');

      expect(r.success).toBe(true);
      expect(r.engineCommands).toContain('alpha');
      expect(journalMatching(r, 'track-').length).toBeGreaterThan(0);
    },
    CASE_TIMEOUT,
  );
});

describe.skipIf(!RUN)('/reflect', () => {
  it(
    'separates process from outcome and records patterns',
    async () => {
      const r = await run('reflect');

      expect(r.success).toBe(true);
      expect(journalMatching(r, 'reflect-').length).toBeGreaterThan(0);

      // The luck/skill split is the point of the skill. A review that only
      // reports returns has not done the work.
      expect(r.transcript).toMatch(/luck|process|skill/i);
    },
    CASE_TIMEOUT,
  );
});

describe.skipIf(!RUN)('/screen', () => {
  it(
    'runs a preset screen',
    async () => {
      const r = await run('screen', '--preset growth --limit 3');

      expect(r.success).toBe(true);
      expect(r.engineCommands).toContain('screen');
    },
    CASE_TIMEOUT,
  );

  it(
    'writes no state',
    async () => {
      const r = await run('screen', '--preset value --limit 3');

      // screen is a search, not a decision. It is the one skill that records
      // nothing — see CONTRIBUTING.md#architecture-constraints.
      expect(r.journalFiles).toHaveLength(0);
    },
    CASE_TIMEOUT,
  );
});

describe.skipIf(!RUN)('/review', () => {
  it(
    'aggregates a period into a narrative',
    async () => {
      const r = await run('review', '--period week');

      expect(r.success).toBe(true);
      expect(r.engineCommands).toContain('review');
      expect(journalMatching(r, 'review-').length).toBeGreaterThan(0);
    },
    CASE_TIMEOUT,
  );
});

// Always runs — verifies the harness itself without spending API calls.
describe('runner', () => {
  it('is gated off unless EVALS=1', () => {
    const original = process.env.EVALS;
    delete process.env.EVALS;
    expect(shouldRunE2E()).toBe(false);
    if (original) process.env.EVALS = original;
  });

  it('reports claude availability as a boolean', () => {
    expect(typeof claudeAvailable()).toBe('boolean');
  });

  it('returns a result rather than throwing when the skill does not exist', async () => {
    const r = await runSkill('definitely-not-a-skill', '', { timeout: 5_000 });
    try {
      expect(typeof r.success).toBe('boolean');
      expect(typeof r.duration).toBe('number');
      expect(Array.isArray(r.engineCommands)).toBe(true);
      expect(Array.isArray(r.journalFiles)).toBe(true);
    } finally {
      r.cleanup();
    }
  }, 15_000);

  it('seeds the test home from fixtures and cleans up on request', async () => {
    const r = await runSkill('definitely-not-a-skill', '', {
      timeout: 5_000,
      fixturesDir: FIXTURES,
    });
    try {
      // Fixtures are copied in before the skill runs, so a skill that reads
      // portfolio.json sees the seeded state rather than an empty home.
      expect(r.readHomeFile('portfolio.json')).toContain('NVDA');
      expect(r.readHomeFile('shadow.json')).toContain('t_test1');
    } finally {
      r.cleanup();
      // cleanup() removes the home, so reads afterwards return null.
      expect(r.readHomeFile('portfolio.json')).toBeNull();
    }
  }, 15_000);
});
