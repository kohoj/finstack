import { FinstackError } from '../errors';
import { readJSONSafe } from '../fs';
import { paths } from '../paths';

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

interface ScenarioConfig {
  name: string;
  description: string;
  factors: Record<string, number>; // ticker/ETF → expected return
}

export const SCENARIOS: Record<string, ScenarioConfig> = {
  'rates+100bp': {
    name: 'rates+100bp',
    description: 'Interest rates +100bp',
    factors: { SPY: -0.08, TLT: -0.15, GLD: 0.05, XLF: 0.03, XLU: -0.05, XLK: -0.1 },
  },
  'rates-100bp': {
    name: 'rates-100bp',
    description: 'Interest rates -100bp',
    factors: { SPY: 0.05, TLT: 0.12, GLD: -0.03, XLF: -0.02, XLU: 0.04, XLK: 0.08 },
  },
  'spy-20pct': {
    name: 'spy-20pct',
    description: 'Market crash -20%',
    factors: { SPY: -0.2 },
  },
  'spy+20pct': {
    name: 'spy+20pct',
    description: 'Market rally +20%',
    factors: { SPY: 0.2 },
  },
  'oil+30pct': {
    name: 'oil+30pct',
    description: 'Oil price +30%',
    factors: { USO: 0.3, XLE: 0.15, SPY: -0.03 },
  },
  recession: {
    name: 'recession',
    description: 'Recession',
    factors: { SPY: -0.3, TLT: 0.2, GLD: 0.15, XLU: 0.05, XLC: -0.25, XLK: -0.2 },
  },
};

// Approximate sector ETF mapping for common stocks
const SECTOR_MAP: Record<string, string> = {
  // Technology
  AAPL: 'XLK',
  MSFT: 'XLK',
  NVDA: 'XLK',
  AMD: 'XLK',
  INTC: 'XLK',
  AVGO: 'XLK',
  ADBE: 'XLK',
  CRM: 'XLK',
  ORCL: 'XLK',
  CSCO: 'XLK',
  QCOM: 'XLK',
  TXN: 'XLK',
  // Communication
  META: 'XLC',
  GOOG: 'XLC',
  GOOGL: 'XLC',
  NFLX: 'XLC',
  DIS: 'XLC',
  TMUS: 'XLC',
  // Consumer Discretionary
  AMZN: 'XLY',
  TSLA: 'XLY',
  HD: 'XLY',
  NKE: 'XLY',
  MCD: 'XLY',
  SBUX: 'XLY',
  // Financials
  JPM: 'XLF',
  BAC: 'XLF',
  GS: 'XLF',
  MS: 'XLF',
  WFC: 'XLF',
  BRK: 'XLF',
  // Healthcare
  UNH: 'XLV',
  JNJ: 'XLV',
  PFE: 'XLV',
  ABBV: 'XLV',
  LLY: 'XLV',
  MRK: 'XLV',
  // Energy
  XOM: 'XLE',
  CVX: 'XLE',
  COP: 'XLE',
  SLB: 'XLE',
  EOG: 'XLE',
  // Utilities
  NEE: 'XLU',
  DUK: 'XLU',
  SO: 'XLU',
  AEP: 'XLU',
  // Materials
  LIN: 'XLB',
  APD: 'XLB',
  FCX: 'XLB',
  // Industrials
  CAT: 'XLI',
  BA: 'XLI',
  GE: 'XLI',
  HON: 'XLI',
  UNP: 'XLI',
  // Real Estate
  AMT: 'XLRE',
  PLD: 'XLRE',
  CCI: 'XLRE',
  // Consumer Staples
  PG: 'XLP',
  KO: 'XLP',
  PEP: 'XLP',
  COST: 'XLP',
  WMT: 'XLP',
};

export interface PositionImpact {
  ticker: string;
  shares: number;
  currentValue: number;
  sectorETF: string;
  estimatedReturn: number;
  impactDollars: number;
  impactPct: number;
}

export function estimateImpact(
  positions: { ticker: string; shares: number; avgCost: number }[],
  scenario: ScenarioConfig,
  defaultBeta: number = 1.0,
): {
  positions: PositionImpact[];
  totalImpact: number;
  totalImpactPct: number;
  portfolioValue: number;
} {
  const portfolioValue = positions.reduce((s, p) => s + p.shares * p.avgCost, 0);
  if (portfolioValue === 0)
    return { positions: [], totalImpact: 0, totalImpactPct: 0, portfolioValue: 0 };

  let totalImpact = 0;
  const impacts: PositionImpact[] = [];

  for (const pos of positions) {
    const value = pos.shares * pos.avgCost;
    const sectorETF = SECTOR_MAP[pos.ticker] || 'SPY';

    // Determine the expected return for this position
    let estimatedReturn: number;
    if (pos.ticker in scenario.factors) {
      // Direct factor for this ticker
      estimatedReturn = scenario.factors[pos.ticker];
    } else if (sectorETF in scenario.factors) {
      // Sector ETF factor
      estimatedReturn = scenario.factors[sectorETF];
    } else if ('SPY' in scenario.factors) {
      // Fall back to broad market beta
      estimatedReturn = scenario.factors.SPY * defaultBeta;
    } else {
      estimatedReturn = 0;
    }

    const impactDollars = +(value * estimatedReturn).toFixed(2);
    const impactPct = +(estimatedReturn * 100).toFixed(2);

    totalImpact += impactDollars;

    impacts.push({
      ticker: pos.ticker,
      shares: pos.shares,
      currentValue: +value.toFixed(2),
      sectorETF,
      estimatedReturn: +estimatedReturn.toFixed(4),
      impactDollars,
      impactPct,
    });
  }

  impacts.sort((a, b) => a.impactDollars - b.impactDollars); // worst first

  return {
    positions: impacts,
    totalImpact: +totalImpact.toFixed(2),
    totalImpactPct: +((totalImpact / portfolioValue) * 100).toFixed(2),
    portfolioValue: +portfolioValue.toFixed(2),
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
    config = {
      name: 'custom',
      description: 'Custom scenario',
      factors: factors as Record<string, number>,
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

  const portfolio = readJSONSafe<any>(paths.PORTFOLIO_FILE, { positions: [] });
  if (!portfolio.positions?.length) {
    console.log(JSON.stringify({ message: 'Empty portfolio. Add positions first.' }, null, 2));
    return;
  }

  const result = estimateImpact(portfolio.positions, config);

  console.log(
    JSON.stringify(
      {
        scenario: config.name,
        description: config.description,
        factors: config.factors,
        ...result,
        disclaimer:
          'Based on sector-level estimates. Not a precise risk model. Directional reference only.',
      },
      null,
      2,
    ),
  );
}
