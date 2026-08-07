/**
 * shadow command.
 *
 * The shadow portfolio is the counterfactual /alpha measures against, so the
 * cases that matter are the ones protecting its integrity: one open entry per
 * ticker, and no entry accepted that would make the comparison meaningless.
 */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { captureJSON, useTestHome } from '../helpers';

const home = useTestHome('shadow-cmd');

async function loadShadowCmd() {
  const mod = await import('../../src/commands/shadow');
  return mod.shadow;
}

/** A valid plan; override individual fields per case. */
function plan(overrides: Record<string, unknown> = {}) {
  return {
    ticker: 'NVDA',
    action: 'buy',
    entryDate: '2026-08-07',
    totalShares: 50,
    stagedPlan: [
      {
        tranche: 1,
        shares: 25,
        trigger: 'immediate',
        status: 'filled',
        fillPrice: 845,
        fillDate: '2026-08-07',
      },
      {
        tranche: 2,
        shares: 25,
        trigger: 'pullback to 800',
        triggerPrice: 800,
        status: 'pending',
        fillPrice: null,
        fillDate: null,
      },
    ],
    stopLoss: { price: 720, reason: 'Below the January consolidation low' },
    takeProfit: { price: 1100, reason: 'Prior resistance plus 30%' },
    timeHorizon: '2026-12-31',
    linkedThesis: null,
    sourceJudge: 'journal/NVDA-2026-08-06.md',
    sourceAct: 'journal/act-NVDA-2026-08-07.md',
    ...overrides,
  };
}

/**
 * Feed a document to a command's stdin.
 *
 * The command reads process.stdin, so the test swaps in an async iterable
 * yielding the payload — the same shape `for await (const chunk of ...)` sees
 * from a real pipe.
 */
async function withStdin<T>(payload: string, fn: () => Promise<T>): Promise<T> {
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

/** Run fn and return the FinstackError it throws, for asserting on its fields. */
async function captureError(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected the call to throw');
}

beforeEach(() => {
  home.reset();
});

afterAll(() => {
  home.cleanup();
});

describe('shadow add', () => {
  it('accepts a valid staged plan', async () => {
    const shadow = await loadShadowCmd();
    const out = await withStdin(JSON.stringify(plan()), () => captureJSON(() => shadow(['add'])));

    expect(out.ticker).toBe('NVDA');
    expect(out.status).toBe('open');
    // filledShares is derived, not supplied — one tranche is filled.
    expect(out.filledShares).toBe(25);
  });

  it('assigns an id and creation timestamp', async () => {
    const shadow = await loadShadowCmd();
    const out = await withStdin(JSON.stringify(plan()), () => captureJSON(() => shadow(['add'])));

    expect(out.id).toMatch(/^s/);
    expect(out.createdAt).toBeDefined();
  });

  it('normalizes the ticker', async () => {
    const shadow = await loadShadowCmd();
    const out = await withStdin(JSON.stringify(plan({ ticker: 'nvda' })), () =>
      captureJSON(() => shadow(['add'])),
    );
    expect(out.ticker).toBe('NVDA');
  });

  // Two open entries for one ticker would make the alpha comparison ambiguous:
  // which plan was the user deviating from?
  it('refuses a second open entry for the same ticker', async () => {
    const shadow = await loadShadowCmd();
    await withStdin(JSON.stringify(plan()), () => captureJSON(() => shadow(['add'])));

    await expect(
      withStdin(JSON.stringify(plan()), () => captureJSON(() => shadow(['add']))),
    ).rejects.toThrow(/already exists/i);
  });

  it('allows a new entry once the previous one is closed', async () => {
    const shadow = await loadShadowCmd();
    await withStdin(JSON.stringify(plan()), () => captureJSON(() => shadow(['add'])));
    await captureJSON(() =>
      shadow(['close', 'NVDA', '--price', '1100', '--reason', 'take-profit']),
    );

    const out = await withStdin(JSON.stringify(plan()), () => captureJSON(() => shadow(['add'])));
    expect(out.status).toBe('open');
  });

  it('rejects a plan whose tranches do not sum to the position', async () => {
    const shadow = await loadShadowCmd();
    const err = await captureError(() =>
      withStdin(JSON.stringify(plan({ totalShares: 100 })), () =>
        captureJSON(() => shadow(['add'])),
      ),
    );
    expect(err.reason).toMatch(/sum to/i);
  });

  it('rejects a long plan with the stop above the target', async () => {
    const shadow = await loadShadowCmd();
    const err = await captureError(() =>
      withStdin(
        JSON.stringify(
          plan({
            stopLoss: { price: 1200, reason: 'x' },
            takeProfit: { price: 1100, reason: 'y' },
          }),
        ),
        () => captureJSON(() => shadow(['add'])),
      ),
    );
    expect(err.reason).toMatch(/must be below take-profit/i);
  });

  it('rejects malformed JSON with a parse hint', async () => {
    const shadow = await loadShadowCmd();
    await expect(
      withStdin('{"ticker":"NVDA",}', () => captureJSON(() => shadow(['add']))),
    ).rejects.toThrow(/parse/i);
  });

  it('reports an empty stdin as a usage error', async () => {
    const shadow = await loadShadowCmd();
    await expect(withStdin('', () => captureJSON(() => shadow(['add'])))).rejects.toThrow(/stdin/i);
  });

  it('prints the schema on request without reading stdin', async () => {
    const shadow = await loadShadowCmd();
    const { captureStdout } = await import('../helpers');
    const out = await captureStdout(() => shadow(['add', '--schema']));

    expect(out).toContain('stagedPlan');
    expect(out).toContain('takeProfit');
  });

  it('writes nothing when validation fails', async () => {
    const shadow = await loadShadowCmd();
    await expect(
      withStdin(JSON.stringify(plan({ totalShares: 999 })), () =>
        captureJSON(() => shadow(['add'])),
      ),
    ).rejects.toThrow();

    const out = await captureJSON(() => shadow(['show']));
    expect(out.count).toBe(0);
  });
});

describe('shadow close', () => {
  it('records the exit and flips the status', async () => {
    const shadow = await loadShadowCmd();
    await withStdin(JSON.stringify(plan()), () => captureJSON(() => shadow(['add'])));

    const out = await captureJSON(() =>
      shadow(['close', 'NVDA', '--price', '1100', '--reason', 'take-profit hit']),
    );

    expect(out.status).toBe('closed');
    expect(out.exitPrice).toBe(1100);
    expect(out.exitReason).toBe('take-profit hit');
  });

  it('defaults the exit date to today', async () => {
    const shadow = await loadShadowCmd();
    await withStdin(JSON.stringify(plan()), () => captureJSON(() => shadow(['add'])));

    const out = await captureJSON(() =>
      shadow(['close', 'NVDA', '--price', '1100', '--reason', 'done']),
    );

    expect(out.exitDate).toBe(new Date().toISOString().split('T')[0]);
  });

  it('accepts an explicit exit date', async () => {
    const shadow = await loadShadowCmd();
    await withStdin(JSON.stringify(plan()), () => captureJSON(() => shadow(['add'])));

    const out = await captureJSON(() =>
      shadow(['close', 'NVDA', '--price', '1100', '--reason', 'done', '--date', '2026-09-01']),
    );

    expect(out.exitDate).toBe('2026-09-01');
  });

  // /reflect reads the reason when judging whether an exit was planned or
  // panicked, so an unexplained close defeats the mechanism.
  it('requires a reason', async () => {
    const shadow = await loadShadowCmd();
    await withStdin(JSON.stringify(plan()), () => captureJSON(() => shadow(['add'])));

    await expect(captureJSON(() => shadow(['close', 'NVDA', '--price', '1100']))).rejects.toThrow(
      /reason/i,
    );
  });

  it('requires a price', async () => {
    const shadow = await loadShadowCmd();
    await withStdin(JSON.stringify(plan()), () => captureJSON(() => shadow(['add'])));

    await expect(
      captureJSON(() => shadow(['close', 'NVDA', '--reason', 'done'])),
    ).rejects.toThrow();
  });

  it('rejects a non-numeric price', async () => {
    const shadow = await loadShadowCmd();
    await withStdin(JSON.stringify(plan()), () => captureJSON(() => shadow(['add'])));

    await expect(
      captureJSON(() => shadow(['close', 'NVDA', '--price', 'abc', '--reason', 'done'])),
    ).rejects.toThrow();
  });

  it('reports when there is nothing open to close', async () => {
    const shadow = await loadShadowCmd();
    await expect(
      captureJSON(() => shadow(['close', 'TSLA', '--price', '100', '--reason', 'done'])),
    ).rejects.toThrow(/no open shadow entry/i);
  });
});

describe('shadow show', () => {
  it('reports an empty portfolio', async () => {
    const shadow = await loadShadowCmd();
    const out = await captureJSON(() => shadow(['show']));

    expect(out.count).toBe(0);
    expect(out.open).toBe(0);
  });

  it('counts open and closed separately', async () => {
    const shadow = await loadShadowCmd();
    await withStdin(JSON.stringify(plan()), () => captureJSON(() => shadow(['add'])));
    await captureJSON(() => shadow(['close', 'NVDA', '--price', '1100', '--reason', 'done']));
    await withStdin(JSON.stringify(plan({ ticker: 'AMD' })), () =>
      captureJSON(() => shadow(['add'])),
    );

    const out = await captureJSON(() => shadow(['show']));
    expect(out.count).toBe(2);
    expect(out.open).toBe(1);
    expect(out.closed).toBe(1);
  });

  it('filters to open entries on request', async () => {
    const shadow = await loadShadowCmd();
    await withStdin(JSON.stringify(plan()), () => captureJSON(() => shadow(['add'])));
    await captureJSON(() => shadow(['close', 'NVDA', '--price', '1100', '--reason', 'done']));

    const out = await captureJSON(() => shadow(['show', '--open']));
    expect(out.entries).toHaveLength(0);
  });

  it('defaults to show with no subcommand', async () => {
    const shadow = await loadShadowCmd();
    const out = await captureJSON(() => shadow([]));
    expect(out.count).toBe(0);
  });
});

describe('shadow unknown subcommand', () => {
  it('lists the valid ones', async () => {
    const shadow = await loadShadowCmd();
    const err = await captureError(() => captureJSON(() => shadow(['bogus'])));
    expect(err.suggestion).toMatch(/add\|close\|show/);
  });
});
