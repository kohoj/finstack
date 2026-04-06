import { fetchWithRetry } from '../net';

const BASE = 'https://query1.finance.yahoo.com';

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/119.0.0.0',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

let _crumb: string | null = null;
let _cookie: string | null = null;
let _crumbExpiry = 0;
const CRUMB_TTL = 30 * 60 * 1000;

function clearCrumb(): void {
  _crumb = null;
  _cookie = null;
  _crumbExpiry = 0;
}

async function getCrumb(): Promise<{ crumb: string; cookie: string }> {
  if (_crumb && _cookie && Date.now() < _crumbExpiry) {
    return { crumb: _crumb, cookie: _cookie };
  }
  clearCrumb();
  const ua = randomUA();
  const consentRes = await fetchWithRetry('https://fc.yahoo.com', {
    headers: { 'User-Agent': ua },
    redirect: 'manual',
  }, { retries: 1, backoffMs: [500], timeoutMs: 8000 });
  const setCookies = consentRes.headers.getSetCookie?.() || [];
  const cookies = setCookies.map(c => c.split(';')[0]).join('; ');
  const crumbRes = await fetchWithRetry(`${BASE}/v1/test/getcrumb`, {
    headers: { 'User-Agent': ua, 'Cookie': cookies },
  }, { retries: 1, backoffMs: [500], timeoutMs: 8000 });
  if (!crumbRes.ok) throw new Error(`Failed to get Yahoo crumb: ${crumbRes.status}`);
  const crumb = await crumbRes.text();
  _crumb = crumb;
  _cookie = cookies;
  _crumbExpiry = Date.now() + CRUMB_TTL;
  return { crumb, cookie: cookies };
}

async function yf(path: string, needsCrumb = false): Promise<any> {
  const ua = randomUA();
  let headers: Record<string, string> = { 'User-Agent': ua };
  let url = `${BASE}${path}`;
  if (needsCrumb) {
    try {
      const { crumb, cookie } = await getCrumb();
      url += (url.includes('?') ? '&' : '?') + `crumb=${encodeURIComponent(crumb)}`;
      headers['Cookie'] = cookie;
    } catch {
      clearCrumb();
      const { crumb, cookie } = await getCrumb();
      url = `${BASE}${path}`;
      url += (url.includes('?') ? '&' : '?') + `crumb=${encodeURIComponent(crumb)}`;
      headers['Cookie'] = cookie;
    }
  }
  const res = await fetchWithRetry(url, { headers }, {
    retries: 2, backoffMs: [1000, 3000], timeoutMs: 10_000,
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) clearCrumb();
    const text = await res.text().catch(() => '');
    throw new Error(`Yahoo Finance ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function fetchChart(ticker: string, range = '1mo', interval = '1d') {
  return yf(`/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`);
}

export async function fetchQuoteSummary(ticker: string, modules: string[]) {
  return yf(`/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules.join(',')}`, true);
}

export async function fetchTrending(region = 'US', count = 20) {
  return yf(`/v1/finance/trending/${region}?count=${count}`);
}

export async function fetchSearch(query: string) {
  return yf(`/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=10&quotesCount=5`);
}

export function extractQuote(chartData: any) {
  const result = chartData?.chart?.result?.[0];
  if (!result) return null;

  const meta = result.meta;
  const quotes = result.indicators?.quote?.[0];
  const timestamps = result.timestamp || [];
  const lastIdx = Math.max(0, timestamps.length - 1);

  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose;
  const change = price - prevClose;
  const changePct = prevClose ? (change / prevClose) * 100 : 0;

  return {
    ticker: meta.symbol,
    price: +price.toFixed(2),
    change: +change.toFixed(2),
    changePct: +changePct.toFixed(2),
    currency: meta.currency,
    exchange: meta.exchangeName,
    volume: quotes?.volume?.[lastIdx],
    high: quotes?.high?.[lastIdx] ? +quotes.high[lastIdx].toFixed(2) : null,
    low: quotes?.low?.[lastIdx] ? +quotes.low[lastIdx].toFixed(2) : null,
    open: quotes?.open?.[lastIdx] ? +quotes.open[lastIdx].toFixed(2) : null,
    previousClose: prevClose,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
    marketState: meta.marketState,
    timestamp: new Date((meta.regularMarketTime ?? 0) * 1000).toISOString(),
  };
}

export function extractFinancials(summaryData: any) {
  const r = summaryData?.quoteSummary?.result?.[0];
  if (!r) return null;

  const fd = r.financialData || {};
  const ks = r.defaultKeyStatistics || {};
  const price = r.price || {};

  const raw = (obj: any) => {
    if (obj === null || obj === undefined) return null;
    if (typeof obj === 'object' && 'raw' in obj) return obj.raw;
    if (typeof obj === 'object') return null;
    return obj;
  };

  return {
    ticker: price.symbol,
    name: price.shortName || price.longName,
    sector: r.assetProfile?.sector,
    industry: r.assetProfile?.industry,
    marketCap: raw(price.marketCap),
    enterpriseValue: raw(ks.enterpriseValue),
    // Valuation
    trailingPE: raw(ks.trailingPE),
    forwardPE: raw(ks.forwardPE),
    priceToBook: raw(ks.priceToBook),
    priceToSales: raw(price.priceToSalesTrailing12Months),
    evToEbitda: raw(ks.enterpriseToEbitda),
    evToRevenue: raw(ks.enterpriseToRevenue),
    pegRatio: raw(ks.pegRatio),
    // Profitability
    grossMargin: raw(fd.grossMargins),
    operatingMargin: raw(fd.operatingMargins),
    profitMargin: raw(fd.profitMargins),
    returnOnEquity: raw(fd.returnOnEquity),
    returnOnAssets: raw(fd.returnOnAssets),
    // Growth
    revenueGrowth: raw(fd.revenueGrowth),
    earningsGrowth: raw(fd.earningsGrowth),
    // Balance sheet
    totalCash: raw(fd.totalCash),
    totalDebt: raw(fd.totalDebt),
    debtToEquity: raw(fd.debtToEquity),
    currentRatio: raw(fd.currentRatio),
    // Cash flow
    freeCashflow: raw(fd.freeCashflow),
    operatingCashflow: raw(fd.operatingCashflow),
    // Per share
    revenuePerShare: raw(fd.revenuePerShare),
    bookValue: raw(ks.bookValue),
    // Dividends
    dividendYield: raw(ks.dividendYield),
    payoutRatio: raw(ks.payoutRatio),
    // Analyst
    targetMeanPrice: raw(fd.targetMeanPrice),
    recommendationMean: raw(fd.recommendationMean),
    recommendationKey: fd.recommendationKey,
    numberOfAnalystOpinions: raw(fd.numberOfAnalystOpinions),
  };
}
