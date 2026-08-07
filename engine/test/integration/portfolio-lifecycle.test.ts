/**
 * Portfolio lifecycle — init, add, average down, sell, remove.
 *
 * Unit tests cover each subcommand in isolation. This exercises the sequence,
 * because the invariants that matter are cross-operation: cost basis has to
 * survive averaging, and the transaction log has to stay a complete audit
 * trail — /reflect and /track read it to reconstruct what the user did.
 */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { captureJSON, useTestHome } from '../helpers';

const home = useTestHome('portfolio-lifecycle');

async function loadPortfolio() {
  const mod = await import('../../src/commands/portfolio');
  return mod.portfolio;
}

beforeEach(() => {
  home.reset();
});

afterAll(() => {
  home.cleanup();
});

describe('position accumulation', () => {
  it('weights the cost basis by share count when averaging in', async () => {
    const portfolio = await loadPortfolio();
    await captureJSON(() => portfolio(['init']));

    await captureJSON(() => portfolio(['add', 'NVDA', '10', '800']));
    const out = await captureJSON(() => portfolio(['add', 'NVDA', '30', '900']));

    const pos = out.positions.find((p: any) => p.ticker === 'NVDA');
    expect(pos.shares).toBe(40);
    // (10*800 + 30*900) / 40 = 875 — a simple mean would give 850.
    expect(pos.avgCost).toBeCloseTo(875, 6);
  });

  it('keeps one position row per ticker', async () => {
    const portfolio = await loadPortfolio();
    await captureJSON(() => portfolio(['init']));

    await captureJSON(() => portfolio(['add', 'NVDA', '10', '800']));
    await captureJSON(() => portfolio(['add', 'NVDA', '10', '900']));
    const out = await captureJSON(() => portfolio(['add', 'AAPL', '5', '200']));

    expect(out.positions).toHaveLength(2);
  });

  it('records every add as a transaction', async () => {
    const portfolio = await loadPortfolio();
    await captureJSON(() => portfolio(['init']));

    await captureJSON(() => portfolio(['add', 'NVDA', '10', '800']));
    await captureJSON(() => portfolio(['add', 'NVDA', '10', '900']));
    const out = await captureJSON(() => portfolio(['add', 'AAPL', '5', '200']));

    expect(out.transactions).toHaveLength(3);
    expect(out.transactions.every((t: any) => t.action === 'buy')).toBe(true);
  });
});

describe('exit', () => {
  it('removes the position but keeps the transaction history', async () => {
    const portfolio = await loadPortfolio();
    await captureJSON(() => portfolio(['init']));
    await captureJSON(() => portfolio(['add', 'NVDA', '10', '800']));

    const out = await captureJSON(() => portfolio(['remove', 'NVDA', '--price', '900']));

    expect(out.positions).toHaveLength(0);
    // The buy must survive: /alpha pairs it with the sell to compute P&L.
    expect(out.transactions).toHaveLength(2);
    expect(out.transactions[0].action).toBe('buy');
    expect(out.transactions[1].action).toBe('sell');
  });

  it('records the sale at the given price', async () => {
    const portfolio = await loadPortfolio();
    await captureJSON(() => portfolio(['init']));
    await captureJSON(() => portfolio(['add', 'NVDA', '10', '800']));

    const out = await captureJSON(() => portfolio(['remove', 'NVDA', '--price', '950']));

    const sell = out.transactions.find((t: any) => t.action === 'sell');
    expect(sell.price).toBe(950);
    expect(sell.shares).toBe(10);
  });

  it('falls back to cost basis when no price is given', async () => {
    const portfolio = await loadPortfolio();
    await captureJSON(() => portfolio(['init']));
    await captureJSON(() => portfolio(['add', 'NVDA', '10', '800']));

    const out = await captureJSON(() => portfolio(['remove', 'NVDA']));

    const sell = out.transactions.find((t: any) => t.action === 'sell');
    expect(sell.price).toBe(800);
  });

  it('stores the stated reason for later behavioral analysis', async () => {
    const portfolio = await loadPortfolio();
    await captureJSON(() => portfolio(['init']));
    await captureJSON(() => portfolio(['add', 'NVDA', '10', '800']));

    const out = await captureJSON(() =>
      portfolio(['remove', 'NVDA', '--price', '900', '--reason', 'emotional']),
    );

    const sell = out.transactions.find((t: any) => t.action === 'sell');
    // categorizeDeviation() maps this to 'early-profit-taking' in /alpha.
    expect(sell.reason).toBe('emotional');
  });

  it('is a no-op on the position list for an unheld ticker', async () => {
    const portfolio = await loadPortfolio();
    await captureJSON(() => portfolio(['init']));
    await captureJSON(() => portfolio(['add', 'NVDA', '10', '800']));

    const out = await captureJSON(() => portfolio(['remove', 'TSLA']));

    expect(out.positions).toHaveLength(1);
    // No sell recorded — nothing was actually sold.
    expect(out.transactions.filter((t: any) => t.action === 'sell')).toHaveLength(0);
  });
});

describe('init', () => {
  it('does not clobber an existing portfolio', async () => {
    const portfolio = await loadPortfolio();
    await captureJSON(() => portfolio(['init']));
    await captureJSON(() => portfolio(['add', 'NVDA', '10', '800']));

    const out = await captureJSON(() => portfolio(['init']));

    expect(out.message).toContain('already exists');
    expect(out.positions).toHaveLength(1);
  });
});

describe('full round trip', () => {
  it('preserves the audit trail across a buy / average / sell cycle', async () => {
    const portfolio = await loadPortfolio();
    await captureJSON(() => portfolio(['init']));

    await captureJSON(() => portfolio(['add', 'NVDA', '10', '800']));
    await captureJSON(() => portfolio(['add', 'NVDA', '10', '900']));
    await captureJSON(() => portfolio(['add', 'AAPL', '20', '180']));
    await captureJSON(() => portfolio(['remove', 'NVDA', '--price', '1000']));

    const out = await captureJSON(() => portfolio(['show']));

    expect(out.positions).toHaveLength(1);
    expect(out.positions[0].ticker).toBe('AAPL');

    expect(out.transactions).toHaveLength(4);
    const sell = out.transactions.find((t: any) => t.action === 'sell');
    // Both NVDA lots exited together at the averaged basis of 850.
    expect(sell.shares).toBe(20);
    expect(sell.price).toBe(1000);
  });
});
