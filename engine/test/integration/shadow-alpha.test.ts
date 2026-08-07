/**
 * Shadow portfolio -> cognitive alpha.
 *
 * The shadow portfolio is the "perfectly disciplined you": what the account
 * would hold if every /act plan were followed exactly. Comparing it against the
 * real portfolio separates analytical skill from execution, which is the one
 * claim finstack makes that no other tool does.
 *
 * The link is only exercised end to end here. alpha.test.ts covers the
 * arithmetic in isolation; these tests cover the join — real transactions
 * matched against shadow entries, and behavioral cost attributed to a named
 * pattern.
 */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import type { StagedTranche } from '../../src/data/shadow';
import { captureJSON, captureStdout, useTestHome } from '../helpers';

const home = useTestHome('shadow-alpha');

async function load() {
  const alphaMod = await import('../../src/commands/alpha');
  const portfolioMod = await import('../../src/commands/portfolio');
  const shadowMod = await import('../../src/data/shadow');
  return { alpha: alphaMod.alpha, portfolio: portfolioMod.portfolio, shadow: shadowMod };
}

/** A filled single-tranche shadow entry — the disciplined plan executed. */
function shadowPlan(ticker: string, entryPrice: number, shares: number) {
  return {
    ticker,
    action: 'buy',
    entryDate: '2026-01-01',
    totalShares: shares,
    stagedPlan: [
      {
        tranche: 1,
        shares,
        trigger: 'immediate',
        status: 'filled',
        fillPrice: entryPrice,
      },
    ] as StagedTranche[],
    stopLoss: { price: entryPrice * 0.9, reason: '10% stop' },
    takeProfit: { price: entryPrice * 1.3, reason: '30% target' },
    timeHorizon: '2026-12-31',
    linkedThesis: null,
    sourceJudge: 'test',
    sourceAct: 'test',
  };
}

beforeEach(() => {
  home.reset();
});

afterAll(() => {
  home.cleanup();
});

describe('no history', () => {
  it('asks for decisions rather than reporting a zero result', async () => {
    const { alpha, portfolio } = await load();
    await captureJSON(() => portfolio(['init']));

    const out = await captureJSON(() => alpha([]));

    // A zeroed report would read as "no edge"; this says "not enough data yet".
    expect(out.message).toContain('No completed decision cycles');
    expect(out.decisionsNeeded).toBe(3);
  });

  it('ignores open positions — only closed cycles count', async () => {
    const { alpha, portfolio } = await load();
    await captureJSON(() => portfolio(['init']));
    await captureJSON(() => portfolio(['add', 'NVDA', '10', '800']));

    const out = await captureJSON(() => alpha([]));

    expect(out.message).toContain('No completed decision cycles');
  });
});

describe('execution drag', () => {
  it('charges the gap when the user exits before the plan', async () => {
    const { alpha, portfolio, shadow } = await load();
    await captureJSON(() => portfolio(['init']));

    // /act records the plan first.
    shadow.createEntry(shadowPlan('NVDA', 800, 10));

    // The user buys, then panic-sells at 850.
    await captureJSON(() => portfolio(['add', 'NVDA', '10', '800']));
    await captureStdout(() =>
      portfolio(['remove', 'NVDA', '--price', '850', '--reason', 'emotional']),
    );

    // The plan would have exited at the take-profit.
    shadow.closeEntry('NVDA', 1040, '2026-06-01', 'take-profit hit');

    const out = await captureJSON(() => alpha([]));

    expect(out.real.totalPL).toBe((850 - 800) * 10);
    expect(out.shadow.totalPL).toBe((1040 - 800) * 10);
    // Negative drag: discipline would have earned more.
    expect(out.executionDrag.dollars).toBe(500 - 2400);
  });

  it('attributes the cost to a named behavioral pattern', async () => {
    const { alpha, portfolio, shadow } = await load();
    await captureJSON(() => portfolio(['init']));
    shadow.createEntry(shadowPlan('NVDA', 800, 10));
    await captureJSON(() => portfolio(['add', 'NVDA', '10', '800']));
    await captureStdout(() =>
      portfolio(['remove', 'NVDA', '--price', '850', '--reason', 'emotional']),
    );
    shadow.closeEntry('NVDA', 1040, '2026-06-01', 'take-profit');

    const out = await captureJSON(() => alpha([]));

    // 'emotional' maps to a pattern name /reflect can write to patterns/.
    const pattern = out.behavioralCosts.find((c: any) => c.pattern === 'early-profit-taking');
    expect(pattern).toBeDefined();
    expect(pattern.occurrences).toBe(1);
    expect(pattern.totalCost).toBeLessThan(0);
  });

  it('credits the user when they beat the plan', async () => {
    const { alpha, portfolio, shadow } = await load();
    await captureJSON(() => portfolio(['init']));

    shadow.createEntry(shadowPlan('NVDA', 800, 10));

    // Real exit above the plan's exit.
    await captureJSON(() => portfolio(['add', 'NVDA', '10', '800']));
    await captureStdout(() => portfolio(['remove', 'NVDA', '--price', '1200']));

    shadow.closeEntry('NVDA', 1000, '2026-06-01', 'take-profit');

    const out = await captureJSON(() => alpha([]));

    expect(out.executionDrag.dollars).toBeGreaterThan(0);
    // Positive outcomes are not attributed to a failure pattern.
    expect(out.behavioralCosts).toHaveLength(0);
  });

  it('reports zero drag when execution matches the plan', async () => {
    const { alpha, portfolio, shadow } = await load();
    await captureJSON(() => portfolio(['init']));
    shadow.createEntry(shadowPlan('NVDA', 800, 10));
    await captureJSON(() => portfolio(['add', 'NVDA', '10', '800']));
    await captureStdout(() => portfolio(['remove', 'NVDA', '--price', '1000']));
    shadow.closeEntry('NVDA', 1000, '2026-06-01', 'take-profit');

    const out = await captureJSON(() => alpha([]));

    expect(out.executionDrag.dollars).toBe(0);
    expect(out.executionFidelity.followed).toBe(1);
    expect(out.executionFidelity.total).toBe(1);
  });
});

describe('missing shadow', () => {
  it('still reports the trade when no plan was recorded', async () => {
    const { alpha, portfolio } = await load();
    await captureJSON(() => portfolio(['init']));
    await captureJSON(() => portfolio(['add', 'NVDA', '10', '800']));
    await captureJSON(() => portfolio(['remove', 'NVDA', '--price', '900']));

    const out = await captureJSON(() => alpha([]));

    // Trading without an /act plan is itself the finding — the position is
    // included with zero shadow P&L rather than dropped from the report.
    expect(out.positions).toHaveLength(1);
    expect(out.positions[0].shadowPL).toBe(0);
    expect(out.positions[0].estimated).toBe(true);
  });
});

describe('multiple cycles', () => {
  it('aggregates across positions', async () => {
    const { alpha, portfolio, shadow } = await load();
    await captureJSON(() => portfolio(['init']));

    shadow.createEntry(shadowPlan('NVDA', 800, 10));
    await captureJSON(() => portfolio(['add', 'NVDA', '10', '800']));
    await captureStdout(() => portfolio(['remove', 'NVDA', '--price', '850']));
    shadow.closeEntry('NVDA', 1000, '2026-06-01', 'plan');

    shadow.createEntry(shadowPlan('AAPL', 180, 20));
    await captureJSON(() => portfolio(['add', 'AAPL', '20', '180']));
    await captureStdout(() => portfolio(['remove', 'AAPL', '--price', '200']));
    shadow.closeEntry('AAPL', 210, '2026-06-01', 'plan');

    const out = await captureJSON(() => alpha([]));

    expect(out.positions).toHaveLength(2);
    expect(out.real.totalPL).toBe(500 + 400);
    expect(out.shadow.totalPL).toBe(2000 + 600);
  });

  it('honours --last to bound the window', async () => {
    const { alpha, portfolio } = await load();
    await captureJSON(() => portfolio(['init']));

    for (const t of ['AAA', 'BBB', 'CCC']) {
      await captureJSON(() => portfolio(['add', t, '10', '100']));
      await captureStdout(() => portfolio(['remove', t, '--price', '110']));
    }

    const out = await captureJSON(() => alpha(['--last', '2']));

    expect(out.positions).toHaveLength(2);
  });
});
