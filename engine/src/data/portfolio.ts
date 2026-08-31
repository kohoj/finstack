// engine/src/data/portfolio.ts
//
// The portfolio is the system's factual boundary.  It cannot be a convenient
// bag of `shares * avgCost`: cost is historical accounting, while every risk
// decision needs a dated market mark in one explicit base currency.

import { FinstackError } from '../errors';
import { atomicWriteJSON, readJSONSafe, withFileLock } from '../fs';
import { paths } from '../paths';
import { validateTicker } from '../validation';

export const PORTFOLIO_SCHEMA_VERSION = 3;

export interface PositionMark {
  /** Last observed instrument price, denominated in the position currency. */
  price: number;
  /** ISO 8601 instant for the source observation. */
  asOf: string;
  /** Human-readable provenance, e.g. `ZABANK` or `Yahoo Finance`. */
  source: string;
  /** Units of portfolio base currency for one unit of position currency. */
  fxRateToBase?: number;
}

/**
 * An investor-supplied scenario proxy. It is intentionally separate from a
 * market mark: price provenance and factor-model provenance are different
 * claims and must remain independently inspectable.
 */
export interface PositionScenarioExposure {
  /** A scenario factor key, such as XLK, XLI, or SPY. */
  factor: string;
  /** `user` is persisted so inferred defaults never masquerade as a choice. */
  source: 'user';
  notes?: string;
}

export interface Position {
  ticker: string;
  shares: number;
  /** Average acquisition cost in `currency`; never silently converted. */
  avgCost: number;
  /** ISO 4217 currency. Legacy positions are normalized to the base currency. */
  currency: string;
  addedAt: string;
  notes?: string;
  mark?: PositionMark;
  scenarioExposure?: PositionScenarioExposure;
}

export interface Transaction {
  ticker: string;
  action: 'buy' | 'sell';
  shares: number;
  price: number;
  currency: string;
  date: string;
  reason: string | null;
}

export interface Portfolio {
  schemaVersion: number;
  /** All aggregate values are expressed in this ISO 4217 currency. */
  baseCurrency: string;
  positions: Position[];
  transactions: Transaction[];
  updatedAt: string;
}

export interface ValuedPosition {
  ticker: string;
  shares: number;
  currency: string;
  avgCost: number;
  price: number;
  priceSource: 'mark' | 'cost';
  markedAt: string | null;
  markSource: string | null;
  nativeValue: number;
  fxRateToBase: number | null;
  valueBase: number | null;
  scenarioExposure?: PositionScenarioExposure;
}

export interface PortfolioValuation {
  baseCurrency: string;
  totalValueBase: number;
  /** Every position has a base-currency conversion. */
  complete: boolean;
  /** Every position is backed by an explicit mark, not its acquisition cost. */
  fullyMarked: boolean;
  /** Positions valued from cost because a live mark has not been recorded. */
  costFallbackTickers: string[];
  unvaluedTickers: string[];
  positions: ValuedPosition[];
}

export interface PortfolioImport {
  baseCurrency: string;
  positions: Array<{
    ticker: string;
    shares: number;
    avgCost: number;
    currency: string;
    mark?: PositionMark;
    notes?: string;
    scenarioExposure?: PositionScenarioExposure;
  }>;
  /** The import is a point-in-time opening balance, not a fabricated trade log. */
  asOf?: string;
}

const CURRENCY = /^[A-Z]{3}$/;

export function normalizeCurrency(raw: string | undefined, field = 'currency'): string {
  const currency = raw?.trim().toUpperCase();
  if (!currency || !CURRENCY.test(currency)) {
    throw new FinstackError(
      `Invalid ${field}: ${raw ?? 'missing'}`,
      undefined,
      'Currency must be a three-letter ISO 4217 code',
      `Pass an ISO currency code, e.g. --currency USD or --currency HKD`,
    );
  }
  return currency;
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validInstant(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function normalizeMark(
  raw: unknown,
  currency: string,
  baseCurrency: string,
): PositionMark | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const mark = raw as Partial<PositionMark>;
  if (
    !finitePositive(mark.price) ||
    !validInstant(mark.asOf) ||
    typeof mark.source !== 'string' ||
    !mark.source.trim()
  ) {
    return undefined;
  }
  const fxRateToBase =
    currency === baseCurrency
      ? 1
      : finitePositive(mark.fxRateToBase)
        ? mark.fxRateToBase
        : undefined;
  return {
    price: mark.price,
    asOf: new Date(mark.asOf).toISOString(),
    source: mark.source.trim(),
    ...(fxRateToBase === undefined ? {} : { fxRateToBase }),
  };
}

function normalizeScenarioExposure(raw: unknown): PositionScenarioExposure | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const exposure = raw as Partial<PositionScenarioExposure>;
  const factor = typeof exposure.factor === 'string' ? exposure.factor.trim().toUpperCase() : '';
  if (!/^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(factor)) return undefined;
  return {
    factor,
    source: 'user',
    ...(typeof exposure.notes === 'string' && exposure.notes.trim()
      ? { notes: exposure.notes.trim() }
      : {}),
  };
}

export function emptyPortfolio(baseCurrency = 'USD'): Portfolio {
  return {
    schemaVersion: PORTFOLIO_SCHEMA_VERSION,
    baseCurrency: normalizeCurrency(baseCurrency, 'baseCurrency'),
    positions: [],
    transactions: [],
    updatedAt: '',
  };
}

/**
 * Read old cost-only files safely. The old schema had no currency field, so
 * its only defensible interpretation is that every value was in the old
 * implicit USD base. We preserve that behavior rather than invent FX history.
 */
export function normalizePortfolio(raw: unknown): Portfolio {
  const candidate = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as any) : {};
  const baseCurrency = normalizeCurrency(
    typeof candidate.baseCurrency === 'string' ? candidate.baseCurrency : 'USD',
    'baseCurrency',
  );
  const positions: Position[] = Array.isArray(candidate.positions)
    ? candidate.positions.flatMap((rawPosition: any) => {
        if (!rawPosition || typeof rawPosition !== 'object') return [];
        if (
          typeof rawPosition.ticker !== 'string' ||
          !finitePositive(rawPosition.shares) ||
          !finitePositive(rawPosition.avgCost)
        ) {
          return [];
        }
        const currency = normalizeCurrency(
          typeof rawPosition.currency === 'string' ? rawPosition.currency : baseCurrency,
          `positions.${rawPosition.ticker}.currency`,
        );
        const addedAt = validInstant(rawPosition.addedAt)
          ? new Date(rawPosition.addedAt).toISOString()
          : new Date(0).toISOString();
        const mark = normalizeMark(rawPosition.mark, currency, baseCurrency);
        const scenarioExposure = normalizeScenarioExposure(rawPosition.scenarioExposure);
        return [
          {
            ticker: rawPosition.ticker.toUpperCase(),
            shares: rawPosition.shares,
            avgCost: rawPosition.avgCost,
            currency,
            addedAt,
            ...(typeof rawPosition.notes === 'string' ? { notes: rawPosition.notes } : {}),
            ...(mark ? { mark } : {}),
            ...(scenarioExposure ? { scenarioExposure } : {}),
          } satisfies Position,
        ];
      })
    : [];
  const transactions: Transaction[] = Array.isArray(candidate.transactions)
    ? candidate.transactions.flatMap((rawTransaction: any) => {
        if (
          !rawTransaction ||
          typeof rawTransaction !== 'object' ||
          typeof rawTransaction.ticker !== 'string' ||
          !['buy', 'sell'].includes(rawTransaction.action) ||
          !finitePositive(rawTransaction.shares) ||
          !finitePositive(rawTransaction.price) ||
          !validInstant(rawTransaction.date)
        ) {
          return [];
        }
        return [
          {
            ticker: rawTransaction.ticker.toUpperCase(),
            action: rawTransaction.action,
            shares: rawTransaction.shares,
            price: rawTransaction.price,
            currency: normalizeCurrency(
              rawTransaction.currency || baseCurrency,
              'transaction.currency',
            ),
            date: new Date(rawTransaction.date).toISOString(),
            reason: typeof rawTransaction.reason === 'string' ? rawTransaction.reason : null,
          } satisfies Transaction,
        ];
      })
    : [];
  return {
    schemaVersion: PORTFOLIO_SCHEMA_VERSION,
    baseCurrency,
    positions,
    transactions,
    updatedAt: validInstant(candidate.updatedAt) ? new Date(candidate.updatedAt).toISOString() : '',
  };
}

export function loadPortfolio(file = paths.PORTFOLIO_FILE): Portfolio {
  return normalizePortfolio(readJSONSafe<unknown>(file, emptyPortfolio()));
}

export function savePortfolio(portfolio: Portfolio, file = paths.PORTFOLIO_FILE): Portfolio {
  const normalized = normalizePortfolio(portfolio);
  normalized.updatedAt = new Date().toISOString();
  atomicWriteJSON(file, normalized);
  return normalized;
}

export function mutatePortfolio<T>(
  fn: (portfolio: Portfolio) => T,
  file = paths.PORTFOLIO_FILE,
): T {
  return withFileLock(file, () => {
    const portfolio = loadPortfolio(file);
    const result = fn(portfolio);
    savePortfolio(portfolio, file);
    return result;
  });
}

export function valuePortfolio(portfolio: Portfolio): PortfolioValuation {
  const positions = portfolio.positions.map(position => {
    const price = position.mark?.price ?? position.avgCost;
    const priceSource = position.mark ? 'mark' : 'cost';
    const fxRateToBase =
      position.currency === portfolio.baseCurrency ? 1 : (position.mark?.fxRateToBase ?? null);
    const nativeValue = position.shares * price;
    const valueBase = fxRateToBase === null ? null : nativeValue * fxRateToBase;
    return {
      ticker: position.ticker,
      shares: position.shares,
      currency: position.currency,
      avgCost: position.avgCost,
      price,
      priceSource,
      markedAt: position.mark?.asOf ?? null,
      markSource: position.mark?.source ?? null,
      nativeValue: +nativeValue.toFixed(2),
      fxRateToBase,
      valueBase: valueBase === null ? null : +valueBase.toFixed(2),
      ...(position.scenarioExposure ? { scenarioExposure: position.scenarioExposure } : {}),
    } satisfies ValuedPosition;
  });
  const unvaluedTickers = positions
    .filter(position => position.valueBase === null)
    .map(position => position.ticker);
  const costFallbackTickers = positions
    .filter(position => position.priceSource === 'cost')
    .map(position => position.ticker);
  return {
    baseCurrency: portfolio.baseCurrency,
    totalValueBase: +positions
      .reduce((sum, position) => sum + (position.valueBase ?? 0), 0)
      .toFixed(2),
    complete: unvaluedTickers.length === 0,
    fullyMarked: costFallbackTickers.length === 0 && unvaluedTickers.length === 0,
    costFallbackTickers,
    unvaluedTickers,
    positions,
  };
}

export function assertValidImport(raw: unknown): PortfolioImport {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new FinstackError(
      'Invalid portfolio import',
      undefined,
      'Expected a JSON object',
      'Pass an import document on stdin.',
    );
  }
  const input = raw as Partial<PortfolioImport>;
  const baseCurrency = normalizeCurrency(input.baseCurrency, 'baseCurrency');
  if (input.asOf !== undefined && !validInstant(input.asOf)) {
    throw new FinstackError(
      'Invalid portfolio import',
      undefined,
      'asOf must be an ISO 8601 timestamp',
      'Fix the import document and retry.',
    );
  }
  if (!Array.isArray(input.positions) || input.positions.length === 0) {
    throw new FinstackError(
      'Invalid portfolio import',
      undefined,
      'positions must be a non-empty array',
      'Include one position per holding.',
    );
  }
  const tickers = new Set<string>();
  const positions = input.positions.map((rawPosition: any, index) => {
    if (!rawPosition || typeof rawPosition !== 'object') {
      throw new FinstackError(
        'Invalid portfolio import',
        undefined,
        `positions[${index}] must be an object`,
        'Fix the import document and retry.',
      );
    }
    const ticker = validateTicker(
      typeof rawPosition.ticker === 'string' ? rawPosition.ticker.trim() : undefined,
      `positions[${index}].ticker`,
    );
    if (tickers.has(ticker)) {
      throw new FinstackError(
        'Invalid portfolio import',
        undefined,
        `Duplicate ticker: ${ticker}`,
        'Merge lots before importing.',
      );
    }
    tickers.add(ticker);
    if (!finitePositive(rawPosition.shares) || !finitePositive(rawPosition.avgCost)) {
      throw new FinstackError(
        'Invalid portfolio import',
        undefined,
        `positions[${index}] needs positive shares and avgCost`,
        'Fix the import document and retry.',
      );
    }
    const currency = normalizeCurrency(rawPosition.currency, `positions[${index}].currency`);
    const mark =
      rawPosition.mark === undefined
        ? undefined
        : normalizeMark(rawPosition.mark, currency, baseCurrency);
    if (rawPosition.mark !== undefined && !mark) {
      throw new FinstackError(
        'Invalid portfolio import',
        undefined,
        `positions[${index}].mark is invalid`,
        'A mark needs positive price, ISO timestamp, source, and FX rate for foreign currency.',
      );
    }
    if (currency !== baseCurrency && mark && !mark.fxRateToBase) {
      throw new FinstackError(
        'Invalid portfolio import',
        undefined,
        `positions[${index}].mark.fxRateToBase is required`,
        `Provide ${baseCurrency} per ${currency}.`,
      );
    }
    const scenarioExposure =
      rawPosition.scenarioExposure === undefined
        ? undefined
        : normalizeScenarioExposure(rawPosition.scenarioExposure);
    if (rawPosition.scenarioExposure !== undefined && !scenarioExposure) {
      throw new FinstackError(
        'Invalid portfolio import',
        undefined,
        `positions[${index}].scenarioExposure is invalid`,
        'A scenario exposure needs a valid factor such as XLK, XLI, or SPY.',
      );
    }
    return {
      ticker,
      shares: rawPosition.shares,
      avgCost: rawPosition.avgCost,
      currency,
      ...(mark ? { mark } : {}),
      ...(typeof rawPosition.notes === 'string' ? { notes: rawPosition.notes } : {}),
      ...(scenarioExposure ? { scenarioExposure } : {}),
    };
  });
  return {
    baseCurrency,
    positions,
    ...(input.asOf ? { asOf: new Date(input.asOf).toISOString() } : {}),
  };
}
