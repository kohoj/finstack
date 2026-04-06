import { describe, it, expect } from 'bun:test';
import { parseFilters } from '../../src/commands/screen';

describe('parseFilters', () => {
  it('parses simple numeric filter', () => {
    const filters = parseFilters('marketCap>50e9');
    expect(filters).toHaveLength(1);
    expect(filters[0].field).toBe('marketCap');
    expect(filters[0].op).toBe('>');
    expect(filters[0].value).toBe(50e9);
  });

  it('parses multiple filters', () => {
    const filters = parseFilters('marketCap<50e9 grossMargin>0.4');
    expect(filters).toHaveLength(2);
    expect(filters[0].field).toBe('marketCap');
    expect(filters[1].field).toBe('grossMargin');
  });

  it('parses string equality filter', () => {
    const filters = parseFilters('sector=Technology');
    expect(filters).toHaveLength(1);
    expect(filters[0].value).toBe('Technology');
  });

  it('parses >= and <= operators', () => {
    const filters = parseFilters('trailingPE>=10 trailingPE<=30');
    expect(filters).toHaveLength(2);
    expect(filters[0].op).toBe('>=');
    expect(filters[1].op).toBe('<=');
  });

  it('parses != operator', () => {
    const filters = parseFilters('sector!=Energy');
    expect(filters).toHaveLength(1);
    expect(filters[0].op).toBe('!=');
  });

  it('handles scientific notation', () => {
    const filters = parseFilters('marketCap>2.5e10');
    expect(filters[0].value).toBe(2.5e10);
  });

  it('returns empty for invalid input', () => {
    expect(parseFilters('')).toEqual([]);
    expect(parseFilters('just words')).toEqual([]);
  });
});

describe('matchesFilter (via parseFilters integration)', () => {
  // We test the exported parseFilters; matchesFilter is internal
  // but we can verify behavior through the screen command's filter logic

  it('preset + inline query merges correctly', () => {
    // This tests the query building logic
    const preset = 'revenueGrowth>0.15 grossMargin>0.4 marketCap>5e9';
    const inline = 'sector=Technology';
    const combined = `${preset} ${inline}`;
    const filters = parseFilters(combined);
    expect(filters).toHaveLength(4);
    expect(filters[3].field).toBe('sector');
  });
});
