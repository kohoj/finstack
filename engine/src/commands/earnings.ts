// engine/src/commands/earnings.ts
import { fetchEarnings } from '../data/alphavantage';
import { getCached, getCachedWithFallback, setCache } from '../cache';
import { FinstackError } from '../errors';

export async function earnings(args: string[]) {
  const ticker = args[0]?.toUpperCase();
  if (!ticker) {
    console.error(JSON.stringify({ error: 'Usage: finstack earnings <ticker>' }));
    process.exit(1);
  }

  const cacheKey = `earnings-${ticker}`;
  const cached = getCached(cacheKey, 'earnings');
  if (cached) {
    const { _cachedAt, _v, ...data } = cached;
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  try {
    const data = await fetchEarnings(ticker);
    setCache(cacheKey, data);
    console.log(JSON.stringify(data, null, 2));
  } catch (e: any) {
    const stale = getCachedWithFallback(cacheKey, 'earnings');
    if (stale) {
      console.log(JSON.stringify({ ...stale.data, _stale: true, _cacheAge: stale.age }, null, 2));
      return;
    }
    throw new FinstackError(
      `无法获取 ${ticker} earnings 数据`,
      'alphavantage',
      e.message,
      'finstack keys set alphavantage YOUR_KEY',
    );
  }
}
