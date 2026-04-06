import { getKey } from './keys';
import { fetchWithRetry } from '../net';

const BASE = 'https://api.polygon.io';

export interface Bar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BarsResult {
  ticker: string;
  bars: Bar[];
}

export function parseBars(ticker: string, data: any): BarsResult {
  const results = data?.results || [];
  return {
    ticker: ticker.toUpperCase(),
    bars: results.map((r: any) => ({
      date: new Date(r.t).toISOString().split('T')[0],
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: r.v,
    })),
  };
}

export async function fetchBars(
  ticker: string,
  from: string,
  to: string,
  timespan: 'day' | 'week' = 'day',
  multiplier = 1,
): Promise<BarsResult> {
  const apiKey = getKey('polygon');
  if (!apiKey) throw new Error('Polygon API key not configured. Run: finstack keys set polygon <your-key>');

  const url = `${BASE}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/${multiplier}/${timespan}/${from}/${to}?adjusted=true&sort=asc&apiKey=${apiKey}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`Polygon ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();

  if (data.status === 'ERROR') throw new Error(`Polygon: ${data.error}`);
  return parseBars(ticker, data);
}
