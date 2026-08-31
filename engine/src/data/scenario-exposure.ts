import type { PositionScenarioExposure } from './portfolio';

/**
 * A small, reviewable default map for ordinary listed equities. It is never a
 * catch-all: a holding we do not understand remains unmodeled until the
 * investor supplies an explicit factor.
 */
const INFERRED_FACTORS: Record<string, string> = {
  AAPL: 'XLK',
  ADBE: 'XLK',
  AMD: 'XLK',
  AVGO: 'XLK',
  CSCO: 'XLK',
  CRM: 'XLK',
  INTC: 'XLK',
  MSFT: 'XLK',
  NVDA: 'XLK',
  ORCL: 'XLK',
  QCOM: 'XLK',
  SOXX: 'XLK',
  TSM: 'XLK',
  TXN: 'XLK',
  DIS: 'XLC',
  GOOG: 'XLC',
  GOOGL: 'XLC',
  META: 'XLC',
  NFLX: 'XLC',
  TMUS: 'XLC',
  AMZN: 'XLY',
  HD: 'XLY',
  MCD: 'XLY',
  NKE: 'XLY',
  SBUX: 'XLY',
  TSLA: 'XLY',
  BAC: 'XLF',
  BRK: 'XLF',
  GS: 'XLF',
  JPM: 'XLF',
  MS: 'XLF',
  WFC: 'XLF',
  ABBV: 'XLV',
  JNJ: 'XLV',
  LLY: 'XLV',
  MRK: 'XLV',
  PFE: 'XLV',
  UNH: 'XLV',
  COP: 'XLE',
  CVX: 'XLE',
  EOG: 'XLE',
  SLB: 'XLE',
  XOM: 'XLE',
  AEP: 'XLU',
  DUK: 'XLU',
  NEE: 'XLU',
  SO: 'XLU',
  APD: 'XLB',
  FCX: 'XLB',
  LIN: 'XLB',
  BA: 'XLI',
  CAT: 'XLI',
  GE: 'XLI',
  HON: 'XLI',
  UNP: 'XLI',
  AMT: 'XLRE',
  CCI: 'XLRE',
  PLD: 'XLRE',
  COST: 'XLP',
  KO: 'XLP',
  PEP: 'XLP',
  PG: 'XLP',
  WMT: 'XLP',
  SPY: 'SPY',
};

export interface ResolvedScenarioExposure {
  factor: string | null;
  source: 'user' | 'inferred' | 'unmodeled';
  /** Human-readable reason suitable for a user-facing model-coverage warning. */
  reason: string | null;
}

export function resolveScenarioExposure(
  ticker: string,
  configured?: PositionScenarioExposure,
): ResolvedScenarioExposure {
  if (configured) {
    return { factor: configured.factor, source: 'user', reason: null };
  }
  const inferred = INFERRED_FACTORS[ticker.toUpperCase()];
  if (inferred) {
    return { factor: inferred, source: 'inferred', reason: null };
  }
  return {
    factor: null,
    source: 'unmodeled',
    reason: `No scenario factor is configured for ${ticker}.`,
  };
}
