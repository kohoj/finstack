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

  // Handle --upcoming flag
  if (args.includes('--upcoming')) {
    const cacheKey = `earnings-upcoming-${ticker}`;
    const cached = getCached(cacheKey, 'earnings');
    if (cached) {
      const { _cachedAt, _v, ...data } = cached;
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    try {
      // Try Yahoo calendarEvents module
      const { fetchQuoteSummary } = await import('../data/yahoo');
      const raw = await fetchQuoteSummary(ticker, ['calendarEvents', 'earnings']);
      const result = raw?.quoteSummary?.result?.[0];
      const calEvents = result?.calendarEvents;
      const earningsDate = calEvents?.earnings?.earningsDate;

      const upcoming = {
        ticker,
        earningsDate: earningsDate?.[0]?.fmt || null,
        earningsDateEnd: earningsDate?.[1]?.fmt || null,
        revenue: calEvents?.earnings?.revenueAverage?.raw || null,
        epsEstimate: calEvents?.earnings?.earningsAverage?.raw || null,
        source: 'yahoo',
      };
      setCache(cacheKey, upcoming);
      console.log(JSON.stringify(upcoming, null, 2));
    } catch (e: any) {
      const stale = getCachedWithFallback(cacheKey, 'earnings');
      if (stale) {
        console.log(JSON.stringify({ ...stale.data, _stale: true, _cacheAge: stale.age }, null, 2));
        return;
      }
      throw new FinstackError(
        `无法获取 ${ticker} 下次财报日期`,
        'yahoo',
        e.message,
        '稍后重试',
      );
    }
    return;
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
