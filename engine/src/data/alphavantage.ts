import { getKey } from './keys';

const BASE = 'https://www.alphavantage.co/query';

export interface EarningsQuarter {
  fiscalEnd: string;
  date: string;
  reportedEPS: number;
  estimatedEPS: number;
  surprise: number;
  surprisePct: number;
}

export interface EarningsResult {
  ticker: string;
  quarterly: EarningsQuarter[];
}

export function parseEarnings(ticker: string, data: any): EarningsResult {
  const quarters = (data?.quarterlyEarnings || []).slice(0, 8);
  return {
    ticker: ticker.toUpperCase(),
    quarterly: quarters.map((q: any) => ({
      fiscalEnd: q.fiscalDateEnding,
      date: q.reportedDate,
      reportedEPS: parseFloat(q.reportedEPS) || 0,
      estimatedEPS: parseFloat(q.estimatedEPS) || 0,
      surprise: parseFloat(q.surprise) || 0,
      surprisePct: parseFloat(q.surprisePercentage) || 0,
    })),
  };
}

export async function fetchEarnings(ticker: string): Promise<EarningsResult> {
  const apiKey = getKey('alphavantage');
  if (!apiKey) throw new Error('Alpha Vantage API key not configured. Run: finstack keys set alphavantage <your-key>');

  const url = `${BASE}?function=EARNINGS&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Alpha Vantage ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();

  if (data['Error Message']) throw new Error(`Alpha Vantage: ${data['Error Message']}`);
  if (data['Note']) throw new Error('Alpha Vantage rate limit hit. Wait 1 minute.');

  return parseEarnings(ticker, data);
}
