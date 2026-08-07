import { getCached, setCache } from '../cache';
import { fetchFilings } from '../data/edgar';
import { validateTicker } from '../validation';

export async function filing(args: string[]) {
  const ticker = validateTicker(args[0]);

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
