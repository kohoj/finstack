import { fetchEarnings } from '../data/alphavantage';
import { getCached, setCache } from '../cache';

export async function earnings(args: string[]) {
  const ticker = args[0]?.toUpperCase();
  if (!ticker) {
    console.error(JSON.stringify({ error: 'Usage: finstack earnings <ticker>' }));
    process.exit(1);
  }

  const cacheKey = `earnings-${ticker}`;
  const cached = getCached(cacheKey, 'earnings');
  if (cached) {
    const { _cachedAt, ...data } = cached;
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const data = await fetchEarnings(ticker);
  setCache(cacheKey, data);
  console.log(JSON.stringify(data, null, 2));
}
