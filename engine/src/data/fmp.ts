// engine/src/data/fmp.ts
import { fetchWithRetry } from '../net';

const FMP_BASE = 'https://financialmodelingprep.com/api/v3';

export function parseFMPFinancials(ticker: string, profile: any[], ratios: any[]) {
  const p = profile?.[0];
  if (!p) return null;
  const r = ratios?.[0] || {};

  return {
    ticker: ticker.toUpperCase(),
    name: p.companyName || null,
    sector: p.sector || null,
    industry: p.industry || null,
    marketCap: p.mktCap || null,
    enterpriseValue: null,
    trailingPE: r.peRatioTTM || null,
    forwardPE: null,
    priceToBook: r.priceToBookRatioTTM || null,
    priceToSales: r.priceToSalesRatioTTM || null,
    evToEbitda: r.enterpriseValueOverEBITDATTM || null,
    evToRevenue: null,
    pegRatio: r.pegRatioTTM || null,
    grossMargin: r.grossProfitMarginTTM || null,
    operatingMargin: r.operatingProfitMarginTTM || null,
    profitMargin: r.netProfitMarginTTM || null,
    returnOnEquity: r.returnOnEquityTTM || null,
    returnOnAssets: r.returnOnAssetsTTM || null,
    revenueGrowth: null,
    earningsGrowth: null,
    totalCash: null,
    totalDebt: null,
    debtToEquity: r.debtEquityRatioTTM || null,
    currentRatio: r.currentRatioTTM || null,
    freeCashflow: null,
    operatingCashflow: null,
    revenuePerShare: r.revenuePerShareTTM || null,
    bookValue: r.bookValuePerShareTTM || null,
    dividendYield: r.dividendYieldTTM || null,
    payoutRatio: r.payoutRatioTTM || null,
    targetMeanPrice: null,
    recommendationMean: null,
    recommendationKey: null,
    numberOfAnalystOpinions: null,
    source: 'fmp',
  };
}

export async function fetchFMPFinancials(ticker: string, apiKey: string) {
  const [profileRes, ratiosRes] = await Promise.all([
    fetchWithRetry(`${FMP_BASE}/profile/${encodeURIComponent(ticker)}?apikey=${apiKey}`),
    fetchWithRetry(`${FMP_BASE}/ratios-ttm/${encodeURIComponent(ticker)}?apikey=${apiKey}`),
  ]);

  if (!profileRes.ok) throw new Error(`FMP profile ${profileRes.status}`);
  if (!ratiosRes.ok) throw new Error(`FMP ratios ${ratiosRes.status}`);

  const profile = await profileRes.json();
  const ratios = await ratiosRes.json();

  return parseFMPFinancials(ticker, profile, ratios);
}
