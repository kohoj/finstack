import { describe, it, expect } from 'bun:test';
import { FinstackError, formatErrorJSON } from '../src/errors';

describe('FinstackError', () => {
  it('extends Error with actionable fields', () => {
    const err = new FinstackError(
      'Cannot fetch NVDA quote',
      'yahoo',
      'HTTP 403',
      'Retry later, or configure Polygon: finstack keys set polygon YOUR_KEY',
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Cannot fetch NVDA quote');
    expect(err.source).toBe('yahoo');
    expect(err.reason).toBe('HTTP 403');
    expect(err.suggestion).toBe('Retry later, or configure Polygon: finstack keys set polygon YOUR_KEY');
    expect(err.cached).toBeUndefined();
  });

  it('supports cached data attachment', () => {
    const err = new FinstackError('Cannot fetch quote', 'yahoo');
    err.cached = { data: { price: 850 }, age: '47m ago' };
    expect(err.cached.data).toEqual({ price: 850 });
    expect(err.cached.age).toBe('47m ago');
  });
});

describe('formatErrorJSON', () => {
  it('formats FinstackError to structured JSON', () => {
    const err = new FinstackError('Cannot fetch quote', 'yahoo', 'HTTP 403', 'Configure API key');
    const json = formatErrorJSON(err);
    const parsed = JSON.parse(json);
    expect(parsed.error).toBe('Cannot fetch quote');
    expect(parsed.source).toBe('yahoo');
    expect(parsed.reason).toBe('HTTP 403');
    expect(parsed.suggestion).toBe('Configure API key');
  });

  it('formats regular Error to basic JSON', () => {
    const err = new Error('something broke');
    const json = formatErrorJSON(err);
    const parsed = JSON.parse(json);
    expect(parsed.error).toBe('something broke');
    expect(parsed.source).toBeUndefined();
  });
});
