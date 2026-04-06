import { fetchSeries, fetchMultiple, CORE_SERIES } from '../data/fred';
import { getCached, setCache } from '../cache';
import { FinstackError } from '../errors';

export async function macro(args: string[]) {
  const seriesId = args[0]?.toUpperCase();

  if (seriesId) {
    const cacheKey = `macro-${seriesId}`;
    const cached = getCached(cacheKey, 'macro');
    if (cached) {
      const { _cachedAt, ...data } = cached;
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const data = await fetchSeries(seriesId, 10);
    setCache(cacheKey, data);
    console.log(JSON.stringify(data, null, 2));
  } else {
    const cacheKey = 'macro-snapshot';
    const cached = getCached(cacheKey, 'macro');
    if (cached) {
      const { _cachedAt, ...data } = cached;
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    const data = await fetchMultiple();
    const output = { timestamp: new Date().toISOString(), series: data };
    setCache(cacheKey, output);
    console.log(JSON.stringify(output, null, 2));
  }
}
