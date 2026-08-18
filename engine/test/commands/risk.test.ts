import { describe, expect, it } from 'bun:test';
import {
  calculateConcentration,
  calculatePositionSize,
  evaluateRiskGate,
} from '../../src/commands/risk';

describe('risk', () => {
  it('detects single-position concentration', () => {
    const result = calculateConcentration([
      { ticker: 'NVDA', weight: 30 },
      { ticker: 'AAPL', weight: 20 },
      { ticker: 'GOOGL', weight: 15 },
      { ticker: 'MSFT', weight: 10 },
      { ticker: 'AMZN', weight: 25 },
    ]);
    expect(result.top1.ticker).toBe('NVDA');
    expect(result.top1.weight).toBe(30);
    expect(result.warnings.length).toBe(2); // single > 25% + top3 > 60%
  });

  it('passes clean portfolio', () => {
    const result = calculateConcentration([
      { ticker: 'NVDA', weight: 20 },
      { ticker: 'AAPL', weight: 20 },
      { ticker: 'GOOGL', weight: 20 },
      { ticker: 'MSFT', weight: 20 },
      { ticker: 'AMZN', weight: 20 },
    ]);
    expect(result.warnings.length).toBe(0);
  });

  it('sizes position by risk budget', () => {
    // $200k portfolio, 2% risk = $4,000 max loss
    // Entry $100, stop $90 = $10 risk per share
    // Max shares = 400
    const result = calculatePositionSize(200000, 2, 100, 90);
    expect(result.shares).toBe(400);
    expect(result.riskDollars).toBe(4000);
    expect(result.positionDollars).toBe(40000);
  });

  it('sizes zero when stop equals entry', () => {
    const result = calculatePositionSize(200000, 2, 100, 100);
    expect(result.shares).toBe(0);
  });

  it('risk gate blocks over-concentrated position', () => {
    const existing = [
      { ticker: 'AAPL', weight: 20 },
      { ticker: 'GOOGL', weight: 20 },
    ];
    const gate = evaluateRiskGate('NVDA', 30, existing, 2, 0);
    expect(gate.pass).toBe(false);
    expect(gate.blocks.length).toBeGreaterThan(0);
    expect(gate.blocks[0]).toContain('NVDA');
  });

  it('risk gate passes balanced position', () => {
    const existing = [
      { ticker: 'AAPL', weight: 15 },
      { ticker: 'GOOGL', weight: 15 },
    ];
    const gate = evaluateRiskGate('NVDA', 10, existing, 2, 0);
    expect(gate.pass).toBe(true);
    expect(gate.blocks.length).toBe(0);
  });

  it('risk gate triggers drawdown circuit breaker', () => {
    const gate = evaluateRiskGate('NVDA', 10, [], 2, 18);
    expect(gate.pass).toBe(false);
    expect(gate.blocks[0]).toContain('circuit breaker');
  });

  it('risk gate warns near drawdown threshold', () => {
    const gate = evaluateRiskGate('NVDA', 10, [], 2, 12);
    expect(gate.pass).toBe(true);
    expect(gate.warnings.length).toBe(1);
    expect(gate.warnings[0]).toContain('approaching');
  });
});

// ── Post-trade weight when adding to an existing position ───────────────────
//
// Regression: `risk size` measured the post-trade weight against the new
// tranche alone, ignoring shares already held. Topping up a position already
// at 80% of the portfolio reported 13.8%, so the 25% single-position block
// never fired — the gate silently approved the concentration it exists to stop.

import { afterAll, beforeEach } from 'bun:test';
import { captureJSON, useTestHome } from '../helpers';

const gateHome = useTestHome('risk-gate');

async function load() {
  const risk = (await import('../../src/commands/risk')).risk;
  const portfolio = (await import('../../src/commands/portfolio')).portfolio;
  return { risk, portfolio };
}

/** One 80% holding plus four 5% holdings. */
async function seedConcentrated() {
  const { portfolio } = await load();
  await captureJSON(() => portfolio(['init']));
  await captureJSON(() => portfolio(['add', 'BIG', '100', '800']));
  for (const t of ['S1', 'S2', 'S3', 'S4']) {
    await captureJSON(() => portfolio(['add', t, '100', '50']));
  }
}

describe('risk size — post-trade weight', () => {
  beforeEach(() => gateHome.reset());
  afterAll(() => gateHome.cleanup());

  it('blocks adding to a position already over the single-position limit', async () => {
    await seedConcentrated();
    const { risk } = await load();

    const out = await captureJSON(() => risk(['size', 'BIG', '800', '700']));

    // 80% held plus the new tranche, not the tranche alone.
    expect(out.sizing.weightPct).toBeGreaterThan(80);
    expect(out.sizing.addingToExisting).toBe(true);
    expect(out.riskGate.pass).toBe(false);
    expect(out.riskGate.blocks.join(' ')).toMatch(/limit: 25%/);
  });

  it('allows a new position of the same size', async () => {
    await seedConcentrated();
    const { risk } = await load();

    // Same dollar amount, but nothing held yet, so the weight is the tranche's.
    const out = await captureJSON(() => risk(['size', 'DDD', '800', '700']));

    expect(out.sizing.weightPct).toBeLessThan(25);
    expect(out.sizing.addingToExisting).toBeUndefined();
    expect(out.riskGate.pass).toBe(true);
  });

  it('allows topping up a small position', async () => {
    await seedConcentrated();
    const { risk } = await load();

    const out = await captureJSON(() => risk(['size', 'S1', '50', '45']));

    expect(out.sizing.addingToExisting).toBe(true);
    expect(out.riskGate.pass).toBe(true);
  });

  // The ticker being sized is passed to the gate as its post-trade weight, so
  // including its pre-trade weight in the "existing holdings" list counted it
  // twice — a single-holding portfolio reported top-3 concentration of 115%.
  it('does not count the sized ticker twice in the top-3 sum', async () => {
    const { risk, portfolio } = await load();
    await captureJSON(() => portfolio(['init']));
    await captureJSON(() => portfolio(['add', 'ONLY', '50', '195']));

    const out = await captureJSON(() => risk(['size', 'ONLY', '219', '197']));

    // A single holding cannot exceed 100% of the portfolio.
    const top3 = out.riskGate.warnings.find((w: string) => w.includes('Top 3'));
    if (top3) {
      const pct = Number(top3.match(/([\d.]+)%/)?.[1]);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });
});

// ── --shares makes the stop-loss risk block reachable ───────────────────────
//
// Regression: `risk size` back-solved shares from the risk budget, so the stop
// risk was always ≈ the budget and the positionRisk block (>5%) was
// tautological — it could never fire. With an explicit --shares count the stop
// risk reflects the user's actual size, so the block engages.

const sharesHome = useTestHome('risk-shares');

describe('risk size — user-specified shares', () => {
  beforeEach(() => sharesHome.reset());
  afterAll(() => sharesHome.cleanup());

  async function seed() {
    const { portfolio } = await load();
    await captureJSON(() => portfolio(['init']));
    await captureJSON(() => portfolio(['add', 'AAPL', '100', '200'])); // pv = 20,000
  }

  it('budget mode leaves stop risk at ≈ the budget and does not block on risk', async () => {
    await seed();
    const { risk } = await load();
    const out = await captureJSON(() => risk(['size', 'TSLA', '100', '90']));
    expect(out.sizing.sizingMode).toBe('risk-budget');
    expect(out.riskGate.blocks.join(' ')).not.toMatch(/Position risk at stop-loss/);
  });

  it('user-shares mode fires the positionRisk block when the stop risk exceeds 5%', async () => {
    await seed();
    const { risk } = await load();
    // 500 shares, entry 100 / stop 90 → 5,000 stop risk on a 25,000 post-trade
    // portfolio = 20% > 5%. The block that budget-sizing could never trigger.
    const out = await captureJSON(() => risk(['size', 'TSLA', '100', '90', '--shares', '500']));
    expect(out.sizing.sizingMode).toBe('user-shares');
    expect(out.sizing.shares).toBe(500);
    expect(out.riskGate.pass).toBe(false);
    expect(out.riskGate.blocks.join(' ')).toMatch(/Position risk at stop-loss/);
  });

  it('user-shares mode passes risk check for a modest size', async () => {
    await seed();
    const { risk } = await load();
    // 50 shares × 10 stop = 500 risk on ~25k = 2% < 5%, and weight stays under 25%.
    const out = await captureJSON(() => risk(['size', 'TSLA', '100', '90', '--shares', '50']));
    expect(out.sizing.sizingMode).toBe('user-shares');
    expect(out.riskGate.blocks.join(' ')).not.toMatch(/Position risk at stop-loss/);
  });
});
