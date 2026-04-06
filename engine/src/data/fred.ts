import { getKey } from './keys';
import { fetchWithRetry } from '../net';

const BASE = 'https://api.stlouisfed.org/fred/series/observations';

export const CORE_SERIES = ['DFF', 'CPIAUCSL', 'GDP', 'UNRATE', 'T10Y2Y', 'VIXCLS'] as const;

const SERIES_LABELS: Record<string, string> = {
  DFF: 'Federal Funds Rate',
  CPIAUCSL: 'CPI (Inflation)',
  GDP: 'GDP',
  UNRATE: 'Unemployment Rate',
  T10Y2Y: '10Y-2Y Yield Spread',
  VIXCLS: 'VIX (Volatility)',
};

export interface FredObservation {
  series: string;
  label: string;
  value: number | null;
  date: string;
  previousValue: number | null;
  change: number | null;
}

export function parseFredResponse(seriesId: string, data: any): FredObservation {
  const obs = data?.observations || [];
  const latest = obs[obs.length - 1];
  const prev = obs.length > 1 ? obs[obs.length - 2] : null;

  const val = latest?.value === '.' ? null : latest ? parseFloat(latest.value) : null;
  const prevVal = prev?.value === '.' ? null : prev ? parseFloat(prev.value) : null;

  return {
    series: seriesId,
    label: SERIES_LABELS[seriesId] || seriesId,
    value: val,
    date: latest?.date || '',
    previousValue: prevVal,
    change: val !== null && prevVal !== null ? +(val - prevVal).toFixed(4) : null,
  };
}

export async function fetchSeries(seriesId: string, limit = 2): Promise<FredObservation> {
  const apiKey = getKey('fred');
  if (!apiKey) throw new Error('FRED API key not configured. Run: finstack keys set fred <your-key>');

  const url = `${BASE}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`FRED API ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();

  if (data.observations) data.observations.reverse();
  return parseFredResponse(seriesId, data);
}

export async function fetchMultiple(seriesIds: string[] = [...CORE_SERIES]): Promise<FredObservation[]> {
  const results = await Promise.allSettled(seriesIds.map(id => fetchSeries(id)));
  return results
    .filter((r): r is PromiseFulfilledResult<FredObservation> => r.status === 'fulfilled')
    .map(r => r.value);
}
