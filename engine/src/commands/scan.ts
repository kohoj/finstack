import { getCached, getCachedWithFallback, setCache } from '../cache';
import { fetchSearch, fetchTrending } from '../data/yahoo';
import { FinstackError } from '../errors';

const MAX_NEWS_AGE_MS = 7 * 86_400_000;

type NewsItem = {
  title?: unknown;
  publisher?: unknown;
  link?: unknown;
  providerPublishTime?: unknown;
};

function isRelevantHeadline(query: string, title: string): boolean {
  switch (query) {
    case 'earnings':
      return /\b(earnings?|results?|guidance)\b/i.test(title);
    case 'fed':
      // A substring search turns FedEx into a macro signal. Require a real
      // monetary-policy phrase or a standalone “Fed”.
      return /\b(federal reserve|fomc|the fed|fed chairman|fed officials?|interest rates?)\b/i.test(
        title,
      );
    case 'market today':
      return /\b(market|stocks?|equities|indices|s&p|nasdaq|dow|treasur(?:y|ies))\b/i.test(title);
    default:
      return false;
  }
}

/**
 * Keep the scanner's contract honest: “no signal” means timely, relevant
 * source items were not found, never that an unfiltered keyword search was
 * quietly promoted to an investment input.
 */
export function selectTimelyRelevantNews(query: string, rawItems: NewsItem[], now = Date.now()) {
  return rawItems
    .flatMap(item => {
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      const publishedSeconds =
        typeof item.providerPublishTime === 'number' ? item.providerPublishTime : null;
      const publishedAt = publishedSeconds === null ? null : new Date(publishedSeconds * 1000);
      if (
        !title ||
        !publishedAt ||
        Number.isNaN(publishedAt.getTime()) ||
        now - publishedAt.getTime() > MAX_NEWS_AGE_MS ||
        now < publishedAt.getTime() ||
        !isRelevantHeadline(query, title)
      ) {
        return [];
      }
      return [
        {
          title,
          publisher: typeof item.publisher === 'string' ? item.publisher : 'Unknown publisher',
          link: typeof item.link === 'string' ? item.link : null,
          published: publishedAt.toISOString(),
        },
      ];
    })
    .slice(0, 3);
}

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
        const news = selectTimelyRelevantNews(q, search?.news || []);
        anySucceeded = true;
        output.signals.push({
          type: 'news',
          query: q,
          items: news,
          ...(news.length
            ? {}
            : { note: 'No timely, query-relevant articles returned by this source.' }),
        });
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
