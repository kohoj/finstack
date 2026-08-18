import type { Shadow, ShadowEntry } from '../data/shadow';
import { weightedFillPrice } from '../data/shadow';
import type { ThesesStore, Thesis } from '../data/thesis';
import { fetchHistoricalClose } from '../data/yahoo';
import { FinstackError } from '../errors';
import { readJSONSafe } from '../fs';
import { paths } from '../paths';
import { validatePositiveInt } from '../validation';

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

const isoDay = (iso: string): string => iso.split('T')[0];

/**
 * SPY total return (percent) between two dates, using historical closes. Returns
 * null when either endpoint is unavailable, so alpha is reported only when the
 * benchmark is real rather than silently assumed to be zero.
 */
async function spyReturnPct(startIso: string, endIso: string): Promise<number | null> {
  const [start, end] = await Promise.all([
    fetchHistoricalClose('SPY', isoDay(startIso)),
    fetchHistoricalClose('SPY', isoDay(endIso)),
  ]);
  if (start === null || end === null || start === 0) return null;
  return +(((end - start) / start) * 100).toFixed(2);
}

export function buildBacktestResult(
  thesis: Thesis,
  shadow: ShadowEntry | null,
  currentPrice: number | null,
  spyReturn: number | null,
): BacktestResult {
  const endDate =
    thesis.status === 'dead'
      ? thesis.statusHistory.find(h => h.to === 'dead')?.date || new Date().toISOString()
      : new Date().toISOString();

  const entryPrice = shadow ? weightedFillPrice(shadow) : null;
  const exitPrice = shadow?.exitPrice || currentPrice;

  let returnPct: number | null = null;
  if (entryPrice && exitPrice) {
    returnPct = +(((exitPrice - entryPrice) / entryPrice) * 100).toFixed(2);
  }

  const alpha =
    returnPct !== null && spyReturn !== null ? +(returnPct - spyReturn).toFixed(2) : null;

  const conditionResults = thesis.conditions.map(c => ({
    description: c.description,
    status: c.status,
    met: c.status === 'passed' ? true : c.status === 'failed' ? false : null,
  }));

  const followedPlan = shadow ? shadow.filledShares === shadow.totalShares : null;

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
  const period = periodStr ? validatePositiveInt(periodStr, 'period') : undefined;

  const store = readJSONSafe<ThesesStore>(paths.THESES_FILE, { theses: [] });
  const shadow = readJSONSafe<Shadow>(paths.SHADOW_FILE, { entries: [] });

  // Filter theses
  let theses = store.theses;

  if (thesisId) {
    theses = theses.filter(t => t.id === thesisId);
    if (theses.length === 0) {
      throw new FinstackError(
        `Thesis ${thesisId} not found`,
        undefined,
        'No thesis with that id exists',
        'Run `finstack thesis list` to see ids',
      );
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
    console.log(
      JSON.stringify(
        {
          message: 'No theses to backtest. Dead theses will appear here after /judge kills them.',
          results: [],
          count: 0,
        },
        null,
        2,
      ),
    );
    return;
  }

  const results: BacktestResult[] = [];

  for (const thesis of theses) {
    // Find matching shadow entry
    const shadowEntry = shadow.entries.find(e => e.linkedThesis === thesis.id) || null;

    const deathDate =
      thesis.status === 'dead'
        ? thesis.statusHistory.find(h => h.to === 'dead')?.date || new Date().toISOString()
        : new Date().toISOString();

    // Current price for open theses is the historical close on the death/now
    // date; dead theses use the recorded exit.
    const currentPrice =
      thesis.status !== 'dead'
        ? await fetchHistoricalClose(thesis.ticker, isoDay(deathDate))
        : shadowEntry?.exitPrice || null;

    // Benchmark over the same holding window, so alpha is like-for-like.
    const spyReturn = await spyReturnPct(thesis.createdAt, deathDate);

    const result = buildBacktestResult(thesis, shadowEntry, currentPrice, spyReturn);
    results.push(result);
  }

  // Summary stats
  const withReturns = results.filter(r => r.returnPct !== null);
  const avgReturn =
    withReturns.length > 0
      ? +(withReturns.reduce((s, r) => s + r.returnPct!, 0) / withReturns.length).toFixed(2)
      : null;
  const winRate =
    withReturns.length > 0
      ? +((withReturns.filter(r => r.returnPct! > 0).length / withReturns.length) * 100).toFixed(1)
      : null;

  console.log(
    JSON.stringify(
      {
        results,
        count: results.length,
        summary: {
          avgReturn,
          winRate,
          totalTheses: results.length,
          withShadow: results.filter(r => r.followedPlan !== null).length,
          conditionsResolved: results.flatMap(r => r.conditionResults).filter(c => c.met !== null)
            .length,
        },
      },
      null,
      2,
    ),
  );
}
