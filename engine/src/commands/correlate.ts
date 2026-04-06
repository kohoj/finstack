import { PORTFOLIO_FILE, WATCHLIST_FILE } from '../paths';
import { readJSONSafe } from '../fs';
import { getCached, setCache } from '../cache';

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (den === 0) return 0;

  return +(num / den).toFixed(4);
}

export function dailyReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] !== 0) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
  }
  return returns;
}

export function computeCorrelationMatrix(
  tickers: string[],
  returnSeries: Map<string, number[]>,
): { matrix: number[][]; warnings: string[] } {
  const n = tickers.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const warnings: string[] = [];

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        matrix[i][j] = 1.0;
        continue;
      }
      const ri = returnSeries.get(tickers[i]);
      const rj = returnSeries.get(tickers[j]);
      if (!ri || !rj) {
        matrix[i][j] = 0;
        continue;
      }
      // Align by taking the shorter length
      const len = Math.min(ri.length, rj.length);
      const r = pearsonCorrelation(ri.slice(-len), rj.slice(-len));
      matrix[i][j] = r;

      if (i < j && Math.abs(r) > 0.8) {
        warnings.push(`${tickers[i]} ↔ ${tickers[j]}: r=${r} (highly correlated)`);
      }
    }
  }

  return { matrix, warnings };
}

async function fetchClosePrices(ticker: string, period: number): Promise<number[]> {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - period * 86400000).toISOString().split('T')[0];

  const cacheKey = `history-${ticker}-${from}-${to}`;
  const cached = getCached(cacheKey, 'history');
  if (cached) {
    return cached.bars?.map((b: any) => b.close).filter(Boolean) || [];
  }

  try {
    const { fetchChart } = await import('../data/yahoo');
    const range = period <= 30 ? '1mo' : period <= 90 ? '3mo' : period <= 180 ? '6mo' : '1y';
    const raw = await fetchChart(ticker, range, '1d');
    const result = raw?.chart?.result?.[0];
    if (!result) return [];

    const quotes = result.indicators?.quote?.[0];
    const closes = (quotes?.close || []).filter((c: any) => c !== null);

    // Cache the result
    const timestamps = result.timestamp || [];
    const bars = timestamps.map((t: number, i: number) => ({
      date: new Date(t * 1000).toISOString().split('T')[0],
      close: quotes?.close?.[i] ?? null,
    })).filter((b: any) => b.close !== null);
    setCache(cacheKey, { ticker, from, to, source: 'yahoo', bars });

    return closes;
  } catch {
    return [];
  }
}

export async function correlate(args: string[]) {
  const periodStr = parseFlag(args, '--period');
  const period = periodStr ? parseInt(periodStr) : 90;
  const includeWatchlist = args.includes('--include-watchlist');

  // Gather tickers
  const portfolio = readJSONSafe<any>(PORTFOLIO_FILE, { positions: [] });
  let tickers = portfolio.positions.map((p: any) => p.ticker as string);

  if (includeWatchlist) {
    const watchlist = readJSONSafe<any[]>(WATCHLIST_FILE, []);
    const wlTickers = watchlist.map((w: any) => w.ticker as string);
    tickers = [...new Set([...tickers, ...wlTickers])];
  }

  if (tickers.length < 2) {
    console.log(JSON.stringify({
      message: 'Need at least 2 tickers for correlation. Add positions or use --include-watchlist.',
    }, null, 2));
    return;
  }

  // Fetch price data
  const returnSeries = new Map<string, number[]>();
  const batchSize = 5;

  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async (t) => {
      const closes = await fetchClosePrices(t, period);
      return { ticker: t, returns: dailyReturns(closes) };
    }));
    for (const r of results) {
      if (r.returns.length > 0) {
        returnSeries.set(r.ticker, r.returns);
      }
    }
  }

  // Check if we got data
  const tickersWithData = tickers.filter(t => returnSeries.has(t));
  const tickersWithout = tickers.filter(t => !returnSeries.has(t));

  const { matrix, warnings } = computeCorrelationMatrix(tickers, returnSeries);

  console.log(JSON.stringify({
    period: `${period} days`,
    tickers,
    matrix,
    highCorrelation: warnings,
    ...(tickersWithout.length > 0 ? {
      noData: tickersWithout,
      note: `${tickersWithout.length} ticker(s) 无法获取历史数据（数据源可能暂时不可用）。配置 Polygon API key 可提高可用性: finstack keys set polygon YOUR_KEY`,
    } : {}),
  }, null, 2));
}
