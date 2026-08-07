import { getCached, getCachedWithFallback, setCache } from '../cache';
import { fetchSearch, fetchTrending } from '../data/yahoo';
import { FinstackError } from '../errors';

export async function scan(args: string[]) {
  const source = args.includes('--source') ? args[args.indexOf('--source') + 1] : 'all';
  const region = args.includes('--region') ? args[args.indexOf('--region') + 1] : 'US';

  if (!['all', 'trending', 'news'].includes(source)) {
    throw new FinstackError(
      `Unknown scan source: ${source}`,
      undefined,
      'Valid sources are: trending, news, all',
      'Example: finstack scan --source all',
    );
  }

  const cacheKey = `scan-${source}-${region}`;
  const cached = getCached(cacheKey, 'scan');
  if (cached) {
    const { _cachedAt, ...data } = cached;
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const output: any = { timestamp: new Date().toISOString(), region, signals: [] };
  let anySucceeded = false;

  if (source === 'all' || source === 'trending') {
    try {
      const trending = await fetchTrending(region);
      const tickers = trending?.finance?.result?.[0]?.quotes || [];
      output.signals.push({
        type: 'trending',
        items: tickers.slice(0, 10).map((q: any) => q.symbol),
      });
      anySucceeded = true;
    } catch (e: any) {
      output.signals.push({ type: 'trending', error: e.message });
    }
  }

  if (source === 'all' || source === 'news') {
    const queries = ['market today', 'earnings', 'fed'];
    for (const q of queries) {
      try {
        const search = await fetchSearch(q);
        const news = search?.news || [];
        anySucceeded = true;
        if (news.length > 0) {
          output.signals.push({
            type: 'news',
            query: q,
            items: news.slice(0, 3).map((n: any) => ({
              title: n.title,
              publisher: n.publisher,
              link: n.link,
              published: n.providerPublishTime
                ? new Date(n.providerPublishTime * 1000).toISOString()
                : null,
            })),
          });
        }
      } catch {
        // Non-critical, skip — a single failed query should not fail the scan
      }
    }
  }

  // Every source failed. Do not cache or report an empty scan as success:
  // /sense must be able to tell "quiet market" from "scan is broken".
  if (!anySucceeded) {
    const stale = getCachedWithFallback(cacheKey, 'scan');
    if (stale) {
      console.log(JSON.stringify({ ...stale.data, _stale: true, _cacheAge: stale.age }, null, 2));
      return;
    }
    throw new FinstackError(
      'Scan failed — no data source responded',
      'yahoo',
      'Trending and news endpoints both unavailable',
      'Retry later, or use WebSearch for market signals',
    );
  }

  setCache(cacheKey, output);
  console.log(JSON.stringify(output, null, 2));
}
