import { fetchWithRetry } from '../net';

const SUBMISSIONS_BASE = 'https://data.sec.gov/submissions/CIK';
const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const ARCHIVES_BASE = 'https://www.sec.gov/Archives/edgar/data';
const UA = 'finstack/0.2.0 (github.com/user/finstack)';
const FORM_FILTER = new Set(['10-K', '10-Q', '8-K']);

export interface Filing {
  type: string;
  date: string;
  url: string;
  description: string;
}

export interface FilingResult {
  ticker: string;
  cik: string;
  company: string;
  filings: Filing[];
}

let _tickerMap: Record<string, string> | null = null;

export function padCIK(cik: string): string {
  return cik.padStart(10, '0');
}

export function parseFilings(ticker: string, data: any): FilingResult {
  const recent = data.filings?.recent;
  if (!recent) return { ticker, cik: data.cik, company: data.name, filings: [] };

  const filings: Filing[] = [];
  const count = recent.accessionNumber?.length || 0;

  for (let i = 0; i < count; i++) {
    const form = recent.form[i];
    if (!FORM_FILTER.has(form)) continue;

    const accession = recent.accessionNumber[i].replace(/-/g, '');
    filings.push({
      type: form,
      date: recent.filingDate[i],
      url: `${ARCHIVES_BASE}/${data.cik}/${accession}/${recent.primaryDocument[i]}`,
      description: recent.primaryDocDescription[i] || form,
    });
  }

  return {
    ticker: ticker.toUpperCase(),
    cik: String(data.cik),
    company: data.name || '',
    filings: filings.slice(0, 20),
  };
}

async function resolveCIK(ticker: string): Promise<string> {
  if (!_tickerMap) {
    const res = await fetchWithRetry(TICKERS_URL, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`SEC ticker lookup failed: ${res.status}`);
    const data = await res.json();
    _tickerMap = {};
    for (const entry of Object.values(data) as any[]) {
      _tickerMap[entry.ticker.toUpperCase()] = String(entry.cik_str);
    }
  }
  const cik = _tickerMap[ticker.toUpperCase()];
  if (!cik) throw new Error(`Ticker ${ticker} not found in SEC database`);
  return cik;
}

export async function fetchFilings(ticker: string): Promise<FilingResult> {
  const cik = await resolveCIK(ticker);
  const url = `${SUBMISSIONS_BASE}${padCIK(cik)}.json`;
  const res = await fetchWithRetry(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`SEC EDGAR ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return parseFilings(ticker, data);
}
