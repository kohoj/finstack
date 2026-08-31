import {
  assertValidImport,
  emptyPortfolio,
  loadPortfolio,
  mutatePortfolio,
  normalizeCurrency,
  PORTFOLIO_SCHEMA_VERSION,
  type Portfolio,
  type PositionMark,
  type PositionScenarioExposure,
  valuePortfolio,
} from '../data/portfolio';
import { FinstackError } from '../errors';
import { readJSONSafe } from '../fs';
import { paths } from '../paths';
import { readJSONFromStdin } from '../stdin';
import { validatePositiveNumber, validateTicker } from '../validation';

const IMPORT_USAGE =
  'Pipe a portfolio snapshot to stdin: ' +
  "echo '<json>' | finstack portfolio import   (see: finstack portfolio import --schema)";

export const PORTFOLIO_IMPORT_SCHEMA = {
  baseCurrency: 'USD',
  asOf: '2026-08-28T11:36:00.000Z',
  positions: [
    {
      ticker: 'MSFT',
      shares: 18,
      avgCost: 449.8894,
      currency: 'USD',
      mark: {
        price: 505.06,
        asOf: '2026-08-28T11:36:00.000Z',
        source: 'Broker name or market-data source',
      },
      scenarioExposure: {
        factor: 'XLK',
        source: 'user',
        notes: 'Optional explicit risk-model proxy',
      },
      notes: 'Optional factual provenance or lot note',
    },
    {
      ticker: '07709.HK',
      shares: 200,
      avgCost: 42.06,
      currency: 'HKD',
      mark: {
        price: 36.44,
        asOf: '2026-08-28T11:36:00.000Z',
        source: 'Broker name or market-data source',
        fxRateToBase: 0.128,
      },
    },
  ],
};

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function parseInstant(
  raw: string | undefined,
  field: string,
  fallback = new Date().toISOString(),
): string {
  if (raw === undefined) return fallback;
  const time = Date.parse(raw);
  if (Number.isNaN(time)) {
    throw new FinstackError(
      `Invalid ${field}: ${raw}`,
      undefined,
      `${field} must be an ISO 8601 timestamp`,
      `Example: --${field} 2026-08-28T11:36:00Z`,
    );
  }
  return new Date(time).toISOString();
}

function present(portfolio: Portfolio) {
  return { ...portfolio, valuation: valuePortfolio(portfolio) };
}

function loadShadow(): any {
  return readJSONSafe(paths.SHADOW_FILE, { entries: [] });
}

export interface MarkPositionOptions {
  asOf?: string;
  source?: string;
  fxRateToBase?: number;
}

/** Record an explicitly sourced market mark; shared by the CLI and Desk. */
export function markPortfolioPosition(
  rawTicker: string,
  rawPrice: number,
  options: MarkPositionOptions = {},
) {
  const ticker = validateTicker(rawTicker);
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) {
    throw new FinstackError(
      `Invalid mark price: ${rawPrice}`,
      undefined,
      'mark price must be a positive finite number',
      'Enter the latest observed instrument price.',
    );
  }
  const asOf = parseInstant(options.asOf, 'as-of');
  const source = options.source?.trim() || 'manual';
  if (!source) {
    throw new FinstackError(
      'Invalid source',
      undefined,
      'A mark must name its source',
      'Pass a source name.',
    );
  }

  return mutatePortfolio(current => {
    const position = current.positions.find(item => item.ticker === ticker);
    if (!position) {
      throw new FinstackError(
        `Position not found: ${ticker}`,
        undefined,
        'Marks can only be attached to an existing holding',
        'Import or add the position first.',
      );
    }
    let fxRateToBase = 1;
    if (position.currency !== current.baseCurrency) {
      if (!Number.isFinite(options.fxRateToBase) || (options.fxRateToBase as number) <= 0) {
        throw new FinstackError(
          `Missing FX rate for ${ticker}`,
          undefined,
          `${current.baseCurrency} per ${position.currency} is required to value this holding.`,
          'Provide a positive --fx-rate.',
        );
      }
      fxRateToBase = options.fxRateToBase as number;
    }
    const mark: PositionMark = { price: rawPrice, asOf, source, fxRateToBase };
    position.mark = mark;
    return present(current);
  });
}

/** Attach an explicit factor-model proxy without changing price provenance. */
export function setPortfolioScenarioExposure(rawTicker: string, rawFactor: string, notes?: string) {
  const ticker = validateTicker(rawTicker);
  const factor = validateTicker(rawFactor, 'scenario factor');
  const exposure: PositionScenarioExposure = {
    factor,
    source: 'user',
    ...(notes?.trim() ? { notes: notes.trim() } : {}),
  };
  return mutatePortfolio(current => {
    const position = current.positions.find(item => item.ticker === ticker);
    if (!position) {
      throw new FinstackError(
        `Position not found: ${ticker}`,
        undefined,
        'Scenario exposure can only be attached to an existing holding',
        'Import or add the position first.',
      );
    }
    position.scenarioExposure = exposure;
    return present(current);
  });
}

export function clearPortfolioScenarioExposure(rawTicker: string) {
  const ticker = validateTicker(rawTicker);
  return mutatePortfolio(current => {
    const position = current.positions.find(item => item.ticker === ticker);
    if (!position) {
      throw new FinstackError(
        `Position not found: ${ticker}`,
        undefined,
        'Scenario exposure can only be cleared from an existing holding',
        'Import or add the position first.',
      );
    }
    delete position.scenarioExposure;
    return present(current);
  });
}

/** Replace an opening-balance snapshot under the portfolio lock. */
export function importPortfolioSnapshot(raw: unknown, replace = false) {
  const input = assertValidImport(raw);
  return mutatePortfolio(current => {
    if ((current.positions.length > 0 || current.transactions.length > 0) && !replace) {
      throw new FinstackError(
        'Portfolio already contains data',
        undefined,
        'Import replaces the current opening snapshot and clears its transaction log',
        'Review `finstack portfolio show`, then repeat with --replace only if that is intentional.',
      );
    }

    const addedAt = input.asOf || new Date().toISOString();
    current.schemaVersion = PORTFOLIO_SCHEMA_VERSION;
    current.baseCurrency = input.baseCurrency;
    current.positions = input.positions.map(position => ({ ...position, addedAt }));
    // The snapshot is an opening balance. No broker trade dates or lots were
    // supplied, so writing made-up buys would poison alpha analysis.
    current.transactions = [];
    return {
      message: 'Portfolio snapshot imported without fabricated transactions',
      importedAt: addedAt,
      ...present(current),
    };
  });
}

/**
 * Portfolio commands intentionally keep two different write paths:
 *
 * - `add` / `remove` record a trade and are for subsequent live decisions.
 * - `import` records an opening snapshot without inventing a historical trade.
 *
 * That distinction is non-negotiable: alpha and reflection consume the trade
 * log, and a broker screenshot cannot truthfully reconstruct its dates or lots.
 */
export async function portfolio(args: string[]) {
  const sub = args[0] || 'show';

  switch (sub) {
    case 'show': {
      console.log(JSON.stringify(present(loadPortfolio()), null, 2));
      return;
    }

    case 'init': {
      const baseCurrency = normalizeCurrency(
        parseFlag(args, '--base-currency') || 'USD',
        'baseCurrency',
      );
      const result = mutatePortfolio(current => {
        if (current.positions.length > 0 || current.transactions.length > 0) {
          return { message: 'Portfolio already exists', ...present(current) };
        }
        const initialized = emptyPortfolio(baseCurrency);
        current.schemaVersion = initialized.schemaVersion;
        current.baseCurrency = initialized.baseCurrency;
        current.positions = [];
        current.transactions = [];
        return { message: 'Empty portfolio initialized', ...present(current) };
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    case 'import': {
      if (args.includes('--schema')) {
        console.log(JSON.stringify(PORTFOLIO_IMPORT_SCHEMA, null, 2));
        return;
      }
      const imported = importPortfolioSnapshot(
        await readJSONFromStdin('portfolio snapshot', IMPORT_USAGE),
        args.includes('--replace'),
      );
      console.log(JSON.stringify(imported, null, 2));
      return;
    }

    case 'add': {
      const ticker = validateTicker(args[1]);
      const shares = validatePositiveNumber(args[2], 'shares');
      const avgCost = validatePositiveNumber(args[3], 'avgCost');
      const requestedCurrency = parseFlag(args, '--currency');
      const updated = mutatePortfolio(current => {
        const currency = normalizeCurrency(requestedCurrency || current.baseCurrency, 'currency');
        const existing = current.positions.find(position => position.ticker === ticker);
        if (existing) {
          if (existing.currency !== currency) {
            throw new FinstackError(
              `Currency mismatch for ${ticker}`,
              undefined,
              `${ticker} is held in ${existing.currency}, but this trade was entered as ${currency}`,
              'Use the same instrument currency or import distinct exchange tickers separately.',
            );
          }
          const totalShares = existing.shares + shares;
          existing.avgCost = (existing.avgCost * existing.shares + avgCost * shares) / totalShares;
          existing.shares = totalShares;
        } else {
          current.positions.push({
            ticker,
            shares,
            avgCost,
            currency,
            addedAt: new Date().toISOString(),
          });
        }
        current.transactions.push({
          ticker,
          action: 'buy',
          shares,
          price: avgCost,
          currency,
          date: new Date().toISOString(),
          reason: null,
        });
        return present(current);
      });
      console.log(JSON.stringify(updated, null, 2));
      return;
    }

    case 'mark': {
      const ticker = validateTicker(args[1]);
      const price = validatePositiveNumber(args[2], 'mark price');
      const asOf = parseInstant(parseFlag(args, '--as-of'), 'as-of');
      const source = parseFlag(args, '--source')?.trim() || 'manual';
      const fxRaw = parseFlag(args, '--fx-rate');
      const fxRateToBase =
        fxRaw === undefined ? undefined : validatePositiveNumber(fxRaw, 'FX rate');
      const updated = markPortfolioPosition(ticker, price, {
        asOf,
        source,
        fxRateToBase,
      });
      console.log(JSON.stringify(updated, null, 2));
      return;
    }

    case 'exposure': {
      const ticker = validateTicker(args[1]);
      if (args.includes('--clear')) {
        if (args[2] !== undefined) {
          throw new FinstackError(
            'Invalid scenario exposure command',
            undefined,
            'Use either a factor or --clear, not both',
            'Example: finstack portfolio exposure TSM XLK --notes "semiconductor proxy"',
          );
        }
        console.log(JSON.stringify(clearPortfolioScenarioExposure(ticker), null, 2));
        return;
      }
      const factor = validateTicker(args[2], 'scenario factor');
      const updated = setPortfolioScenarioExposure(ticker, factor, parseFlag(args, '--notes'));
      console.log(JSON.stringify(updated, null, 2));
      return;
    }

    case 'remove': {
      const ticker = validateTicker(args[1]);
      const reason = parseFlag(args, '--reason') || null;
      const priceRaw = parseFlag(args, '--price');
      const sellPriceOverride =
        priceRaw === undefined ? undefined : validatePositiveNumber(priceRaw, 'price');
      const shadow = loadShadow();
      const shadowEntry = shadow.entries?.find(
        (entry: any) => entry.ticker === ticker && entry.status === 'open',
      );

      if (shadowEntry && !reason) {
        const horizonDate = new Date(shadowEntry.timeHorizon);
        const daysRemaining = Math.ceil((horizonDate.getTime() - Date.now()) / 86_400_000);
        if (daysRemaining > 0) {
          console.log(
            JSON.stringify(
              {
                deviation_detected: true,
                ticker,
                shadow_status: 'open',
                planned_exit: shadowEntry.timeHorizon,
                days_remaining: daysRemaining,
                prompt: `You're closing ${ticker} ${daysRemaining} days before your plan's horizon. Reason?`,
                options: ['thesis-changed', 'stop-triggered', 'emotional', 'need-cash', 'other'],
                usage: `finstack portfolio remove ${ticker} --reason <reason>`,
              },
              null,
              2,
            ),
          );
        }
      }

      const updated = mutatePortfolio(current => {
        const position = current.positions.find(item => item.ticker === ticker);
        if (position) {
          const sellPrice = sellPriceOverride ?? position.mark?.price ?? position.avgCost;
          current.transactions.push({
            ticker,
            action: 'sell',
            shares: position.shares,
            price: sellPrice,
            currency: position.currency,
            date: new Date().toISOString(),
            reason: reason || (shadowEntry ? 'unspecified' : null),
          });
        }
        current.positions = current.positions.filter(position => position.ticker !== ticker);
        return present(current);
      });
      console.log(JSON.stringify(updated, null, 2));
      return;
    }

    default:
      throw new FinstackError(
        `Unknown subcommand: ${sub}`,
        undefined,
        undefined,
        'Use show|init|import|add|mark|exposure|remove',
      );
  }
}
