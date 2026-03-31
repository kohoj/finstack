const BASE = 'https://query1.finance.yahoo.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

let _crumb: string | null = null;
let _cookie: string | null = null;

async function getCrumb(): Promise<{ crumb: string; cookie: string }> {
  if (_crumb && _cookie) return { crumb: _crumb, cookie: _cookie };

  // Step 1: Get consent cookie
  const consentRes = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  });
  const setCookies = consentRes.headers.getSetCookie?.() || [];
  const cookies = setCookies.map(c => c.split(';')[0]).join('; ');

  // Step 2: Get crumb
  const crumbRes = await fetch(`${BASE}/v1/test/getcrumb`, {
    headers: { 'User-Agent': UA, 'Cookie': cookies },
  });
  if (!crumbRes.ok) throw new Error(`Failed to get Yahoo crumb: ${crumbRes.status}`);
  const crumb = await crumbRes.text();

  _crumb = crumb;
  _cookie = cookies;
  return { crumb, cookie: cookies };
}

async function yf(path: string, needsCrumb = false): Promise<any> {
  let headers: Record<string, string> = { 'User-Agent': UA };
  let url = `${BASE}${path}`;

  if (needsCrumb) {
    const { crumb, cookie } = await getCrumb();
    url += (url.includes('?') ? '&' : '?') + `crumb=${encodeURIComponent(crumb)}`;
    headers['Cookie'] = cookie;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
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
