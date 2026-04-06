// engine/src/commands/quote.ts
import { fetchChart, extractQuote } from '../data/yahoo';
import { getCached, getCachedWithFallback, setCache } from '../cache';
import { getKey } from '../data/keys';
import { FinstackError } from '../errors';

export async function quote(args: string[]) {
  const ticker = args[0]?.toUpperCase();
  if (!ticker) {
    console.error(JSON.stringify({ error: 'Usage: finstack quote <ticker>' }));
    process.exit(1);
  }

  const cacheKey = `quote-${ticker}`;

  // Check fresh cache first
  const cached = getCached(cacheKey, 'quote');
  if (cached) {
    const { _cachedAt, _v, ...data } = cached;
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Try Yahoo
  try {
    const raw = await fetchChart(ticker, '5d', '1d');
    const data = extractQuote(raw);
    if (data) {
      setCache(cacheKey, data);
      console.log(JSON.stringify(data, null, 2));
      return;
    }
  } catch {}

  // Try Polygon (if key configured)
  if (getKey('polygon')) {
    try {
      const { fetchBars } = await import('../data/polygon');
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      const bars = await fetchBars(ticker, weekAgo, today);
      if (bars.bars.length > 0) {
        const last = bars.bars[bars.bars.length - 1];
        const data = { ticker, price: last.close, source: 'polygon', date: last.date };
        setCache(cacheKey, data);
        console.log(JSON.stringify(data, null, 2));
        return;
      }
    } catch {}
  }

  // Fallback to stale cache
  const stale = getCachedWithFallback(cacheKey, 'quote');
  if (stale) {
    console.log(JSON.stringify({ ...stale.data, _stale: true, _cacheAge: stale.age }, null, 2));
    return;
  }

  throw new FinstackError(
    `无法获取 ${ticker} 报价`,
    'yahoo',
    '所有数据源均不可用',
    '稍后重试，或配置备选数据源: finstack keys set polygon YOUR_KEY',
  );
}
