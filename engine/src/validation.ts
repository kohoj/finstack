// engine/src/validation.ts
//
// Shared input validation.
//
// Every command takes untrusted argv. Before this module each one re-derived
// its own rules — 15 bare .toUpperCase() calls and 18 unguarded parseFloat /
// parseInt sites — so a ticker rejected by `watchlist add` was accepted by
// `quote`, and a non-numeric price became NaN that flowed silently into
// arithmetic. Validation lives here so the rules are stated once.
//
// Everything throws FinstackError with a suggestion: these are user-facing
// failures, and the user should be able to recover without reading the source.

import { FinstackError } from './errors';

/**
 * Ticker symbols: uppercase letters, digits, dot, hyphen. Max 10 characters.
 *
 * Dot and hyphen are required by real symbols (BRK.B, BF-B). The character
 * class is deliberately narrow — tickers are interpolated into URLs and used
 * to build cache filenames, so anything outside this set is rejected rather
 * than escaped.
 */
const TICKER_RE = /^[A-Z0-9.-]{1,10}$/;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateTicker(raw: string | undefined, field = 'ticker'): string {
  if (!raw) {
    throw new FinstackError(
      `Missing ${field}`,
      undefined,
      'No ticker provided',
      'Example: finstack quote NVDA',
    );
  }

  const upper = raw.toUpperCase();
  if (!TICKER_RE.test(upper)) {
    throw new FinstackError(
      `Invalid ${field}: ${raw}`,
      undefined,
      "Tickers may contain only A-Z, 0-9, '.', and '-', up to 10 characters",
      'Example: NVDA, BRK.B, BF-B',
    );
  }

  // The character class permits dots, so '.' and '..' pass the regex. Tickers
  // become cache filenames, and '..' would escape the cache directory.
  // No real symbol is dots and hyphens alone, so require a letter or digit.
  if (!/[A-Z0-9]/.test(upper)) {
    throw new FinstackError(
      `Invalid ${field}: ${raw}`,
      undefined,
      'A ticker must contain at least one letter or digit',
      'Example: NVDA, BRK.B, BF-B',
    );
  }
  return upper;
}

/** Parse a number that must be finite. Rejects '', 'abc', Infinity, NaN. */
export function validateNumber(raw: string | undefined, field: string): number {
  if (raw === undefined || raw === '') {
    throw new FinstackError(
      `Missing ${field}`,
      undefined,
      `${field} is required`,
      `Pass a numeric value for ${field}`,
    );
  }

  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new FinstackError(
      `Invalid ${field}: ${raw}`,
      undefined,
      `${field} must be a number`,
      `Example: ${field} 100.50`,
    );
  }
  return n;
}

/** Parse a number that must be finite and strictly greater than zero. */
export function validatePositiveNumber(raw: string | undefined, field: string): number {
  const n = validateNumber(raw, field);
  if (n <= 0) {
    throw new FinstackError(
      `${field} must be positive`,
      undefined,
      `Received ${n}`,
      `Pass a value greater than zero for ${field}`,
    );
  }
  return n;
}

/** Parse a positive integer, used for --limit / --period style flags. */
export function validatePositiveInt(raw: string | undefined, field: string): number {
  const n = validateNumber(raw, field);
  if (!Number.isInteger(n) || n <= 0) {
    throw new FinstackError(
      `${field} must be a positive whole number`,
      undefined,
      `Received ${raw}`,
      `Example: --${field} 30`,
    );
  }
  return n;
}

/**
 * Validate a long position's entry/stop pair.
 *
 * Position sizing divides by (entry - stop). A stop at or above entry makes
 * that zero or negative, which silently produces a nonsense share count rather
 * than an error, so this is checked at the boundary.
 */
export function validateStopVsEntry(entry: number, stop: number): void {
  if (stop >= entry) {
    throw new FinstackError(
      `Stop price ($${stop}) must be below entry price ($${entry}) for a long position`,
      undefined,
      'Position sizing divides by (entry - stop), which would be zero or negative',
      'Set a stop below your entry, e.g. 8-10% lower',
    );
  }
}

/** Validate a YYYY-MM-DD date string and confirm it is a real calendar date. */
export function validateISODate(raw: string | undefined, field: string): string {
  if (!raw) {
    throw new FinstackError(
      `Missing ${field}`,
      undefined,
      `${field} is required`,
      `Example: --${field} 2026-01-31`,
    );
  }

  if (!ISO_DATE_RE.test(raw)) {
    throw new FinstackError(
      `Invalid ${field}: ${raw}`,
      undefined,
      'Dates must be in YYYY-MM-DD format',
      `Example: --${field} 2026-01-31`,
    );
  }

  // The regex accepts 2026-02-31; Date normalizes it to March 3. Round-trip to
  // catch that rather than silently querying the wrong range.
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new FinstackError(
      `Invalid ${field}: ${raw}`,
      undefined,
      'Not a real calendar date',
      `Example: --${field} 2026-01-31`,
    );
  }
  return raw;
}

/** Validate that a date range is ordered. */
export function validateDateRange(from: string, to: string): void {
  if (from > to) {
    throw new FinstackError(
      `Invalid date range: ${from} to ${to}`,
      undefined,
      '--from must not be later than --to',
      'Example: --from 2026-01-01 --to 2026-06-30',
    );
  }
}
