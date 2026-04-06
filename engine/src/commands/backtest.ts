import { THESES_FILE, SHADOW_FILE } from '../paths';
import { readJSONSafe } from '../fs';
import { getCached, setCache } from '../cache';
import type { Thesis, ThesesStore } from '../data/thesis';
import type { ShadowEntry, Shadow } from '../data/shadow';

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

export interface BacktestResult {
  thesisId: string;
  ticker: string;
  thesis: string;
  verdict: string;
  status: string;
  holdingPeriod: number;
  entryPrice: number | null;
  exitPrice: number | null;
  returnPct: number | null;
  spyReturnPct: number | null;
  alpha: number | null;
  conditionResults: { description: string; status: string; met: boolean | null }[];
  followedPlan: boolean | null;
  createdAt: string;
  closedAt: string | null;
}

function daysBetween(a: string, b: string): number {
  return Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

async function fetchClosingPrice(ticker: string, date: string): Promise<number | null> {
  try {
    const { fetchChart } = await import('../data/yahoo');
    const raw = await fetchChart(ticker, '5d', '1d');
    const result = raw?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;
    return meta.regularMarketPrice || null;
  } catch {
    return null;
  }
}

export function buildBacktestResult(
  thesis: Thesis,
  shadow: ShadowEntry | null,
  currentPrice: number | null,
  spyReturn: number | null,
): BacktestResult {
  const endDate = thesis.status === 'dead'
    ? thesis.statusHistory.find(h => h.to === 'dead')?.date || new Date().toISOString()
    : new Date().toISOString();

  const entryPrice = shadow?.stagedPlan?.[0]?.fillPrice || null;
  const exitPrice = shadow?.exitPrice || currentPrice;

  let returnPct: number | null = null;
  if (entryPrice && exitPrice) {
    returnPct = +((exitPrice - entryPrice) / entryPrice * 100).toFixed(2);
  }

  const alpha = returnPct !== null && spyReturn !== null
    ? +(returnPct - spyReturn).toFixed(2)
    : null;

  const conditionResults = thesis.conditions.map(c => ({
    description: c.description,
    status: c.status,
    met: c.status === 'passed' ? true : c.status === 'failed' ? false : null,
  }));

  const followedPlan = shadow
    ? shadow.filledShares === shadow.totalShares
    : null;

  return {
    thesisId: thesis.id,
    ticker: thesis.ticker,
    thesis: thesis.thesis,
    verdict: thesis.verdict,
    status: thesis.status,
    holdingPeriod: daysBetween(thesis.createdAt, endDate),
    entryPrice,
    exitPrice,
    returnPct,
    spyReturnPct: spyReturn,
    alpha,
    conditionResults,
    followedPlan,
    createdAt: thesis.createdAt,
    closedAt: thesis.status === 'dead' ? endDate : null,
  };
}

export async function backtest(args: string[]) {
  const thesisId = parseFlag(args, '--thesis');
  const periodStr = parseFlag(args, '--period');
  const period = periodStr ? parseInt(periodStr) : undefined;

  const store = readJSONSafe<ThesesStore>(THESES_FILE, { theses: [] });
  const shadow = readJSONSafe<Shadow>(SHADOW_FILE, { entries: [] });

  // Filter theses
  let theses = store.theses;

  if (thesisId) {
    theses = theses.filter(t => t.id === thesisId);
    if (theses.length === 0) {
      console.error(JSON.stringify({ error: `Thesis ${thesisId} not found` }));
      process.exit(1);
    }
  } else {
    // Default: closed/dead theses
    theses = theses.filter(t => t.status === 'dead');
  }

  if (period) {
    const cutoff = new Date(Date.now() - period * 86400000).toISOString();
    theses = theses.filter(t => t.createdAt >= cutoff);
  }

  if (theses.length === 0) {
    console.log(JSON.stringify({
      message: 'No theses to backtest. Dead theses will appear here after /judge kills them.',
      results: [],
      count: 0,
    }, null, 2));
    return;
  }

  const results: BacktestResult[] = [];

  for (const thesis of theses) {
    // Find matching shadow entry
    const shadowEntry = shadow.entries.find(e => e.linkedThesis === thesis.id) || null;

    // Get current price for open theses
    const currentPrice = thesis.status !== 'dead'
      ? await fetchClosingPrice(thesis.ticker, new Date().toISOString().split('T')[0])
      : shadowEntry?.exitPrice || null;

    const result = buildBacktestResult(thesis, shadowEntry, currentPrice, null);
    results.push(result);
  }

  // Summary stats
  const withReturns = results.filter(r => r.returnPct !== null);
  const avgReturn = withReturns.length > 0
    ? +(withReturns.reduce((s, r) => s + r.returnPct!, 0) / withReturns.length).toFixed(2)
    : null;
  const winRate = withReturns.length > 0
    ? +(withReturns.filter(r => r.returnPct! > 0).length / withReturns.length * 100).toFixed(1)
    : null;

  console.log(JSON.stringify({
    results,
    count: results.length,
    summary: {
      avgReturn,
      winRate,
      totalTheses: results.length,
      withShadow: results.filter(r => r.followedPlan !== null).length,
      conditionsResolved: results.flatMap(r => r.conditionResults).filter(c => c.met !== null).length,
    },
  }, null, 2));
}
