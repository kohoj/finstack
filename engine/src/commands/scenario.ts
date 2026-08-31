import { loadPortfolio, type PositionScenarioExposure, valuePortfolio } from '../data/portfolio';
import { resolveScenarioExposure } from '../data/scenario-exposure';
import { FinstackError } from '../errors';
import { validateTicker } from '../validation';

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

interface ScenarioConfig {
  name: string;
  description: string;
  /** Explicit factor returns. No missing factor silently becomes SPY. */
  factors: Record<string, number>;
  /**
   * A declared broad-market assumption used only by scenarios intentionally
   * defined as market shocks. It applies to known, mapped equities and is
   * labelled as a market assumption in the result.
   */
  marketFactor?: number;
}

export const SCENARIOS: Record<string, ScenarioConfig> = {
  'rates+100bp': {
    name: 'rates+100bp',
    description: 'Interest rates +100bp',
    factors: {
      SPY: -0.08,
      TLT: -0.15,
      GLD: 0.05,
      XLF: 0.03,
      XLU: -0.05,
      XLK: -0.1,
      XLI: -0.07,
      XLY: -0.1,
      XLV: -0.04,
      XLE: -0.02,
      XLB: -0.08,
      XLP: -0.02,
      XLRE: -0.1,
      XLC: -0.09,
    },
  },
  'rates-100bp': {
    name: 'rates-100bp',
    description: 'Interest rates -100bp',
    factors: {
      SPY: 0.05,
      TLT: 0.12,
      GLD: -0.03,
      XLF: -0.02,
      XLU: 0.04,
      XLK: 0.08,
      XLI: 0.04,
      XLY: 0.07,
      XLV: 0.03,
      XLE: 0.01,
      XLB: 0.04,
      XLP: 0.02,
      XLRE: 0.08,
      XLC: 0.06,
    },
  },
  'spy-20pct': {
    name: 'spy-20pct',
    description: 'Market crash -20%',
    factors: { SPY: -0.2 },
    marketFactor: -0.2,
  },
  'spy+20pct': {
    name: 'spy+20pct',
    description: 'Market rally +20%',
    factors: { SPY: 0.2 },
    marketFactor: 0.2,
  },
  'oil+30pct': {
    name: 'oil+30pct',
    description: 'Oil price +30%',
    factors: { USO: 0.3, XLE: 0.15, SPY: -0.03 },
  },
  recession: {
    name: 'recession',
    description: 'Recession',
    factors: {
      SPY: -0.3,
      TLT: 0.2,
      GLD: 0.15,
      XLU: 0.05,
      XLC: -0.25,
      XLK: -0.2,
      XLI: -0.25,
      XLY: -0.35,
      XLV: -0.1,
      XLE: -0.2,
      XLB: -0.3,
      XLP: -0.08,
      XLRE: -0.25,
      XLF: -0.3,
    },
  },
};

export interface PositionImpact {
  ticker: string;
  shares: number;
  currentValue: number;
  /** The factor actually used, never a hidden broad-market fallback. */
  scenarioFactor: string | null;
  factorSource: 'user' | 'inferred' | 'market' | 'unmodeled';
  modeled: boolean;
  unmodeledReason: string | null;
  estimatedReturn: number | null;
  impactDollars: number | null;
  impactPct: number | null;
}

type ScenarioPosition = {
  ticker: string;
  shares: number;
  /** Historical cost is retained for pure unit tests and legacy callers. */
  avgCost?: number;
  /** Current marked value in the portfolio base currency. */
  valueBase?: number | null;
  scenarioExposure?: PositionScenarioExposure;
};

export function estimateImpact(
  positions: ScenarioPosition[],
  scenario: ScenarioConfig,
  defaultBeta: number = 1.0,
): {
  positions: PositionImpact[];
  totalImpact: number;
  /** Percentage of the modeled portion only; null means no position was modeled. */
  totalImpactPct: number | null;
  portfolioValue: number;
  modeledValue: number;
  unmodeledValue: number;
  coveragePct: number;
  unmodeledTickers: string[];
} {
  const positionValue = (position: ScenarioPosition): number => {
    if (position.valueBase !== undefined && position.valueBase !== null) return position.valueBase;
    return position.shares * (position.avgCost ?? 0);
  };
  const portfolioValue = positions.reduce((sum, position) => sum + positionValue(position), 0);
  if (portfolioValue === 0)
    return {
      positions: [],
      totalImpact: 0,
      totalImpactPct: null,
      portfolioValue: 0,
      modeledValue: 0,
      unmodeledValue: 0,
      coveragePct: 0,
      unmodeledTickers: [],
    };

  let totalImpact = 0;
  let modeledValue = 0;
  const impacts: PositionImpact[] = [];

  for (const pos of positions) {
    const value = positionValue(pos);
    const resolved = resolveScenarioExposure(pos.ticker, pos.scenarioExposure);

    let scenarioFactor = resolved.factor;
    let factorSource: PositionImpact['factorSource'] = resolved.source;
    let estimatedReturn: number | null = null;
    let unmodeledReason = resolved.reason;
    if (pos.ticker in scenario.factors) {
      estimatedReturn = scenario.factors[pos.ticker];
      scenarioFactor = pos.ticker;
      factorSource = resolved.source === 'unmodeled' ? 'inferred' : resolved.source;
      unmodeledReason = null;
    } else if (resolved.factor && resolved.factor in scenario.factors) {
      estimatedReturn = scenario.factors[resolved.factor];
      unmodeledReason = null;
    } else if (resolved.factor && scenario.marketFactor !== undefined) {
      estimatedReturn = scenario.marketFactor * defaultBeta;
      scenarioFactor = 'MARKET';
      factorSource = 'market';
      unmodeledReason = null;
    } else if (resolved.factor) {
      unmodeledReason = `Scenario has no factor for ${resolved.factor} (${pos.ticker}).`;
    }

    const modeledReturn = estimatedReturn;
    const modeled = modeledReturn !== null;
    const impactDollars = modeledReturn === null ? null : +(value * modeledReturn).toFixed(2);
    const impactPct = modeledReturn === null ? null : +(modeledReturn * 100).toFixed(2);
    if (modeled) {
      totalImpact += impactDollars as number;
      modeledValue += value;
    }

    impacts.push({
      ticker: pos.ticker,
      shares: pos.shares,
      currentValue: +value.toFixed(2),
      scenarioFactor,
      factorSource,
      modeled,
      unmodeledReason,
      estimatedReturn: modeledReturn === null ? null : +modeledReturn.toFixed(4),
      impactDollars,
      impactPct,
    });
  }

  impacts.sort((a, b) => {
    if (a.impactDollars === null) return 1;
    if (b.impactDollars === null) return -1;
    return a.impactDollars - b.impactDollars;
  });
  const unmodeledValue = portfolioValue - modeledValue;

  return {
    positions: impacts,
    totalImpact: +totalImpact.toFixed(2),
    totalImpactPct: modeledValue === 0 ? null : +((totalImpact / modeledValue) * 100).toFixed(2),
    portfolioValue: +portfolioValue.toFixed(2),
    modeledValue: +modeledValue.toFixed(2),
    unmodeledValue: +unmodeledValue.toFixed(2),
    coveragePct: +((modeledValue / portfolioValue) * 100).toFixed(2),
    unmodeledTickers: impacts.filter(impact => !impact.modeled).map(impact => impact.ticker),
  };
}

export async function scenario(args: string[]) {
  const scenarioName = args[0];

  if (!scenarioName) {
    console.log(
      JSON.stringify(
        {
          available: Object.entries(SCENARIOS).map(([key, s]) => ({
            name: key,
            description: s.description,
          })),
          usage: 'finstack scenario <name> | finstack scenario custom --factors \'{"SPY":-0.2}\'',
        },
        null,
        2,
      ),
    );
    return;
  }

  let config: ScenarioConfig;

  if (scenarioName === 'custom') {
    const factorsStr = parseFlag(args, '--factors');
    if (!factorsStr) {
      throw new FinstackError(
        'Usage: finstack scenario custom --factors \'{"SPY":-0.2,"XLK":-0.15}\'',
        undefined,
        'Custom scenarios require a --factors JSON object',
        'Factors map a ticker or sector ETF to a fractional return, e.g. -0.2 for -20%',
      );
    }
    let factors: unknown;
    try {
      factors = JSON.parse(factorsStr);
    } catch {
      throw new FinstackError(
        'Invalid JSON for --factors',
        undefined,
        'Could not parse the --factors argument',
        'Quote the whole object, e.g. --factors \'{"SPY":-0.2}\'',
      );
    }
    if (typeof factors !== 'object' || factors === null || Array.isArray(factors)) {
      throw new FinstackError(
        '--factors must be a JSON object',
        undefined,
        `Received ${Array.isArray(factors) ? 'an array' : typeof factors}`,
        'Example: --factors \'{"SPY":-0.2,"XLK":-0.15}\'',
      );
    }
    const normalizedFactors: Record<string, number> = {};
    for (const [rawFactor, rawReturn] of Object.entries(factors as Record<string, unknown>)) {
      const factor = validateTicker(rawFactor, 'scenario factor');
      if (typeof rawReturn !== 'number' || !Number.isFinite(rawReturn)) {
        throw new FinstackError(
          'Invalid scenario factor return',
          undefined,
          `${factor} must map to a finite fractional return`,
          'Use a number such as -0.2 for -20%.',
        );
      }
      normalizedFactors[factor] = rawReturn;
    }
    config = {
      name: 'custom',
      description: 'Custom scenario',
      factors: normalizedFactors,
    };
  } else {
    config = SCENARIOS[scenarioName];
    if (!config) {
      throw new FinstackError(
        `Unknown scenario: ${scenarioName}`,
        undefined,
        `Available scenarios: ${Object.keys(SCENARIOS).join(', ')}`,
        'Or build your own: finstack scenario custom --factors \'{"SPY":-0.2}\'',
      );
    }
  }

  const portfolio = loadPortfolio();
  if (!portfolio.positions.length) {
    console.log(JSON.stringify({ message: 'Empty portfolio. Add positions first.' }, null, 2));
    return;
  }

  const valuation = valuePortfolio(portfolio);
  if (!valuation.complete) {
    throw new FinstackError(
      'Portfolio valuation is incomplete',
      undefined,
      `Missing base-currency conversion for: ${valuation.unvaluedTickers.join(', ')}`,
      'Mark foreign-currency positions with --fx-rate before running scenarios.',
    );
  }
  const result = estimateImpact(
    valuation.positions.map(position => ({
      ticker: position.ticker,
      shares: position.shares,
      valueBase: position.valueBase,
      scenarioExposure: position.scenarioExposure,
    })),
    config,
  );

  console.log(
    JSON.stringify(
      {
        scenario: config.name,
        description: config.description,
        factors: config.factors,
        baseCurrency: portfolio.baseCurrency,
        valuation: {
          fullyMarked: valuation.fullyMarked,
          costFallbackTickers: valuation.costFallbackTickers,
        },
        ...result,
        disclaimer:
          'Based on sector-level estimates. Not a precise risk model. Directional reference only.',
      },
      null,
      2,
    ),
  );
}
