import { fetchQuoteSummary, extractFinancials } from '../data/yahoo';
import { getCached, setCache } from '../cache';

const MODULES = [
  'financialData',
  'defaultKeyStatistics',
  'price',
  'assetProfile',
];

export async function financials(args: string[]) {
  const ticker = args[0]?.toUpperCase();
  if (!ticker) {
    console.error(JSON.stringify({ error: 'Usage: finstack financials <ticker>' }));
    process.exit(1);
  }

  const cacheKey = `financials-${ticker}`;
  const cached = getCached(cacheKey, 'financials');
  if (cached) {
    const { _cachedAt, ...data } = cached;
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const raw = await fetchQuoteSummary(ticker, MODULES);
  const data = extractFinancials(raw);
  if (!data) throw new Error(`No financial data found for ${ticker}`);

  setCache(cacheKey, data);
  console.log(JSON.stringify(data, null, 2));
}
