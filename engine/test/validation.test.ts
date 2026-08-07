import { describe, expect, it } from 'bun:test';
import { FinstackError } from '../src/errors';
import {
  validateDateRange,
  validateISODate,
  validateNumber,
  validatePositiveInt,
  validatePositiveNumber,
  validateStopVsEntry,
  validateTicker,
} from '../src/validation';

describe('validateTicker', () => {
  it('uppercases valid input', () => {
    expect(validateTicker('nvda')).toBe('NVDA');
  });

  it('accepts symbols with a dot or hyphen', () => {
    expect(validateTicker('BRK.B')).toBe('BRK.B');
    expect(validateTicker('BF-B')).toBe('BF-B');
  });

  it('accepts digits', () => {
    expect(validateTicker('7203.T')).toBe('7203.T');
  });

  it('rejects missing input', () => {
    expect(() => validateTicker(undefined)).toThrow(FinstackError);
    expect(() => validateTicker('')).toThrow(FinstackError);
  });

  it('rejects path traversal', () => {
    expect(() => validateTicker('../etc/passwd')).toThrow(FinstackError);
    expect(() => validateTicker('..')).toThrow(FinstackError);
    expect(() => validateTicker('a/b')).toThrow(FinstackError);
  });

  it('rejects shell metacharacters', () => {
    expect(() => validateTicker('$(whoami)')).toThrow(FinstackError);
    expect(() => validateTicker('`ls`')).toThrow(FinstackError);
    expect(() => validateTicker('A;B')).toThrow(FinstackError);
    expect(() => validateTicker('A|B')).toThrow(FinstackError);
    expect(() => validateTicker('A&B')).toThrow(FinstackError);
  });

  it('rejects URLs, which would otherwise reach a fetch', () => {
    expect(() => validateTicker('http://169.254.169.254/')).toThrow(FinstackError);
  });

  it('rejects whitespace and markup', () => {
    expect(() => validateTicker('NV DA')).toThrow(FinstackError);
    expect(() => validateTicker('<script>')).toThrow(FinstackError);
  });

  it('rejects symbols longer than 10 characters', () => {
    expect(() => validateTicker('ABCDEFGHIJK')).toThrow(FinstackError);
  });

  it('names the field in the error', () => {
    try {
      validateTicker('!!!', 'watchlist ticker');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as FinstackError).message).toContain('watchlist ticker');
    }
  });
});

describe('validateNumber', () => {
  it('parses integers and decimals', () => {
    expect(validateNumber('42', 'shares')).toBe(42);
    expect(validateNumber('850.50', 'price')).toBe(850.5);
  });

  it('parses negatives and zero', () => {
    expect(validateNumber('-5', 'delta')).toBe(-5);
    expect(validateNumber('0', 'delta')).toBe(0);
  });

  it('parses scientific notation, which screen filters rely on', () => {
    expect(validateNumber('10e9', 'marketCap')).toBe(1e10);
  });

  it('rejects missing and empty input', () => {
    expect(() => validateNumber(undefined, 'shares')).toThrow(FinstackError);
    expect(() => validateNumber('', 'shares')).toThrow(FinstackError);
  });

  it('rejects non-numeric text', () => {
    expect(() => validateNumber('abc', 'shares')).toThrow(FinstackError);
  });

  // parseFloat('12abc') returns 12, silently accepting malformed input.
  // Number() returns NaN, which is what we want.
  it('rejects trailing garbage that parseFloat would accept', () => {
    expect(() => validateNumber('12abc', 'shares')).toThrow(FinstackError);
  });

  it('rejects Infinity and NaN', () => {
    expect(() => validateNumber('Infinity', 'shares')).toThrow(FinstackError);
    expect(() => validateNumber('NaN', 'shares')).toThrow(FinstackError);
  });
});

describe('validatePositiveNumber', () => {
  it('accepts values above zero', () => {
    expect(validatePositiveNumber('0.01', 'price')).toBe(0.01);
  });

  it('rejects zero and negatives', () => {
    expect(() => validatePositiveNumber('0', 'price')).toThrow(FinstackError);
    expect(() => validatePositiveNumber('-1', 'price')).toThrow(FinstackError);
  });
});

describe('validatePositiveInt', () => {
  it('accepts whole numbers', () => {
    expect(validatePositiveInt('30', 'period')).toBe(30);
  });

  it('rejects fractions', () => {
    expect(() => validatePositiveInt('1.5', 'period')).toThrow(FinstackError);
  });

  it('rejects zero and negatives', () => {
    expect(() => validatePositiveInt('0', 'period')).toThrow(FinstackError);
    expect(() => validatePositiveInt('-5', 'period')).toThrow(FinstackError);
  });
});

describe('validateStopVsEntry', () => {
  it('accepts a stop below entry', () => {
    expect(() => validateStopVsEntry(100, 90)).not.toThrow();
  });

  it('rejects a stop equal to entry, which would divide by zero', () => {
    expect(() => validateStopVsEntry(100, 100)).toThrow(FinstackError);
  });

  it('rejects a stop above entry', () => {
    expect(() => validateStopVsEntry(100, 120)).toThrow(FinstackError);
  });
});

describe('validateISODate', () => {
  it('accepts a well-formed date', () => {
    expect(validateISODate('2026-01-31', 'from')).toBe('2026-01-31');
  });

  it('accepts a leap day in a leap year', () => {
    expect(validateISODate('2024-02-29', 'from')).toBe('2024-02-29');
  });

  it('rejects missing input', () => {
    expect(() => validateISODate(undefined, 'from')).toThrow(FinstackError);
  });

  it('rejects other formats', () => {
    expect(() => validateISODate('01/31/2026', 'from')).toThrow(FinstackError);
    expect(() => validateISODate('2026-1-31', 'from')).toThrow(FinstackError);
  });

  // Date('2026-02-31') silently rolls over to March 3 rather than failing,
  // which would query a range the user never asked for.
  it('rejects dates that do not exist', () => {
    expect(() => validateISODate('2026-02-31', 'from')).toThrow(FinstackError);
    expect(() => validateISODate('2026-13-01', 'from')).toThrow(FinstackError);
    expect(() => validateISODate('2023-02-29', 'from')).toThrow(FinstackError);
  });
});

describe('validateDateRange', () => {
  it('accepts an ordered range', () => {
    expect(() => validateDateRange('2026-01-01', '2026-06-30')).not.toThrow();
  });

  it('accepts a single-day range', () => {
    expect(() => validateDateRange('2026-01-01', '2026-01-01')).not.toThrow();
  });

  it('rejects a reversed range', () => {
    expect(() => validateDateRange('2026-06-30', '2026-01-01')).toThrow(FinstackError);
  });
});
