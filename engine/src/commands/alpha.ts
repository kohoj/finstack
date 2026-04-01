import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadShadow, type ShadowEntry } from '../data/shadow';

const FINSTACK_DIR = join(homedir(), '.finstack');
const PORTFOLIO_FILE = join(FINSTACK_DIR, 'portfolio.json');

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
  if (!existsSync(PORTFOLIO_FILE)) return { positions: [], transactions: [], updatedAt: '' };
  try {
    const data = JSON.parse(readFileSync(PORTFOLIO_FILE, 'utf-8'));
    if (!data.transactions) data.transactions = [];
    return data as Portfolio;
  } catch {
    return { positions: [], transactions: [], updatedAt: '' };
  }
}

export async function alpha(args: string[]) {
  const lastN = args.includes('--last') ? parseInt(args[args.indexOf('--last') + 1]) : 10;

  const portfolio = loadPortfolio();
  const shadow = loadShadow();

  const sellTxs = portfolio.transactions
    .filter((t: Transaction) => t.action === 'sell')
    .slice(-lastN);

  if (sellTxs.length === 0) {
    console.log(JSON.stringify({
      message: 'No completed decision cycles yet. Use /judge → /act → trade → /track to build history.',
      decisionsNeeded: 3,
    }, null, 2));
    return;
  }

  const positionAlphas: PositionAlpha[] = [];

  for (const tx of sellTxs) {
    const buyTx = portfolio.transactions.find(
      (t: Transaction) => t.action === 'buy' && t.ticker === tx.ticker && t.date < tx.date,
    );
    if (!buyTx) continue;

    // Find shadow entry — closed or still open
    const shadowEntry = shadow.entries.find(
      (e: ShadowEntry) => e.ticker === tx.ticker,
    );

    if (!shadowEntry) {
      // No shadow at all — still include with zero shadow P&L so user sees the gap
      const pa = calculatePositionAlpha(
        { ticker: tx.ticker, buyPrice: buyTx.price, sellPrice: tx.price, shares: tx.shares },
        { ticker: tx.ticker, buyPrice: buyTx.price, sellPrice: buyTx.price, shares: tx.shares },
      );
      pa.estimated = true;
      pa.deviationReason = tx.reason;
      positionAlphas.push(pa);
      continue;
    }

    const filledTranches = shadowEntry.stagedPlan.filter(t => t.status === 'filled');
    const shadowBuyPrice = filledTranches.length > 0
      ? filledTranches.reduce((s, t) => s + (t.fillPrice || 0) * t.shares, 0) / filledTranches.reduce((s, t) => s + t.shares, 0)
      : buyTx.price;

    // If shadow is still open, use the real sell price as estimated shadow exit
    const shadowSellPrice = shadowEntry.status === 'closed'
      ? (shadowEntry.exitPrice || tx.price)
      : tx.price;
    const isEstimated = shadowEntry.status === 'open';

    const pa = calculatePositionAlpha(
      { ticker: tx.ticker, buyPrice: buyTx.price, sellPrice: tx.price, shares: tx.shares },
      { ticker: tx.ticker, buyPrice: shadowBuyPrice, sellPrice: shadowSellPrice, shares: shadowEntry.filledShares || tx.shares },
    );
    pa.estimated = isEstimated;
    pa.deviationReason = tx.reason;
    positionAlphas.push(pa);
  }

  const totalRealPL = positionAlphas.reduce((s, p) => s + p.realPL, 0);
  const totalShadowPL = positionAlphas.reduce((s, p) => s + p.shadowPL, 0);

  const costsByPattern: Record<string, { occurrences: number; totalCost: number; details: { ticker: string; cost: number; reason: string | undefined }[] }> = {};
  for (const pa of positionAlphas) {
    if (pa.behavioralCost >= 0) continue;
    const pattern = categorizeDeviation(pa.deviationReason || null);
    if (!costsByPattern[pattern]) costsByPattern[pattern] = { occurrences: 0, totalCost: 0, details: [] };
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
      basis: `last ${sellTxs.length} decisions`,
      from: sellTxs[0]?.date,
      to: sellTxs[sellTxs.length - 1]?.date,
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
    positions: positionAlphas,
  };

  console.log(JSON.stringify(output, null, 2));
}
