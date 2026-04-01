import { describe, it, expect } from 'bun:test';
import { CORE_SERIES, parseFredResponse } from '../../src/data/fred';

describe('fred', () => {
  it('exports correct core series IDs', () => {
    expect(CORE_SERIES).toContain('DFF');
    expect(CORE_SERIES).toContain('CPIAUCSL');
    expect(CORE_SERIES).toContain('GDP');
    expect(CORE_SERIES).toContain('UNRATE');
    expect(CORE_SERIES).toContain('T10Y2Y');
    expect(CORE_SERIES).toContain('VIXCLS');
    expect(CORE_SERIES.length).toBe(6);
  });

  it('parseFredResponse extracts latest observation', () => {
    const raw = {
      observations: [
        { date: '2026-03-28', value: '4.33' },
        { date: '2026-03-29', value: '4.35' },
      ],
    };
    const result = parseFredResponse('DFF', raw);
    expect(result.series).toBe('DFF');
    expect(result.value).toBe(4.35);
    expect(result.date).toBe('2026-03-29');
    expect(result.previousValue).toBe(4.33);
    expect(result.change).toBeCloseTo(0.02);
  });

  it('parseFredResponse handles single observation', () => {
    const raw = { observations: [{ date: '2026-03-29', value: '4.35' }] };
    const result = parseFredResponse('DFF', raw);
    expect(result.value).toBe(4.35);
    expect(result.previousValue).toBeNull();
    expect(result.change).toBeNull();
  });

  it('parseFredResponse handles "." (missing data)', () => {
    const raw = { observations: [{ date: '2026-03-29', value: '.' }] };
    const result = parseFredResponse('DFF', raw);
    expect(result.value).toBeNull();
  });
});
