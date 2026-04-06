import { fetchTrending, fetchSearch } from '../data/yahoo';
import { getCached, setCache } from '../cache';
import { FinstackError } from '../errors';

export async function scan(args: string[]) {
  const source = args.includes('--source') ? args[args.indexOf('--source') + 1] : 'all';
  const region = args.includes('--region') ? args[args.indexOf('--region') + 1] : 'US';

  const cacheKey = `scan-${source}-${region}`;
  const cached = getCached(cacheKey, 'scan');
  if (cached) {
    const { _cachedAt, ...data } = cached;
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const output: any = { timestamp: new Date().toISOString(), region, signals: [] };

  if (source === 'all' || source === 'trending') {
    try {
      const trending = await fetchTrending(region);
      const tickers = trending?.finance?.result?.[0]?.quotes || [];
      output.signals.push({
        type: 'trending',
        items: tickers.slice(0, 10).map((q: any) => q.symbol),
      });
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
        // Non-critical, skip
      }
    }
  }

  setCache(cacheKey, output);
  console.log(JSON.stringify(output, null, 2));
}
