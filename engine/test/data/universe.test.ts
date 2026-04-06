// engine/test/data/universe.test.ts
import { describe, it, expect } from 'bun:test';
import { SP500, NASDAQ100, getUniverse, parseCustomUniverse } from '../../src/data/universe';
import { getPreset, listPresets } from '../../src/data/presets';

describe('universe', () => {
  it('SP500 has 400+ tickers', () => {
    expect(SP500.length).toBeGreaterThan(400);
  });

  it('NASDAQ100 has 90+ tickers', () => {
    expect(NASDAQ100.length).toBeGreaterThan(90);
  });

  it('all tickers are uppercase', () => {
    for (const t of SP500) expect(t).toBe(t.toUpperCase());
    for (const t of NASDAQ100) expect(t).toBe(t.toUpperCase());
  });

  it('getUniverse("all") deduplicates', () => {
    const all = getUniverse('all');
    const set = new Set(all);
    expect(all.length).toBe(set.size);
    expect(all.length).toBeGreaterThan(SP500.length);
  });

  it('getUniverse("sp500") returns SP500', () => {
    expect(getUniverse('sp500')).toBe(SP500);
  });

  it('parseCustomUniverse splits and uppercases', () => {
    expect(parseCustomUniverse('nvda,amd,intc')).toEqual(['NVDA', 'AMD', 'INTC']);
  });
});

describe('presets', () => {
  it('has growth, value, dividend presets', () => {
    expect(getPreset('growth')).toContain('revenueGrowth');
    expect(getPreset('value')).toContain('trailingPE');
    expect(getPreset('dividend')).toContain('dividendYield');
  });

  it('returns null for unknown preset', () => {
    expect(getPreset('nonexistent')).toBeNull();
  });

  it('listPresets returns all', () => {
    expect(listPresets()).toHaveLength(3);
  });
});
