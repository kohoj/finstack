// engine/src/commands/financials.ts

import { getCached, getCachedWithFallback, setCache } from '../cache';
import { getKey } from '../data/keys';
import { extractFinancials, fetchQuoteSummary } from '../data/yahoo';
import { FinstackError } from '../errors';
import { validateTicker } from '../validation';

const MODULES = ['financialData', 'defaultKeyStatistics', 'price', 'assetProfile'];

export async function financials(args: string[]) {
  const ticker = validateTicker(args[0]);

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
    `Cannot fetch financials for ${ticker}`,
    'yahoo',
    'All data sources unavailable',
    'Retry later, or configure FMP: finstack keys set fmp YOUR_KEY',
  );
}
