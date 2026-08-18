import { atomicWriteJSON, readJSONSafe, withFileLock } from '../fs';
import { paths } from '../paths';

interface StagedTranche {
  tranche: number;
  shares: number;
  trigger: string;
  triggerPrice?: number;
  fallbackDate?: string;
  status: 'pending' | 'filled' | 'expired';
  fillPrice: number | null;
  fillDate: string | null;
}

interface ShadowEntry {
  id: string;
  ticker: string;
  action: string;
  entryDate: string;
  totalShares: number;
  filledShares: number;
  stagedPlan: StagedTranche[];
  stopLoss: { price: number; reason: string };
  takeProfit: { price: number; reason: string };
  timeHorizon: string;
  linkedThesis: string | null;
  sourceJudge: string;
  sourceAct: string;
  createdAt: string;
  status: 'open' | 'closed';
  exitPrice: number | null;
  exitDate: string | null;
  exitReason: string | null;
}

interface Shadow {
  entries: ShadowEntry[];
}

export function loadShadow(file = paths.SHADOW_FILE): Shadow {
  return readJSONSafe<Shadow>(file, { entries: [] });
}

function save(data: Shadow, file: string): void {
  atomicWriteJSON(file, data);
}

/**
 * Read-modify-write shadow.json under a file lock. /act appends entries and
 * `portfolio remove` closes them, which can overlap across sessions.
 */
function mutate<T>(file: string, fn: (shadow: Shadow) => T): T {
  return withFileLock(file, () => {
    const shadow = loadShadow(file);
    const result = fn(shadow);
    save(shadow, file);
    return result;
  });
}

export function createEntry(
  params: {
    ticker: string;
    action: string;
    entryDate: string;
    totalShares: number;
    stagedPlan: StagedTranche[];
    stopLoss: { price: number; reason: string };
    takeProfit: { price: number; reason: string };
    timeHorizon: string;
    linkedThesis: string | null;
    sourceJudge: string;
    sourceAct: string;
  },
  file = paths.SHADOW_FILE,
): ShadowEntry {
  return mutate(file, shadow => {
    const filledShares = params.stagedPlan
      .filter(t => t.status === 'filled')
      .reduce((sum, t) => sum + t.shares, 0);

    const entry: ShadowEntry = {
      id: `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      ...params,
      filledShares,
      createdAt: new Date().toISOString(),
      status: 'open',
      exitPrice: null,
      exitDate: null,
      exitReason: null,
    };
    shadow.entries.push(entry);
    return entry;
  });
}

export function findOpen(ticker: string, file = paths.SHADOW_FILE): ShadowEntry | null {
  const shadow = loadShadow(file);
  return shadow.entries.find(e => e.ticker === ticker.toUpperCase() && e.status === 'open') || null;
}

export function closeEntry(
  ticker: string,
  exitPrice: number,
  exitDate: string,
  exitReason: string,
  file = paths.SHADOW_FILE,
): void {
  mutate(file, shadow => {
    const entry = shadow.entries.find(
      e => e.ticker === ticker.toUpperCase() && e.status === 'open',
    );
    if (entry) {
      entry.status = 'closed';
      entry.exitPrice = exitPrice;
      entry.exitDate = exitDate;
      entry.exitReason = exitReason;
    }
  });
}

/**
 * Share-weighted average fill price across all filled tranches, or null if none
 * filled. A staged plan fills in multiple tranches at different prices, so the
 * shadow entry price is the weighted mean — using only the first tranche would
 * misstate the cost basis for any multi-tranche entry.
 */
export function weightedFillPrice(entry: ShadowEntry): number | null {
  const filled = entry.stagedPlan.filter(t => t.status === 'filled' && t.fillPrice !== null);
  const shares = filled.reduce((s, t) => s + t.shares, 0);
  if (shares === 0) return null;
  const cost = filled.reduce((s, t) => s + (t.fillPrice as number) * t.shares, 0);
  return +(cost / shares).toFixed(2);
}

export type { Shadow, ShadowEntry, StagedTranche };
