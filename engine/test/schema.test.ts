/**
 * Schema validation tests.
 *
 * These validators are the only thing standing between LLM-composed JSON and
 * two state files that everything downstream reads. So the tests care about
 * two properties equally:
 *
 *   - Bad input is rejected, with a field path precise enough to self-correct
 *   - Good input is accepted, including the shapes real skills produce
 *
 * A validator that rejects valid theses is worse than none, because the skill
 * will work around it.
 */
import { describe, expect, it } from 'bun:test';
import { SchemaError, validateShadowInput, validateThesisInput } from '../src/schema';

// A minimal thesis that must always validate.
function validThesis(overrides: Record<string, unknown> = {}) {
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

function validShadow(overrides: Record<string, unknown> = {}) {
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
    takeProfit: { price: 1100, reason: 'Prior resistance plus 30% target' },
    timeHorizon: '2026-12-31',
    linkedThesis: 't123abc',
    sourceJudge: 'journal/NVDA-2026-08-06.md',
    sourceAct: 'journal/act-NVDA-2026-08-07.md',
    ...overrides,
  };
}

/** Field paths reported by a validator, for asserting on error quality. */
function issuePaths(fn: () => unknown): string[] {
  try {
    fn();
    return [];
  } catch (e) {
    if (e instanceof SchemaError) return e.issues.map(i => i.path);
    throw e;
  }
}

describe('validateThesisInput — accepts', () => {
  it('a minimal earnings thesis', () => {
    expect(() => validateThesisInput(validThesis())).not.toThrow();
  });

  it('an event condition', () => {
    const t = validThesis({
      conditions: [
        {
          description: 'No hyperscaler cuts capex',
          type: 'event',
          falsificationTest: 'Any top-4 hyperscaler guides capex down >10%',
          watchTickers: ['MSFT', 'GOOGL'],
        },
      ],
    });
    expect(() => validateThesisInput(t)).not.toThrow();
  });

  it('an event condition without watchTickers', () => {
    const t = validThesis({
      conditions: [
        {
          description: 'Regulatory approval lands',
          type: 'event',
          falsificationTest: 'FDA issues a complete response letter',
        },
      ],
    });
    expect(() => validateThesisInput(t)).not.toThrow();
  });

  it('both condition types together', () => {
    const t = validThesis({
      conditions: [
        ...validThesis().conditions,
        {
          description: 'No hyperscaler cuts capex',
          type: 'event',
          falsificationTest: 'Any top-4 guides down >10%',
          watchTickers: ['MSFT'],
        },
      ],
    });
    expect(() => validateThesisInput(t)).not.toThrow();
  });

  it('and normalizes the ticker', () => {
    const out = validateThesisInput(validThesis({ ticker: 'nvda' }));
    expect(out.ticker).toBe('NVDA');
  });

  it('symbols with a dot or hyphen', () => {
    expect(() => validateThesisInput(validThesis({ ticker: 'BRK.B' }))).not.toThrow();
    expect(() => validateThesisInput(validThesis({ ticker: 'BF-B' }))).not.toThrow();
  });

  it('every comparison operator', () => {
    for (const operator of ['>', '<', '>=', '<=', '==']) {
      const t = validThesis({
        conditions: [{ ...validThesis().conditions[0], operator }],
      });
      expect(() => validateThesisInput(t)).not.toThrow();
    }
  });

  it('a negative threshold', () => {
    // Margins can contract; a threshold of -0.05 is meaningful.
    const t = validThesis({
      conditions: [{ ...validThesis().conditions[0], threshold: -0.05 }],
    });
    expect(() => validateThesisInput(t)).not.toThrow();
  });
});

describe('validateThesisInput — rejects', () => {
  it('a non-object', () => {
    expect(() => validateThesisInput('a thesis')).toThrow(SchemaError);
    expect(() => validateThesisInput(null)).toThrow(SchemaError);
    expect(() => validateThesisInput([])).toThrow(SchemaError);
  });

  it('a missing ticker', () => {
    const { ticker, ...rest } = validThesis();
    expect(issuePaths(() => validateThesisInput(rest))).toContain('ticker');
  });

  it('an invalid ticker', () => {
    expect(issuePaths(() => validateThesisInput(validThesis({ ticker: '../etc' })))).toContain(
      'ticker',
    );
  });

  it('an empty thesis body', () => {
    expect(issuePaths(() => validateThesisInput(validThesis({ thesis: '   ' })))).toContain(
      'thesis',
    );
  });

  // A thesis with no falsifiable condition is not a thesis — it is an opinion,
  // and /sense would have nothing to monitor.
  it('an empty conditions array', () => {
    expect(issuePaths(() => validateThesisInput(validThesis({ conditions: [] })))).toContain(
      'conditions',
    );
  });

  it('a missing conditions array', () => {
    const { conditions, ...rest } = validThesis();
    expect(issuePaths(() => validateThesisInput(rest))).toContain('conditions');
  });

  it('an unknown condition type', () => {
    const t = validThesis({
      conditions: [{ description: 'x', type: 'vibes' }],
    });
    expect(issuePaths(() => validateThesisInput(t))).toContain('conditions[0].type');
  });

  // The failure this validator exists for: without a threshold, the store
  // defaults to 0, producing "revenue above zero" — a condition that can never
  // falsify, silently making the thesis unkillable.
  it('an earnings condition missing its threshold', () => {
    const { threshold, ...cond } = validThesis().conditions[0];
    const t = validThesis({ conditions: [cond] });
    expect(issuePaths(() => validateThesisInput(t))).toContain('conditions[0].threshold');
  });

  it('an earnings condition missing its metric', () => {
    const { metric, ...cond } = validThesis().conditions[0];
    const t = validThesis({ conditions: [cond] });
    expect(issuePaths(() => validateThesisInput(t))).toContain('conditions[0].metric');
  });

  it('an earnings condition with a bad operator', () => {
    const t = validThesis({
      conditions: [{ ...validThesis().conditions[0], operator: '=>' }],
    });
    expect(issuePaths(() => validateThesisInput(t))).toContain('conditions[0].operator');
  });

  it('a resolveBy date that does not exist', () => {
    const t = validThesis({
      conditions: [{ ...validThesis().conditions[0], resolveBy: '2026-02-31' }],
    });
    expect(issuePaths(() => validateThesisInput(t))).toContain('conditions[0].resolveBy');
  });

  it('an event condition missing its falsification test', () => {
    const t = validThesis({
      conditions: [{ description: 'Something happens', type: 'event' }],
    });
    expect(issuePaths(() => validateThesisInput(t))).toContain('conditions[0].falsificationTest');
  });

  it('an invalid ticker inside watchTickers', () => {
    const t = validThesis({
      conditions: [
        {
          description: 'x',
          type: 'event',
          falsificationTest: 'y',
          watchTickers: ['MSFT', '../etc'],
        },
      ],
    });
    expect(issuePaths(() => validateThesisInput(t))).toContain('conditions[0].watchTickers[1]');
  });

  // A dropped field is invisible on write. Catching the typo at the boundary
  // is the only place it can be reported.
  it('a misspelled field, and suggests the right one', () => {
    const t = validThesis({
      conditions: [
        {
          description: 'x',
          type: 'event',
          falsificationtest: 'lowercase t',
        },
      ],
    });
    try {
      validateThesisInput(t);
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as SchemaError;
      const typo = err.issues.find(i => i.path.includes('falsificationtest'));
      expect(typo?.message).toContain('falsificationTest');
    }
  });

  it('an unknown top-level field', () => {
    expect(issuePaths(() => validateThesisInput(validThesis({ confidence: 7 })))).toContain(
      'confidence',
    );
  });

  it('and reports every problem at once', () => {
    // One round trip per field would make self-correction slow and lossy.
    const paths = issuePaths(() =>
      validateThesisInput({
        ticker: '!!!',
        thesis: '',
        verdict: '',
        conditions: [{ description: '', type: 'earnings' }],
      }),
    );
    expect(paths.length).toBeGreaterThan(4);
    expect(paths).toContain('ticker');
    expect(paths).toContain('thesis');
  });
});

describe('validateShadowInput — accepts', () => {
  it('a staged buy plan', () => {
    expect(() => validateShadowInput(validShadow())).not.toThrow();
  });

  it('a single-tranche plan', () => {
    const s = validShadow({
      totalShares: 25,
      stagedPlan: [
        {
          tranche: 1,
          shares: 25,
          trigger: 'immediate',
          status: 'filled',
          fillPrice: 845,
          fillDate: '2026-08-07',
        },
      ],
    });
    expect(() => validateShadowInput(s)).not.toThrow();
  });

  it('a plan with no thesis linked', () => {
    expect(() => validateShadowInput(validShadow({ linkedThesis: null }))).not.toThrow();
  });

  it('a short position with an inverted stop', () => {
    const s = validShadow({
      action: 'sell',
      stopLoss: { price: 1100, reason: 'Above resistance' },
      takeProfit: { price: 720, reason: 'Support target' },
    });
    expect(() => validateShadowInput(s)).not.toThrow();
  });

  it('a tranche with a fallback date', () => {
    const s = validShadow({
      stagedPlan: [
        validShadow().stagedPlan[0],
        { ...validShadow().stagedPlan[1], fallbackDate: '2026-09-15' },
      ],
    });
    expect(() => validateShadowInput(s)).not.toThrow();
  });
});

describe('validateShadowInput — rejects', () => {
  it('a non-object', () => {
    expect(() => validateShadowInput('plan')).toThrow(SchemaError);
  });

  it('an unknown action', () => {
    expect(issuePaths(() => validateShadowInput(validShadow({ action: 'hold' })))).toContain(
      'action',
    );
  });

  it('zero or negative shares', () => {
    expect(issuePaths(() => validateShadowInput(validShadow({ totalShares: 0 })))).toContain(
      'totalShares',
    );
  });

  it('an empty staged plan', () => {
    expect(issuePaths(() => validateShadowInput(validShadow({ stagedPlan: [] })))).toContain(
      'stagedPlan',
    );
  });

  // The invariant that makes the entry usable as a counterfactual: if the
  // tranches do not add up, the shadow position size is fiction and every
  // later alpha number derived from it is wrong.
  it('tranches that do not sum to totalShares', () => {
    const s = validShadow({ totalShares: 100 });
    const issues = issuePaths(() => validateShadowInput(s));
    expect(issues).toContain('stagedPlan');
  });

  it('a stop above the take-profit on a long', () => {
    const s = validShadow({
      stopLoss: { price: 1200, reason: 'x' },
      takeProfit: { price: 1100, reason: 'y' },
    });
    expect(issuePaths(() => validateShadowInput(s))).toContain('stopLoss.price');
  });

  it('a stop below the take-profit on a short', () => {
    const s = validShadow({
      action: 'sell',
      stopLoss: { price: 700, reason: 'x' },
      takeProfit: { price: 1100, reason: 'y' },
    });
    expect(issuePaths(() => validateShadowInput(s))).toContain('stopLoss.price');
  });

  it('a stop with no reason', () => {
    // /reflect reads the reason to judge whether an exit was planned.
    const s = validShadow({ stopLoss: { price: 720, reason: '' } });
    expect(issuePaths(() => validateShadowInput(s))).toContain('stopLoss.reason');
  });

  // A filled tranche with no price cannot contribute to cost basis, so the
  // shadow gets priced from the real trade — the exact comparison it exists
  // to avoid.
  it('a filled tranche with no fill price', () => {
    const s = validShadow({
      totalShares: 25,
      stagedPlan: [
        {
          tranche: 1,
          shares: 25,
          trigger: 'immediate',
          status: 'filled',
          fillPrice: null,
          fillDate: null,
        },
      ],
    });
    expect(issuePaths(() => validateShadowInput(s))).toContain('stagedPlan[0].fillPrice');
  });

  it('a pending tranche that claims a fill price', () => {
    const s = validShadow({
      totalShares: 25,
      stagedPlan: [
        {
          tranche: 1,
          shares: 25,
          trigger: 'wait',
          status: 'pending',
          fillPrice: 800,
          fillDate: null,
        },
      ],
    });
    expect(issuePaths(() => validateShadowInput(s))).toContain('stagedPlan[0].fillPrice');
  });

  it('an invalid entry date', () => {
    expect(
      issuePaths(() => validateShadowInput(validShadow({ entryDate: '07/08/2026' }))),
    ).toContain('entryDate');
  });

  it('an unknown field', () => {
    expect(issuePaths(() => validateShadowInput(validShadow({ conviction: 'high' })))).toContain(
      'conviction',
    );
  });
});

describe('SchemaError', () => {
  it('names the field path in its reason', () => {
    try {
      validateThesisInput(validThesis({ ticker: '!!!' }));
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as SchemaError;
      expect(err.reason).toContain('ticker');
      expect(err.suggestion).toContain('--schema');
    }
  });

  it('serializes without leaking internals', () => {
    const { formatErrorJSON } = require('../src/errors');
    try {
      validateThesisInput({});
      throw new Error('should have thrown');
    } catch (e) {
      const payload = formatErrorJSON(e as Error);
      expect(payload).not.toContain('.ts:');
      expect(payload).not.toMatch(/\s+at\s+/);
      expect(JSON.parse(payload).error).toContain('Invalid thesis');
    }
  });
});
