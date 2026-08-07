import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatThesisHistory, formatThesisList } from '../../src/commands/thesis';
import { killThesis, loadTheses, registerThesis } from '../../src/data/thesis';

const TEST_DIR = join(tmpdir(), `.finstack-test-thesiscmd-${Date.now()}`);
const TEST_FILE = join(TEST_DIR, 'theses.json');

describe('thesis commands', () => {
  beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterEach(() => {
    if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
  });

  it('formatThesisList produces table output', () => {
    registerThesis(
      {
        ticker: 'NVDA',
        thesis: 'AI capex continues',
        verdict: 'lean-buy',
        conditions: [
          {
            description: 'EPS beat',
            type: 'earnings',
            metric: 'surprisePct',
            operator: '>',
            threshold: 5,
            resolveBy: '2026-08-28',
          },
        ],
      },
      TEST_FILE,
    );
    const data = loadTheses(TEST_FILE);
    const output = formatThesisList(data.theses);
    expect(output.length).toBe(1);
    expect(output[0].ticker).toBe('NVDA');
    expect(output[0].status).toBe('ALIVE');
    expect(output[0].conditions).toBe('1 pending');
  });

  it('formatThesisHistory produces summary', () => {
    registerThesis(
      {
        ticker: 'NVDA',
        thesis: 't1',
        verdict: 'buy',
        conditions: [{ description: 'x', type: 'event', falsificationTest: '?', watchTickers: [] }],
      },
      TEST_FILE,
    );
    registerThesis(
      {
        ticker: 'AAPL',
        thesis: 't2',
        verdict: 'buy',
        conditions: [{ description: 'x', type: 'event', falsificationTest: '?', watchTickers: [] }],
      },
      TEST_FILE,
    );
    const data = loadTheses(TEST_FILE);
    killThesis(data.theses[0].id, 'earnings miss', TEST_FILE);
    const updated = loadTheses(TEST_FILE);
    const summary = formatThesisHistory(updated.theses);
    expect(summary.total).toBe(2);
    expect(summary.alive).toBe(1);
    expect(summary.dead).toBe(1);
  });
});

// ── thesis add ──────────────────────────────────────────────────────────────
//
// /judge composes a thesis from the adversarial exchange and pipes it in.
// Before this command existed the skill wrote theses.json directly, so a
// malformed thesis reached disk with no signal.

import { captureJSON, useTestHome } from '../helpers';

const addHome = useTestHome('thesis-add');

async function loadThesisCmd() {
  const mod = await import('../../src/commands/thesis');
  return mod.thesis;
}

function thesisDoc(overrides: Record<string, unknown> = {}) {
  return {
    ticker: 'NVDA',
    thesis: 'Datacenter demand outlasts the current capex cycle',
    verdict: 'Leaning buy, contingent on Q2 margins',
    conditions: [
      {
        description: 'Q2 gross margin stays above 70%',
        type: 'earnings',
        metric: 'grossMargin',
        operator: '>',
        threshold: 0.7,
        resolveBy: '2026-08-20',
      },
    ],
    ...overrides,
  };
}

async function pipeIn<T>(payload: string, fn: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, 'stdin');
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    value: {
      isTTY: false,
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(payload, 'utf-8');
      },
    },
  });
  try {
    return await fn();
  } finally {
    if (original) Object.defineProperty(process, 'stdin', original);
  }
}

describe('thesis add', () => {
  beforeEach(() => addHome.reset());
  afterAll(() => addHome.cleanup());

  it('registers a valid thesis', async () => {
    const cmd = await loadThesisCmd();
    const out = await pipeIn(JSON.stringify(thesisDoc()), () => captureJSON(() => cmd(['add'])));

    expect(out.ticker).toBe('NVDA');
    expect(out.status).toBe('alive');
    expect(out.conditions).toHaveLength(1);
    // Ids are assigned by the store, not supplied by the caller.
    expect(out.id).toMatch(/^t/);
    expect(out.conditions[0].id).toMatch(/^c/);
  });

  it('appends rather than replacing', async () => {
    const cmd = await loadThesisCmd();
    await pipeIn(JSON.stringify(thesisDoc()), () => captureJSON(() => cmd(['add'])));
    await pipeIn(JSON.stringify(thesisDoc({ ticker: 'AMD' })), () =>
      captureJSON(() => cmd(['add'])),
    );

    const list = await captureJSON(() => cmd(['list']));
    expect(list).toHaveLength(2);
  });

  it('rejects a thesis with no falsifiable condition', async () => {
    const cmd = await loadThesisCmd();
    await expect(
      pipeIn(JSON.stringify(thesisDoc({ conditions: [] })), () => captureJSON(() => cmd(['add']))),
    ).rejects.toThrow();
  });

  it('writes nothing when validation fails', async () => {
    const cmd = await loadThesisCmd();
    await expect(
      pipeIn(JSON.stringify(thesisDoc({ ticker: '../etc' })), () =>
        captureJSON(() => cmd(['add'])),
      ),
    ).rejects.toThrow();

    const list = await captureJSON(() => cmd(['list']));
    expect(list).toHaveLength(0);
  });

  it('prints the schema without reading stdin', async () => {
    const cmd = await loadThesisCmd();
    const { captureStdout } = await import('../helpers');
    const out = await captureStdout(() => cmd(['add', '--schema']));

    expect(out).toContain('falsificationTest');
    expect(out).toContain('resolveBy');
  });
});

// ── thesis threaten / transition ────────────────────────────────────────────
//
// /sense records threats as it scans. These were previously done by editing
// theses.json directly from the skill, which meant a malformed threat — or one
// attached to the wrong condition type — reached disk unnoticed.

describe('thesis threaten', () => {
  beforeEach(() => addHome.reset());

  async function seed() {
    const cmd = await loadThesisCmd();
    const created = await pipeIn(
      JSON.stringify(
        thesisDoc({
          conditions: [
            {
              description: 'No hyperscaler cuts capex',
              type: 'event',
              falsificationTest: 'Has any top-4 guided capex down >10%?',
              watchTickers: ['MSFT'],
            },
            {
              description: 'Q2 margin above 70%',
              type: 'earnings',
              metric: 'grossMargin',
              operator: '>',
              threshold: 0.7,
              resolveBy: '2026-08-20',
            },
          ],
        }),
      ),
      () => captureJSON(() => cmd(['add'])),
    );
    return { cmd, created };
  }

  it('attaches a threat and moves alive to threatened', async () => {
    const { cmd, created } = await seed();
    const eventCond = created.conditions.find((c: any) => c.type === 'event');

    const out = await captureJSON(() =>
      cmd([
        'threaten',
        created.id,
        '--condition',
        eventCond.id,
        '--source',
        'MSFT Q3 call',
        '--reasoning',
        'Guided capex growth to single digits',
      ]),
    );

    expect(out.status).toBe('threatened');
    const cond = out.conditions.find((c: any) => c.id === eventCond.id);
    expect(cond.threats).toHaveLength(1);
    expect(cond.threats[0].source).toBe('MSFT Q3 call');
  });

  // Threat count is the signal — three independent sources means something
  // one does not — so each is recorded rather than overwriting the last.
  it('accumulates threats', async () => {
    const { cmd, created } = await seed();
    const eventCond = created.conditions.find((c: any) => c.type === 'event');

    for (const source of ['MSFT call', 'GOOGL call', 'analyst note']) {
      await captureJSON(() =>
        cmd([
          'threaten',
          created.id,
          '--condition',
          eventCond.id,
          '--source',
          source,
          '--reasoning',
          'r',
        ]),
      );
    }

    const list = await captureJSON(() => cmd(['list']));
    expect(list).toHaveLength(1);

    const { loadTheses } = await import('../../src/data/thesis');
    const stored = loadTheses().theses[0];
    const cond = stored.conditions.find(c => c.id === eventCond.id);
    expect(cond?.type === 'event' && cond.threats).toHaveLength(3);
  });

  it('does not re-transition an already threatened thesis', async () => {
    const { cmd, created } = await seed();
    const eventCond = created.conditions.find((c: any) => c.type === 'event');

    await captureJSON(() =>
      cmd([
        'threaten',
        created.id,
        '--condition',
        eventCond.id,
        '--source',
        'a',
        '--reasoning',
        'r',
      ]),
    );
    const out = await captureJSON(() =>
      cmd([
        'threaten',
        created.id,
        '--condition',
        eventCond.id,
        '--source',
        'b',
        '--reasoning',
        'r',
      ]),
    );

    // One transition, not two — the history should not fill with duplicates.
    const transitions = out.statusHistory.filter((h: any) => h.to === 'threatened');
    expect(transitions).toHaveLength(1);
  });

  it('refuses to attach a threat to an earnings condition', async () => {
    const { cmd, created } = await seed();
    const earningsCond = created.conditions.find((c: any) => c.type === 'earnings');

    await expect(
      captureJSON(() =>
        cmd([
          'threaten',
          created.id,
          '--condition',
          earningsCond.id,
          '--source',
          'a',
          '--reasoning',
          'r',
        ]),
      ),
    ).rejects.toThrow(/earnings condition/i);
  });

  it('lists the available condition ids when given an unknown one', async () => {
    const { cmd, created } = await seed();
    try {
      await captureJSON(() =>
        cmd(['threaten', created.id, '--condition', 'cbogus', '--source', 'a', '--reasoning', 'r']),
      );
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.reason).toContain(created.conditions[0].id);
    }
  });

  it('requires source and reasoning', async () => {
    const { cmd, created } = await seed();
    const eventCond = created.conditions.find((c: any) => c.type === 'event');

    await expect(
      captureJSON(() =>
        cmd(['threaten', created.id, '--condition', eventCond.id, '--source', 'a']),
      ),
    ).rejects.toThrow();
  });

  it('rejects an invalid confidence', async () => {
    const { cmd, created } = await seed();
    const eventCond = created.conditions.find((c: any) => c.type === 'event');

    await expect(
      captureJSON(() =>
        cmd([
          'threaten',
          created.id,
          '--condition',
          eventCond.id,
          '--source',
          'a',
          '--reasoning',
          'r',
          '--confidence',
          'certain',
        ]),
      ),
    ).rejects.toThrow(/confidence/i);
  });
});

describe('thesis transition', () => {
  beforeEach(() => addHome.reset());

  it('records the move and its reason', async () => {
    const cmd = await loadThesisCmd();
    const created = await pipeIn(JSON.stringify(thesisDoc()), () =>
      captureJSON(() => cmd(['add'])),
    );

    const out = await captureJSON(() =>
      cmd(['transition', created.id, 'critical', 'Second independent source']),
    );

    expect(out.status).toBe('critical');
    const last = out.statusHistory[out.statusHistory.length - 1];
    expect(last.reason).toBe('Second independent source');
  });

  // Killing also schedules the obituary /reflect reads 90 days later, so it
  // must not be reachable through a plain status change.
  it('refuses to set dead, pointing at kill', async () => {
    const cmd = await loadThesisCmd();
    const created = await pipeIn(JSON.stringify(thesisDoc()), () =>
      captureJSON(() => cmd(['add'])),
    );

    try {
      await captureJSON(() => cmd(['transition', created.id, 'dead', 'wrong']));
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.suggestion).toContain('kill');
    }
  });

  it('rejects an unknown thesis', async () => {
    const cmd = await loadThesisCmd();
    await expect(
      captureJSON(() => cmd(['transition', 'tbogus', 'critical', 'reason'])),
    ).rejects.toThrow(/not found/i);
  });

  it('requires a reason', async () => {
    const cmd = await loadThesisCmd();
    const created = await pipeIn(JSON.stringify(thesisDoc()), () =>
      captureJSON(() => cmd(['add'])),
    );

    await expect(captureJSON(() => cmd(['transition', created.id, 'critical']))).rejects.toThrow();
  });
});
