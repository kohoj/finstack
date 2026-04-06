import { getUniverse, parseCustomUniverse } from '../data/universe';
import { getPreset } from '../data/presets';
import { getCached, setCache } from '../cache';
import { FinstackError } from '../errors';

interface ScreenFilter {
  field: string;
  op: '>' | '<' | '>=' | '<=' | '=' | '!=';
  value: number | string;
}

export function parseFilters(query: string): ScreenFilter[] {
  const filters: ScreenFilter[] = [];
  // Match patterns like: fieldName>value, fieldName<=value, sector=Technology
  const regex = /(\w+)(>=|<=|!=|>|<|=)(\S+)/g;
  let match;
  while ((match = regex.exec(query)) !== null) {
    const [, field, op, rawValue] = match;
    // Try to parse as number (including scientific notation)
    const numValue = Number(rawValue);
    filters.push({
      field,
      op: op as ScreenFilter['op'],
      value: isNaN(numValue) ? rawValue : numValue,
    });
  }
  return filters;
}

function matchesFilter(data: Record<string, any>, filter: ScreenFilter): boolean {
  const val = data[filter.field];
  if (val === null || val === undefined) return false;

  if (typeof filter.value === 'string') {
    // String comparison (case-insensitive for sector, industry etc.)
    const strVal = String(val).toLowerCase();
    const filterVal = filter.value.toLowerCase();
    switch (filter.op) {
      case '=': return strVal === filterVal;
      case '!=': return strVal !== filterVal;
      default: return false;
    }
  }

  // Numeric comparison
  const numVal = Number(val);
  if (isNaN(numVal)) return false;
  switch (filter.op) {
    case '>': return numVal > filter.value;
    case '<': return numVal < filter.value;
    case '>=': return numVal >= filter.value;
    case '<=': return numVal <= filter.value;
    case '=': return numVal === filter.value;
    case '!=': return numVal !== filter.value;
  }
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function fetchFinancialsForTicker(ticker: string): Promise<Record<string, any> | null> {
  // Check cache first
  const cacheKey = `financials-${ticker}`;
  const cached = getCached(cacheKey, 'financials');
  if (cached) {
    const { _cachedAt, _v, ...data } = cached;
    return data;
  }

  // Fetch from Yahoo
  try {
    const { fetchQuoteSummary, extractFinancials } = await import('../data/yahoo');
    const raw = await fetchQuoteSummary(ticker, ['financialData', 'defaultKeyStatistics', 'price', 'assetProfile']);
    const data = extractFinancials(raw);
    if (data) {
      setCache(cacheKey, data);
      return data;
    }
  } catch {}

  return null;
}

export async function screen(args: string[]) {
  // Parse arguments
  const presetName = parseFlag(args, '--preset');
  const universeArg = parseFlag(args, '--universe');
  const sortField = parseFlag(args, '--sort');
  const limitStr = parseFlag(args, '--limit');
  const limit = limitStr ? parseInt(limitStr) : 20;

  // Build query from preset + inline filters
  const inlineQuery = args.filter(a => !a.startsWith('--') && a !== presetName && a !== universeArg && a !== sortField && a !== limitStr).join(' ');
  let query = '';
  if (presetName) {
    const preset = getPreset(presetName);
    if (!preset) {
      throw new FinstackError(`Unknown preset: ${presetName}`, undefined, undefined, 'Available: growth, value, dividend');
    }
    query = preset;
  }
  if (inlineQuery) {
    query = query ? `${query} ${inlineQuery}` : inlineQuery;
  }

  if (!query) {
    console.error(JSON.stringify({ error: 'Usage: finstack screen "<filters>" [--preset <name>] [--universe <tickers>] [--sort <field>] [--limit <n>]' }));
    process.exit(1);
  }

  const filters = parseFilters(query);
  if (filters.length === 0) {
    throw new FinstackError('No valid filters parsed', undefined, undefined, 'Example: finstack screen "marketCap>10e9 grossMargin>0.3"');
  }

  // Determine universe
  let tickers: string[];
  if (universeArg) {
    tickers = parseCustomUniverse(universeArg);
  } else {
    tickers = getUniverse('all');
  }

  // Batch fetch financials with concurrency limit
  const results: Record<string, any>[] = [];
  const errors: string[] = [];
  const batchSize = 5;

  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const entries = await Promise.all(
      batch.map(async (ticker) => {
        try {
          return await fetchFinancialsForTicker(ticker);
        } catch {
          errors.push(ticker);
          return null;
        }
      })
    );

    for (const entry of entries) {
      if (!entry) continue;
      // Apply all filters
      if (filters.every(f => matchesFilter(entry, f))) {
        results.push(entry);
      }
    }
  }

  // Sort
  if (sortField) {
    results.sort((a, b) => {
      const va = a[sortField] ?? 0;
      const vb = b[sortField] ?? 0;
      return typeof va === 'number' && typeof vb === 'number' ? vb - va : 0;
    });
  } else {
    // Default sort by marketCap descending
    results.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
  }

  const limited = results.slice(0, limit);

  console.log(JSON.stringify({
    query,
    universe: universeArg || 'sp500+nasdaq100',
    scanned: tickers.length,
    matched: results.length,
    showing: limited.length,
    results: limited,
    errors: errors.length > 0 ? errors : undefined,
    note: 'Based on cached data. Some entries may be up to 1 hour old.',
  }, null, 2));
}
