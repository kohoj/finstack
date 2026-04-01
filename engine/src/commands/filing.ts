import { fetchFilings } from '../data/edgar';
import { getCached, setCache } from '../cache';

export async function filing(args: string[]) {
  const ticker = args[0]?.toUpperCase();
  if (!ticker) {
    console.error(JSON.stringify({ error: 'Usage: finstack filing <ticker>' }));
    process.exit(1);
  }

  const cacheKey = `filing-${ticker}`;
  const cached = getCached(cacheKey, 'filing');
  if (cached) {
    const { _cachedAt, ...data } = cached;
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const data = await fetchFilings(ticker);
  setCache(cacheKey, data);
  console.log(JSON.stringify(data, null, 2));
}
