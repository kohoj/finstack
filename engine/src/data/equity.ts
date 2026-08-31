// engine/src/data/equity.ts
//
// Equity-curve snapshots, high-water mark, and drawdown.
//
// Positions may carry explicit marks, but an equity curve is a dated
// high-water-mark series, not a by-product of the latest portfolio snapshot.
// The drawdown circuit breaker therefore records an explicit current
// mark-to-market portfolio value. This module owns that resulting time series.
//
// Drawdown is peak-to-current. Peak and current pull in opposite directions —
// peak wants the running maximum, current wants the latest mark — so they are
// tracked separately: `peak` is an explicit high-water mark that only ratchets
// up, and the latest snapshot is the current mark. Collapsing both into one
// value-per-day would let a lower intraday re-mark erase an earlier peak.
//
// Without this the breaker had no data source and risk.ts hard-coded
// drawdownPct to 0, so the circuit breaker could never fire.

import { atomicWriteJSON, readJSONSafe, withFileLock } from '../fs';
import { paths } from '../paths';

export interface EquitySnapshot {
  date: string; // ISO date (yyyy-mm-dd) of the mark
  value: number; // mark-to-market portfolio value
}

export interface EquityHistory {
  snapshots: EquitySnapshot[]; // latest mark per calendar date, ascending
  peak: number | null; // high-water mark: max value ever recorded
  peakDate: string | null; // date the high-water mark was set
  updatedAt: string;
}

const emptyHistory = (): EquityHistory => ({
  snapshots: [],
  peak: null,
  peakDate: null,
  updatedAt: '',
});

export function loadEquity(file = paths.EQUITY_FILE): EquityHistory {
  // A fresh object per call: readJSONSafe returns its fallback by reference, and
  // recordEquity mutates the loaded history in place, so a shared constant would
  // be polluted across calls within a process.
  const data = readJSONSafe<EquityHistory>(file, emptyHistory());
  if (!Array.isArray(data.snapshots)) data.snapshots = [];
  if (data.peak === undefined) data.peak = null;
  if (data.peakDate === undefined) data.peakDate = null;
  return data;
}

/**
 * Record a mark-to-market value. One snapshot per calendar date: re-marking the
 * same day overwrites that day's value with the latest mark (current follows the
 * latest mark). The high-water mark is tracked separately and only ratchets up,
 * so a later, lower mark never lowers the peak. Returns the updated history.
 */
export function recordEquity(
  value: number,
  isoDate: string,
  file = paths.EQUITY_FILE,
): EquityHistory {
  return withFileLock(file, () => {
    const history = loadEquity(file);
    const existing = history.snapshots.find(s => s.date === isoDate);
    if (existing) {
      existing.value = value;
    } else {
      history.snapshots.push({ date: isoDate, value });
      history.snapshots.sort((a, b) => a.date.localeCompare(b.date));
    }
    if (history.peak === null || value > history.peak) {
      history.peak = value;
      history.peakDate = isoDate;
    }
    history.updatedAt = new Date().toISOString();
    atomicWriteJSON(file, history);
    return history;
  });
}

export interface DrawdownState {
  peak: number | null; // high-water mark, or null if no history
  peakDate: string | null;
  current: number | null; // latest recorded mark
  drawdownPct: number; // 0 when no peak or at/above peak
}

/**
 * Peak-to-current drawdown. Peak is the persisted high-water mark; current is
 * the latest snapshot. Returns drawdownPct 0 when there is no history or the
 * current mark is at or above the peak.
 */
export function computeDrawdown(history: EquityHistory): DrawdownState {
  const { snapshots, peak, peakDate } = history;
  if (snapshots.length === 0 || peak === null) {
    return { peak: null, peakDate: null, current: null, drawdownPct: 0 };
  }
  const current = snapshots[snapshots.length - 1].value;
  const drawdownPct = peak > 0 && current < peak ? ((peak - current) / peak) * 100 : 0;
  return { peak, peakDate, current, drawdownPct: +drawdownPct.toFixed(2) };
}
