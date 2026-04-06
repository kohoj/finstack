// engine/src/data/presets.ts

export const PRESETS: Record<string, string> = {
  growth:   'revenueGrowth>0.15 grossMargin>0.4 marketCap>5e9',
  value:    'trailingPE<20 priceToBook<3 dividendYield>0.01 marketCap>2e9',
  dividend: 'dividendYield>0.03 payoutRatio<0.7 debtToEquity<1.5 marketCap>5e9',
};

export function getPreset(name: string): string | null {
  return PRESETS[name.toLowerCase()] || null;
}

export function listPresets(): { name: string; query: string }[] {
  return Object.entries(PRESETS).map(([name, query]) => ({ name, query }));
}
