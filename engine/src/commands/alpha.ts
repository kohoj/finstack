import { existsSync, readFileSync } from 'node:fs';
import { loadShadow, type ShadowEntry, weightedFillPrice } from '../data/shadow';
import { fetchHistoricalClose } from '../data/yahoo';
import { paths } from '../paths';
import { validatePositiveInt } from '../validation';

interface Position {
  ticker: string;
  shares: number;
  avgCost: number;
  addedAt: string;
}

interface Transaction {
  ticker: string;
  action: 'buy' | 'sell';
  shares: number;
  price: number;
  date: string;
  reason: string | null;
}

interface Portfolio {
  positions: Position[];
  transactions: Transaction[];
  updatedAt: string;
}

interface PositionAlpha {
  ticker: string;
  realPL: number;
  shadowPL: number;
  behavioralCost: number;
  estimated?: boolean;
  deviationReason?: string;
}

export function calculatePositionAlpha(
  real: { ticker: string; buyPrice: number; sellPrice: number; shares: number },
  shadow: { ticker: string; buyPrice: number; sellPrice: number; shares: number },
): PositionAlpha {
  const realPL = (real.sellPrice - real.buyPrice) * real.shares;
  const shadowPL = (shadow.sellPrice - shadow.buyPrice) * shadow.shares;
  return {
    ticker: real.ticker,
    realPL: +realPL.toFixed(2),
    shadowPL: +shadowPL.toFixed(2),
    behavioralCost: +(realPL - shadowPL).toFixed(2),
  };
}

export function calculateAggregate(
  positions: { realPL: number; shadowPL: number; behavioralCost: number }[],
  spyReturn: number,
  portfolioValue: number,
) {
  const realTotal = positions.reduce((s, p) => s + p.realPL, 0);
  const shadowTotal = positions.reduce((s, p) => s + p.shadowPL, 0);
  const benchmarkDollars = portfolioValue * spyReturn;

  return {
    benchmark: {
      ticker: 'SPY',
      return: +(spyReturn * 100).toFixed(2),
      returnDollars: +benchmarkDollars.toFixed(2),
    },
    shadow: {
      returnDollars: +shadowTotal.toFixed(2),
    },
    real: {
      returnDollars: +realTotal.toFixed(2),
    },
    analyticalAlpha: {
      dollars: +(shadowTotal - benchmarkDollars).toFixed(2),
    },
    executionDrag: {
      dollars: +(realTotal - shadowTotal).toFixed(2),
    },
    netAlpha: {
      dollars: +(realTotal - benchmarkDollars).toFixed(2),
    },
  };
}

export function categorizeDeviation(reason: string | null): string {
  if (!reason || reason === 'unspecified') return 'unspecified';
  if (reason === 'emotional') return 'early-profit-taking';
  if (reason === 'stop-triggered') return 'stop-loss-avoidance';
  return reason;
}

function loadPortfolio(): Portfolio {
  if (!existsSync(paths.PORTFOLIO_FILE)) return { positions: [], transactions: [], updatedAt: '' };
  try {
    const data = JSON.parse(readFileSync(paths.PORTFOLIO_FILE, 'utf-8'));
    if (!data.transactions) data.transactions = [];
    return data as Portfolio;
  } catch {
    return { positions: [], transactions: [], updatedAt: '' };
  }
}

/**
 * SPY total return as a fraction (0.085 = +8.5%) between two dates. Null when
 * either historical close is unavailable, so the benchmark is reported only when
 * real. calculateAggregate expects a fraction, not a percent.
 */
async function spyFractionalReturn(fromIso: string, toIso: string): Promise<number | null> {
  const [start, end] = await Promise.all([
    fetchHistoricalClose('SPY', fromIso.split('T')[0]),
    fetchHistoricalClose('SPY', toIso.split('T')[0]),
  ]);
  if (start === null || end === null || start === 0) return null;
  return (end - start) / start;
}

export async function alpha(args: string[]) {
  const lastN = args.includes('--last')
    ? validatePositiveInt(args[args.indexOf('--last') + 1], 'last')
    : 10;

  const portfolio = loadPortfolio();
  const shadow = loadShadow();

  const sells = portfolio.transactions
    .map((t, index) => ({ tx: t, index }))
    .filter(({ tx }) => tx.action === 'sell')
    .slice(-lastN);

  if (sells.length === 0) {
    console.log(
      JSON.stringify(
        {
          message:
            'No completed decision cycles yet. Use /judge → /act → trade → /track to build history.',
          decisionsNeeded: 3,
        },
        null,
        2,
      ),
    );
    return;
  }

  const positionAlphas: PositionAlpha[] = [];
  let deployedCapital = 0; // real cost basis, for the SPY benchmark comparison

  for (const { tx, index } of sells) {
    // Pair by log order, not timestamp. Timestamps are millisecond-resolution
    // ISO strings, so a buy and sell recorded in the same millisecond compare
    // equal and a strict `<` silently dropped the position from the report.
    // The transaction log is append-only, so position in the array is the
    // authoritative ordering.
    const buyTx = portfolio.transactions
      .slice(0, index)
      .reverse()
      .find((t: Transaction) => t.action === 'buy' && t.ticker === tx.ticker);
    if (!buyTx) continue;

    deployedCapital += buyTx.price * tx.shares;

    // Find shadow entry — closed or still open
    const shadowEntry = shadow.entries.find((e: ShadowEntry) => e.ticker === tx.ticker);

    if (!shadowEntry) {
      // No shadow at all — still include with zero shadow P&L so user sees the gap
      const pa = calculatePositionAlpha(
        { ticker: tx.ticker, buyPrice: buyTx.price, sellPrice: tx.price, shares: tx.shares },
        { ticker: tx.ticker, buyPrice: buyTx.price, sellPrice: buyTx.price, shares: tx.shares },
      );
      pa.estimated = true;
      pa.deviationReason = tx.reason ?? undefined;
      positionAlphas.push(pa);
      continue;
    }

    const shadowBuyPrice = weightedFillPrice(shadowEntry) ?? buyTx.price;

    // If shadow is still open, use the real sell price as estimated shadow exit
    const shadowSellPrice =
      shadowEntry.status === 'closed' ? shadowEntry.exitPrice || tx.price : tx.price;
    const isEstimated = shadowEntry.status === 'open';

    const pa = calculatePositionAlpha(
      { ticker: tx.ticker, buyPrice: buyTx.price, sellPrice: tx.price, shares: tx.shares },
      {
        ticker: tx.ticker,
        buyPrice: shadowBuyPrice,
        sellPrice: shadowSellPrice,
        shares: shadowEntry.filledShares || tx.shares,
      },
    );
    pa.estimated = isEstimated;
    pa.deviationReason = tx.reason ?? undefined;
    positionAlphas.push(pa);
  }

  const totalRealPL = positionAlphas.reduce((s, p) => s + p.realPL, 0);
  const totalShadowPL = positionAlphas.reduce((s, p) => s + p.shadowPL, 0);

  // Benchmark: what the same deployed capital would have returned in SPY over
  // the reporting window. calculateAggregate splits net alpha into the analytical
  // edge (shadow vs SPY) and execution drag (real vs shadow). Reported only when
  // the benchmark is real — a missing SPY close must not read as flat.
  const from = sells[0]?.tx.date;
  const to = sells[sells.length - 1]?.tx.date;
  const spyReturn = from && to ? await spyFractionalReturn(from, to) : null;
  const aggregate =
    spyReturn !== null && deployedCapital > 0
      ? calculateAggregate(positionAlphas, spyReturn, deployedCapital)
      : null;

  const costsByPattern: Record<
    string,
    {
      occurrences: number;
      totalCost: number;
      details: { ticker: string; cost: number; reason: string | undefined }[];
    }
  > = {};
  for (const pa of positionAlphas) {
    if (pa.behavioralCost >= 0) continue;
    const pattern = categorizeDeviation(pa.deviationReason || null);
    if (!costsByPattern[pattern])
      costsByPattern[pattern] = { occurrences: 0, totalCost: 0, details: [] };
    costsByPattern[pattern].occurrences++;
    costsByPattern[pattern].totalCost += pa.behavioralCost;
    costsByPattern[pattern].details.push({
      ticker: pa.ticker,
      cost: pa.behavioralCost,
      reason: pa.deviationReason,
    });
  }

  const output = {
    period: {
      type: 'rolling',
      basis: `last ${sells.length} decisions`,
      from: sells[0]?.tx.date,
      to: sells[sells.length - 1]?.tx.date,
    },
    real: { totalPL: +totalRealPL.toFixed(2) },
    shadow: { totalPL: +totalShadowPL.toFixed(2) },
    executionDrag: { dollars: +(totalRealPL - totalShadowPL).toFixed(2) },
    behavioralCosts: Object.entries(costsByPattern).map(([pattern, data]) => ({
      pattern,
      ...data,
      totalCost: +data.totalCost.toFixed(2),
    })),
    executionFidelity: {
      followed: positionAlphas.filter(p => Math.abs(p.behavioralCost) < 50).length,
      total: positionAlphas.length,
    },
    benchmark: aggregate,
    positions: positionAlphas,
  };

  console.log(JSON.stringify(output, null, 2));
}
