// engine/src/commands/calendar.ts
import { PORTFOLIO_FILE, WATCHLIST_FILE } from '../paths';
import { readJSONSafe } from '../fs';
import { getCached, setCache } from '../cache';
import { FinstackError } from '../errors';

interface CalendarEntry {
  ticker: string;
  earningsDate: string | null;
  earningsDateEnd: string | null;
  epsEstimate: number | null;
  source: string;
  inPortfolio: boolean;
  inWatchlist: boolean;
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function fetchUpcomingEarnings(ticker: string): Promise<CalendarEntry | null> {
  const cacheKey = `earnings-upcoming-${ticker}`;
  const cached = getCached(cacheKey, 'earnings');
  if (cached) {
    const { _cachedAt, _v, ...data } = cached;
    return data as CalendarEntry;
  }

  try {
    const { fetchQuoteSummary } = await import('../data/yahoo');
    const raw = await fetchQuoteSummary(ticker, ['calendarEvents', 'earnings']);
    const result = raw?.quoteSummary?.result?.[0];
    const calEvents = result?.calendarEvents;
    const earningsDate = calEvents?.earnings?.earningsDate;

    const entry: CalendarEntry = {
      ticker,
      earningsDate: earningsDate?.[0]?.fmt || null,
      earningsDateEnd: earningsDate?.[1]?.fmt || null,
      epsEstimate: calEvents?.earnings?.earningsAverage?.raw || null,
      source: 'yahoo',
      inPortfolio: false,
      inWatchlist: false,
    };
    setCache(cacheKey, entry);
    return entry;
  } catch {
    return null;
  }
}

export async function calendar(args: string[]) {
  const rangeStr = parseFlag(args, '--range');
  const range = rangeStr ? parseInt(rangeStr) : 30;

  // Collect tickers from portfolio + watchlist
  const portfolio = readJSONSafe<{ positions: { ticker: string }[] }>(PORTFOLIO_FILE, { positions: [] });
  const watchlist = readJSONSafe<{ ticker: string }[]>(WATCHLIST_FILE, []);

  const portfolioTickers = new Set(portfolio.positions.map(p => p.ticker));
  const watchlistTickers = new Set(watchlist.map(w => w.ticker));
  const allTickers = [...new Set([...portfolioTickers, ...watchlistTickers])];

  if (allTickers.length === 0) {
    console.log(JSON.stringify({
      message: 'No tickers to check. Add positions or watchlist entries first.',
      calendar: [],
      count: 0,
    }, null, 2));
    return;
  }

  // Fetch earnings dates (limited concurrency)
  const results: CalendarEntry[] = [];
  const batchSize = 5;
  for (let i = 0; i < allTickers.length; i += batchSize) {
    const batch = allTickers.slice(i, i + batchSize);
    const entries = await Promise.all(batch.map(fetchUpcomingEarnings));
    for (const entry of entries) {
      if (entry && entry.earningsDate) {
        entry.inPortfolio = portfolioTickers.has(entry.ticker);
        entry.inWatchlist = watchlistTickers.has(entry.ticker);
        results.push(entry);
      }
    }
  }

  // Filter by range (days from now)
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const cutoff = new Date(now.getTime() + range * 86400000);

  const filtered = results.filter(e => {
    if (!e.earningsDate) return false;
    const d = new Date(e.earningsDate);
    return d >= now && d <= cutoff;
  }).sort((a, b) => {
    return new Date(a.earningsDate!).getTime() - new Date(b.earningsDate!).getTime();
  });

  console.log(JSON.stringify({
    range: `${range} days`,
    calendar: filtered,
    count: filtered.length,
  }, null, 2));
}
