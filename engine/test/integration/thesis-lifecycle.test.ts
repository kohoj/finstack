/**
 * Thesis lifecycle — register, transition, threaten, kill, obituary.
 *
 * A thesis is a falsifiable claim with machine-checkable conditions. Its state
 * machine spans skills: /judge registers, /sense adds threats and transitions,
 * the user kills, and /reflect reads the obituary queue 90 days later.
 *
 * The tests below assert the transitions hold together as a sequence, since no
 * single command owns the whole cycle.
 */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { useTestHome } from '../helpers';

const home = useTestHome('thesis-lifecycle');

async function load() {
  return import('../../src/data/thesis');
}

const baseThesis = {
  ticker: 'NVDA',
  thesis: 'Datacenter demand outlasts the current capex cycle',
  verdict: 'Leaning buy, contingent on Q2 margins',
  conditions: [
    {
      description: 'Q2 gross margin stays above 70%',
      type: 'earnings' as const,
      metric: 'grossMargin',
      operator: '>',
      threshold: 0.7,
      resolveBy: '2026-08-20',
    },
    {
      description: 'No major hyperscaler cuts capex guidance',
      type: 'event' as const,
      falsificationTest: 'Any top-4 hyperscaler guides capex down more than 10%',
      watchTickers: ['MSFT', 'GOOGL', 'AMZN', 'META'],
    },
  ],
};

beforeEach(() => {
  home.reset();
});

afterAll(() => {
  home.cleanup();
});

describe('registration', () => {
  it('starts alive with every condition pending', async () => {
    const { registerThesis } = await load();
    const t = registerThesis(baseThesis);

    expect(t.status).toBe('alive');
    expect(t.conditions).toHaveLength(2);
    expect(t.conditions.every(c => c.status === 'pending')).toBe(true);
    expect(t.obituaryDueDate).toBeNull();
  });

  it('records who created it', async () => {
    const { registerThesis } = await load();
    const t = registerThesis(baseThesis);

    expect(t.statusHistory).toHaveLength(1);
    expect(t.statusHistory[0].from).toBeNull();
    expect(t.statusHistory[0].to).toBe('alive');
    expect(t.statusHistory[0].reason).toContain('/judge');
  });

  it('preserves the distinction between condition types', async () => {
    const { registerThesis } = await load();
    const t = registerThesis(baseThesis);

    const earnings = t.conditions.find(c => c.type === 'earnings');
    const event = t.conditions.find(c => c.type === 'event');

    // Earnings conditions resolve against a number on a known date; event
    // conditions accumulate threats and are judged qualitatively.
    expect(earnings).toMatchObject({ metric: 'grossMargin', threshold: 0.7 });
    expect(event).toMatchObject({ watchTickers: ['MSFT', 'GOOGL', 'AMZN', 'META'] });
  });

  it('uppercases the ticker', async () => {
    const { registerThesis } = await load();
    const t = registerThesis({ ...baseThesis, ticker: 'nvda' });
    expect(t.ticker).toBe('NVDA');
  });

  it('gives back-to-back registrations distinct ids', async () => {
    const { registerThesis } = await load();
    const a = registerThesis(baseThesis);
    const b = registerThesis({ ...baseThesis, ticker: 'AMD' });

    expect(a.id).not.toBe(b.id);
    // Condition ids are referenced by /sense when attaching threats.
    expect(a.conditions[0].id).not.toBe(b.conditions[0].id);
  });
});

describe('transitions', () => {
  it('moves alive -> threatened and records why', async () => {
    const { registerThesis, transitionThesis, loadTheses } = await load();
    const t = registerThesis(baseThesis);

    transitionThesis(t.id, 'threatened', 'MSFT guided capex down 8%');

    const stored = loadTheses().theses.find(x => x.id === t.id);
    expect(stored?.status).toBe('threatened');
    expect(stored?.statusHistory).toHaveLength(2);
    expect(stored?.statusHistory[1]).toMatchObject({ from: 'alive', to: 'threatened' });
  });

  it('supports escalation and recovery', async () => {
    const { registerThesis, transitionThesis, loadTheses } = await load();
    const t = registerThesis(baseThesis);

    transitionThesis(t.id, 'threatened', 'early warning');
    transitionThesis(t.id, 'critical', 'second data point');
    transitionThesis(t.id, 'reinforced', 'guidance reversed');

    const stored = loadTheses().theses.find(x => x.id === t.id);
    expect(stored?.status).toBe('reinforced');
    // The full path is retained — /reflect reads it to judge whether the user
    // reacted to noise.
    expect(stored?.statusHistory.map(h => h.to)).toEqual([
      'alive',
      'threatened',
      'critical',
      'reinforced',
    ]);
  });

  it('ignores an unknown id rather than throwing', async () => {
    const { transitionThesis, loadTheses } = await load();
    expect(() => transitionThesis('nonexistent', 'threatened', 'x')).not.toThrow();
    expect(loadTheses().theses).toHaveLength(0);
  });
});

describe('threats', () => {
  it('attaches a threat to an event condition', async () => {
    const { registerThesis, addThreat, loadTheses } = await load();
    const t = registerThesis(baseThesis);
    const eventCond = t.conditions.find(c => c.type === 'event')!;

    addThreat(t.id, eventCond.id, {
      date: '2026-05-01',
      source: 'MSFT earnings call',
      confidence: 'moderate',
      reasoning: 'Capex growth guided to slow in H2',
    });

    const stored = loadTheses().theses.find(x => x.id === t.id);
    const cond = stored?.conditions.find(c => c.id === eventCond.id);
    expect(cond?.type === 'event' && cond.threats).toHaveLength(1);
  });

  it('accumulates threats rather than replacing them', async () => {
    const { registerThesis, addThreat, loadTheses } = await load();
    const t = registerThesis(baseThesis);
    const eventCond = t.conditions.find(c => c.type === 'event')!;

    for (const src of ['MSFT call', 'GOOGL call', 'analyst note']) {
      addThreat(t.id, eventCond.id, {
        date: '2026-05-01',
        source: src,
        confidence: 'low',
        reasoning: 'x',
      });
    }

    const stored = loadTheses().theses.find(x => x.id === t.id);
    const cond = stored?.conditions.find(c => c.id === eventCond.id);
    // Threat count is the signal: three independent sources is a real warning.
    expect(cond?.type === 'event' && cond.threats).toHaveLength(3);
  });

  it('does not attach a threat to an earnings condition', async () => {
    const { registerThesis, addThreat, loadTheses } = await load();
    const t = registerThesis(baseThesis);
    const earningsCond = t.conditions.find(c => c.type === 'earnings')!;

    expect(() =>
      addThreat(t.id, earningsCond.id, {
        date: '2026-05-01',
        source: 'x',
        confidence: 'low',
        reasoning: 'y',
      }),
    ).not.toThrow();

    // Earnings conditions resolve against a reported number, so a qualitative
    // threat has nowhere to go.
    const stored = loadTheses().theses.find(x => x.id === t.id);
    expect(stored?.conditions.find(c => c.id === earningsCond.id)?.status).toBe('pending');
  });
});

describe('death and obituary', () => {
  it('schedules the obituary 90 days after creation', async () => {
    const { registerThesis, killThesis, loadTheses } = await load();
    const t = registerThesis(baseThesis);

    killThesis(t.id, 'Margin thesis invalidated by Q2');

    const stored = loadTheses().theses.find(x => x.id === t.id);
    expect(stored?.status).toBe('dead');

    const created = new Date(stored!.createdAt);
    created.setDate(created.getDate() + 90);
    expect(stored?.obituaryDueDate).toBe(created.toISOString().split('T')[0]);
  });

  it('keeps dead theses out of the active list', async () => {
    const { registerThesis, killThesis, getAlive, getDead } = await load();
    const a = registerThesis(baseThesis);
    registerThesis({ ...baseThesis, ticker: 'AMD' });

    killThesis(a.id, 'invalidated');

    expect(getAlive().map(t => t.ticker)).toEqual(['AMD']);
    expect(getDead().map(t => t.ticker)).toEqual(['NVDA']);
  });

  it('holds the obituary until its due date', async () => {
    const { registerThesis, killThesis, getObituaryQueue } = await load();
    const t = registerThesis(baseThesis);
    killThesis(t.id, 'invalidated');

    // Due 90 days out, so nothing is ready for review today.
    expect(getObituaryQueue()).toHaveLength(0);
  });

  it('surfaces the obituary once due', async () => {
    const { registerThesis, killThesis, loadTheses, getObituaryQueue } = await load();
    const t = registerThesis(baseThesis);
    killThesis(t.id, 'invalidated');

    // Backdate: rewrite the due date to yesterday.
    const { atomicWriteJSON } = await import('../../src/fs');
    const { paths } = await import('../../src/paths');
    const store = loadTheses();
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    store.theses[0].obituaryDueDate = yesterday;
    atomicWriteJSON(paths.THESES_FILE, store);

    expect(getObituaryQueue()).toHaveLength(1);
  });

  it('treats a kill as terminal in the history', async () => {
    const { registerThesis, transitionThesis, killThesis, loadTheses } = await load();
    const t = registerThesis(baseThesis);

    transitionThesis(t.id, 'threatened', 'warning');
    killThesis(t.id, 'confirmed wrong');

    const stored = loadTheses().theses.find(x => x.id === t.id);
    const last = stored!.statusHistory[stored!.statusHistory.length - 1];
    expect(last).toMatchObject({ from: 'threatened', to: 'dead' });
    expect(last.reason).toBe('confirmed wrong');
  });
});
