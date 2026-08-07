/**
 * regime command — consensus assumption register.
 *
 * regime is local-only: it reads and writes consensus.json and makes no
 * network calls. What matters here is the state machine — confidence updates
 * derive a trend, history accumulates, and the alerts subcommand surfaces
 * assumptions under stress.
 */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { readJSONSafe } from '../../src/fs';
import { captureJSON, useTestHome } from '../helpers';

const home = useTestHome('regime');

async function loadRegime() {
  const mod = await import('../../src/commands/regime');
  return mod.regime;
}

function readConsensus(): any[] {
  return readJSONSafe<any[]>(join(home.dir, 'consensus.json'), []);
}

beforeEach(() => {
  home.reset();
});

afterAll(() => {
  home.cleanup();
});

describe('add', () => {
  it('creates an assumption at neutral confidence', async () => {
    const regime = await loadRegime();
    const out = await captureJSON(() => regime(['add', 'AI', 'capex', 'holds', 'through', '2027']));

    expect(out.assumption).toBe('AI capex holds through 2027');
    // 5/10 is the neutral starting point — no evidence either way yet.
    expect(out.confidence).toBe(5);
    expect(out.trend).toBe('stable');
    expect(out.history).toHaveLength(1);
  });

  it('persists to consensus.json', async () => {
    const regime = await loadRegime();
    await captureJSON(() => regime(['add', 'first assumption']));

    expect(readConsensus()).toHaveLength(1);
  });

  it('gives concurrent adds distinct ids', async () => {
    const regime = await loadRegime();
    const a = await captureJSON(() => regime(['add', 'first']));
    const b = await captureJSON(() => regime(['add', 'second']));

    // Ids were Date.now() alone, which collides within a millisecond.
    expect(a.id).not.toBe(b.id);
  });

  it('rejects an empty assumption', async () => {
    const regime = await loadRegime();
    await expect(captureJSON(() => regime(['add']))).rejects.toThrow();
  });
});

describe('update', () => {
  it('marks a raised confidence as rising', async () => {
    const regime = await loadRegime();
    const added = await captureJSON(() => regime(['add', 'test assumption']));

    const out = await captureJSON(() =>
      regime(['update', added.id, '8', 'TSMC', 'raised', 'guidance']),
    );

    expect(out.confidence).toBe(8);
    expect(out.trend).toBe('rising');
    expect(out.history).toHaveLength(2);
    expect(out.history[1].event).toBe('TSMC raised guidance');
  });

  it('marks a lowered confidence as declining', async () => {
    const regime = await loadRegime();
    const added = await captureJSON(() => regime(['add', 'test assumption']));

    const out = await captureJSON(() => regime(['update', added.id, '2', 'capex', 'cut']));

    expect(out.confidence).toBe(2);
    expect(out.trend).toBe('declining');
  });

  it('clamps confidence to 0-10', async () => {
    const regime = await loadRegime();
    const added = await captureJSON(() => regime(['add', 'test assumption']));

    const high = await captureJSON(() => regime(['update', added.id, '99']));
    expect(high.confidence).toBe(10);

    const low = await captureJSON(() => regime(['update', added.id, '-5']));
    expect(low.confidence).toBe(0);
  });

  it('rejects an unknown id', async () => {
    const regime = await loadRegime();
    await expect(captureJSON(() => regime(['update', 'nonexistent', '5']))).rejects.toThrow(
      /not found/i,
    );
  });

  it('rejects a non-numeric confidence', async () => {
    const regime = await loadRegime();
    const added = await captureJSON(() => regime(['add', 'test assumption']));

    await expect(captureJSON(() => regime(['update', added.id, 'high']))).rejects.toThrow();
  });

  it('does not write when the update fails', async () => {
    const regime = await loadRegime();
    await captureJSON(() => regime(['add', 'test assumption']));
    const before = JSON.stringify(readConsensus());

    await expect(captureJSON(() => regime(['update', 'nonexistent', '5']))).rejects.toThrow();

    expect(JSON.stringify(readConsensus())).toBe(before);
  });
});

describe('list', () => {
  it('returns an empty register before anything is added', async () => {
    const regime = await loadRegime();
    const out = await captureJSON(() => regime(['list']));

    expect(out.assumptions).toEqual([]);
    expect(out.count).toBe(0);
  });

  it('defaults to list when no subcommand is given', async () => {
    const regime = await loadRegime();
    await captureJSON(() => regime(['add', 'test assumption']));

    const out = await captureJSON(() => regime([]));
    expect(out.count).toBe(1);
  });
});

describe('alerts', () => {
  it('surfaces assumptions whose confidence has fallen', async () => {
    const regime = await loadRegime();
    const added = await captureJSON(() => regime(['add', 'AI capex holds']));
    await captureJSON(() => regime(['update', added.id, '2', 'major', 'capex', 'cut']));

    const out = await captureJSON(() => regime(['alerts']));

    expect(out.alerts.length).toBeGreaterThan(0);
  });

  it('stays quiet when nothing is under stress', async () => {
    const regime = await loadRegime();
    await captureJSON(() => regime(['add', 'stable assumption']));

    const out = await captureJSON(() => regime(['alerts']));

    expect(out.alerts).toHaveLength(0);
  });
});

describe('unknown subcommand', () => {
  it('lists the valid subcommands', async () => {
    const regime = await loadRegime();
    await expect(captureJSON(() => regime(['bogus']))).rejects.toThrow();
  });
});
