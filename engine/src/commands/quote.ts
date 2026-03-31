import { fetchChart, extractQuote } from '../data/yahoo';
import { getCached, setCache } from '../cache';

export async function quote(args: string[]) {
  const ticker = args[0]?.toUpperCase();
  if (!ticker) {
    console.error(JSON.stringify({ error: 'Usage: finstack quote <ticker>' }));
    process.exit(1);
  }

  const cacheKey = `quote-${ticker}`;
  const cached = getCached(cacheKey, 'quote');
  if (cached) {
    const { _cachedAt, ...data } = cached;
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const raw = await fetchChart(ticker, '5d', '1d');
  const data = extractQuote(raw);
  if (!data) throw new Error(`No data found for ${ticker}`);

  setCache(cacheKey, data);
  console.log(JSON.stringify(data, null, 2));
}
