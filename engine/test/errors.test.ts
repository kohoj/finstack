import { describe, it, expect } from 'bun:test';
import { FinstackError, formatErrorJSON } from '../src/errors';

describe('FinstackError', () => {
  it('extends Error with actionable fields', () => {
    const err = new FinstackError(
      '无法获取 NVDA 报价',
      'yahoo',
      'HTTP 403',
      '稍后重试，或配置 Polygon: finstack keys set polygon YOUR_KEY',
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('无法获取 NVDA 报价');
    expect(err.source).toBe('yahoo');
    expect(err.reason).toBe('HTTP 403');
    expect(err.suggestion).toBe('稍后重试，或配置 Polygon: finstack keys set polygon YOUR_KEY');
    expect(err.cached).toBeUndefined();
  });

  it('supports cached data attachment', () => {
    const err = new FinstackError('无法获取报价', 'yahoo');
    err.cached = { data: { price: 850 }, age: '47 分钟前' };
    expect(err.cached.data).toEqual({ price: 850 });
    expect(err.cached.age).toBe('47 分钟前');
  });
});

describe('formatErrorJSON', () => {
  it('formats FinstackError to structured JSON', () => {
    const err = new FinstackError('无法获取报价', 'yahoo', 'HTTP 403', '配置 API key');
    const json = formatErrorJSON(err);
    const parsed = JSON.parse(json);
    expect(parsed.error).toBe('无法获取报价');
    expect(parsed.source).toBe('yahoo');
    expect(parsed.reason).toBe('HTTP 403');
    expect(parsed.suggestion).toBe('配置 API key');
  });

  it('formats regular Error to basic JSON', () => {
    const err = new Error('something broke');
    const json = formatErrorJSON(err);
    const parsed = JSON.parse(json);
    expect(parsed.error).toBe('something broke');
    expect(parsed.source).toBeUndefined();
  });
});
