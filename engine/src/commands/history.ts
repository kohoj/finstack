import { fetchChart } from '../data/yahoo';
import { fetchBars } from '../data/polygon';
import { getKey } from '../data/keys';
import { getCached, getCachedWithFallback, setCache } from '../cache';
import { FinstackError } from '../errors';

function parseArgs(args: string[]): { ticker: string; from: string; to: string } {
  const ticker = args[0]?.toUpperCase();
  if (!ticker) {
    console.error(JSON.stringify({ error: 'Usage: finstack history <ticker> --from YYYY-MM-DD --to YYYY-MM-DD' }));
    process.exit(1);
  }

  const fromIdx = args.indexOf('--from');
  const toIdx = args.indexOf('--to');

  const today = new Date().toISOString().split('T')[0];
  const threeMonthsAgo = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];

  return {
    ticker,
    from: fromIdx >= 0 ? args[fromIdx + 1] : threeMonthsAgo,
    to: toIdx >= 0 ? args[toIdx + 1] : today,
  };
}

function yahooRangeFor(from: string, to: string): string {
  const days = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
  if (days <= 5) return '5d';
  if (days <= 30) return '1mo';
  if (days <= 90) return '3mo';
  if (days <= 180) return '6mo';
  if (days <= 365) return '1y';
  if (days <= 730) return '2y';
  if (days <= 1825) return '5y';
  return '10y';
}

export async function history(args: string[]) {
  const { ticker, from, to } = parseArgs(args);

  const isHistorical = new Date(to) < new Date(Date.now() - 86400000);
  const cacheKey = `history-${ticker}-${from}-${to}`;
  const cacheType = isHistorical ? 'history-old' : 'history';
  const cached = getCached(cacheKey, cacheType);
  if (cached) {
    const { _cachedAt, ...data } = cached;
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Try Yahoo first
  try {
    const range = yahooRangeFor(from, to);
    const raw = await fetchChart(ticker, range, '1d');
    const result = raw?.chart?.result?.[0];
    if (result) {
      const timestamps = result.timestamp || [];
      const quotes = result.indicators?.quote?.[0] || {};
      const bars = timestamps.map((t: number, i: number) => ({
        date: new Date(t * 1000).toISOString().split('T')[0],
        open: quotes.open?.[i] ? +quotes.open[i].toFixed(2) : null,
        high: quotes.high?.[i] ? +quotes.high[i].toFixed(2) : null,
        low: quotes.low?.[i] ? +quotes.low[i].toFixed(2) : null,
        close: quotes.close?.[i] ? +quotes.close[i].toFixed(2) : null,
        volume: quotes.volume?.[i] || 0,
      })).filter((b: any) => {
        const d = b.date;
        return d >= from && d <= to && b.close !== null;
      });

      const output = { ticker, from, to, source: 'yahoo', bars };
      setCache(cacheKey, output);
      console.log(JSON.stringify(output, null, 2));
      return;
    }
  } catch {
    // Fall through to Polygon
  }

  // Fallback to Polygon
  if (getKey('polygon')) {
    const data = await fetchBars(ticker, from, to);
    const output = { ...data, from, to, source: 'polygon' };
    setCache(cacheKey, output);
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Fallback to stale cache
  const stale = getCachedWithFallback(cacheKey, cacheType);
  if (stale) {
    console.log(JSON.stringify({ ...stale.data, _stale: true, _cacheAge: stale.age }, null, 2));
    return;
  }

  throw new FinstackError(
    `无法获取 ${ticker} 历史数据`,
    'yahoo',
    'Yahoo 和 Polygon 均不可用',
    'finstack keys set polygon YOUR_KEY',
  );
}
