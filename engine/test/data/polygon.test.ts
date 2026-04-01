import { describe, it, expect } from 'bun:test';
import { parseBars } from '../../src/data/polygon';

describe('polygon', () => {
  it('parseBars extracts OHLCV data', () => {
    const raw = {
      ticker: 'AAPL',
      resultsCount: 2,
      results: [
        { t: 1711670400000, o: 171.0, h: 173.5, l: 170.2, c: 172.8, v: 52000000 },
        { t: 1711756800000, o: 172.8, h: 175.0, l: 172.0, c: 174.5, v: 48000000 },
      ],
    };
    const result = parseBars('AAPL', raw);
    expect(result.ticker).toBe('AAPL');
    expect(result.bars.length).toBe(2);
    expect(result.bars[0].open).toBe(171.0);
    expect(result.bars[0].close).toBe(172.8);
    expect(result.bars[0].volume).toBe(52000000);
    expect(result.bars[0].date).toBeDefined();
  });

  it('parseBars handles empty results', () => {
    const raw = { ticker: 'AAPL', resultsCount: 0, results: [] };
    const result = parseBars('AAPL', raw);
    expect(result.bars.length).toBe(0);
  });
});
