import { getCached, getCachedWithFallback, setCache } from '../cache';
import { fetchMultiple, fetchSeries } from '../data/fred';
import { getKey } from '../data/keys';
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

    try {
      const data = await fetchSeries(seriesId, 10);
      setCache(cacheKey, data);
      console.log(JSON.stringify(data, null, 2));
      return;
    } catch (e: any) {
      const stale = getCachedWithFallback(cacheKey, 'macro');
      if (stale) {
        console.log(JSON.stringify({ ...stale.data, _stale: true, _cacheAge: stale.age }, null, 2));
        return;
      }
      throw new FinstackError(
        `Cannot fetch macro series ${seriesId}`,
        'fred',
        getKey('fred') ? e.message : 'FRED API key not configured',
        getKey('fred')
          ? 'Retry later, or use WebSearch for this indicator'
          : 'Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html then run: finstack keys set fred YOUR_KEY',
      );
    }
  }

  const cacheKey = 'macro-snapshot';
  const cached = getCached(cacheKey, 'macro');
  if (cached) {
    const { _cachedAt, ...data } = cached;
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // fetchMultiple uses allSettled, so it resolves even when every series fails
  const data = await fetchMultiple();
  if (data.length === 0) {
    const stale = getCachedWithFallback(cacheKey, 'macro');
    if (stale) {
      console.log(JSON.stringify({ ...stale.data, _stale: true, _cacheAge: stale.age }, null, 2));
      return;
    }
    throw new FinstackError(
      'Cannot fetch macro indicators',
      'fred',
      getKey('fred') ? 'All FRED series failed' : 'FRED API key not configured',
      getKey('fred')
        ? 'Retry later, or use WebSearch for macro data'
        : 'Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html then run: finstack keys set fred YOUR_KEY',
    );
  }

  const output = { timestamp: new Date().toISOString(), series: data };
  setCache(cacheKey, output);
  console.log(JSON.stringify(output, null, 2));
}
