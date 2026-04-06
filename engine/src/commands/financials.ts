// engine/src/commands/financials.ts
import { fetchQuoteSummary, extractFinancials } from '../data/yahoo';
import { getCached, getCachedWithFallback, setCache } from '../cache';
import { getKey } from '../data/keys';
import { FinstackError } from '../errors';

const MODULES = ['financialData', 'defaultKeyStatistics', 'price', 'assetProfile'];

export async function financials(args: string[]) {
  const ticker = args[0]?.toUpperCase();
  if (!ticker) {
    console.error(JSON.stringify({ error: 'Usage: finstack financials <ticker>' }));
    process.exit(1);
  }

  const cacheKey = `financials-${ticker}`;
  const cached = getCached(cacheKey, 'financials');
  if (cached) {
    const { _cachedAt, _v, ...data } = cached;
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Try Yahoo
  try {
    const raw = await fetchQuoteSummary(ticker, MODULES);
    const data = extractFinancials(raw);
    if (data) {
      setCache(cacheKey, data);
      console.log(JSON.stringify(data, null, 2));
      return;
    }
  } catch {}

  // Try FMP (if key configured)
  if (getKey('fmp')) {
    try {
      const { fetchFMPFinancials } = await import('../data/fmp');
      const data = await fetchFMPFinancials(ticker, getKey('fmp')!);
      if (data) {
        setCache(cacheKey, data);
        console.log(JSON.stringify(data, null, 2));
        return;
      }
    } catch {}
  }

  // Fallback to stale cache
  const stale = getCachedWithFallback(cacheKey, 'financials');
  if (stale) {
    console.log(JSON.stringify({ ...stale.data, _stale: true, _cacheAge: stale.age }, null, 2));
    return;
  }

  throw new FinstackError(
    `无法获取 ${ticker} 财务数据`,
    'yahoo',
    '所有数据源均不可用',
    '稍后重试，或配置 FMP: finstack keys set fmp YOUR_KEY',
  );
}
