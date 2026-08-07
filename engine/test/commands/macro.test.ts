import { describe, expect, it } from 'bun:test';
import { parseFredResponse } from '../../src/data/fred';

describe('macro command logic', () => {
  it('formats multiple series into snapshot', () => {
    const mockData = {
      observations: [
        { date: '2026-03-28', value: '5.25' },
        { date: '2026-03-29', value: '5.50' },
      ],
    };
    const result = parseFredResponse('DFF', mockData);
    expect(result.label).toBe('Federal Funds Rate');
    expect(result.value).toBe(5.5);
    expect(result.change).toBe(0.25);
  });
});
