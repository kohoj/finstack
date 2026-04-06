import { SHADOW_FILE } from '../paths';
import { atomicWriteJSON, readJSONSafe } from '../fs';

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

export function loadShadow(file = SHADOW_FILE): Shadow {
  return readJSONSafe<Shadow>(file, { entries: [] });
}

function save(data: Shadow, file: string): void {
  atomicWriteJSON(file, data);
}

export function createEntry(params: {
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
}, file = SHADOW_FILE): ShadowEntry {
  const shadow = loadShadow(file);
  const filledShares = params.stagedPlan
    .filter(t => t.status === 'filled')
    .reduce((sum, t) => sum + t.shares, 0);

  const entry: ShadowEntry = {
    id: `s${Date.now()}`,
    ...params,
    filledShares,
    createdAt: new Date().toISOString(),
    status: 'open',
    exitPrice: null,
    exitDate: null,
    exitReason: null,
  };
  shadow.entries.push(entry);
  save(shadow, file);
  return entry;
}

export function findOpen(ticker: string, file = SHADOW_FILE): ShadowEntry | null {
  const shadow = loadShadow(file);
  return shadow.entries.find(e => e.ticker === ticker.toUpperCase() && e.status === 'open') || null;
}

export function closeEntry(
  ticker: string,
  exitPrice: number,
  exitDate: string,
  exitReason: string,
  file = SHADOW_FILE,
): void {
  const shadow = loadShadow(file);
  const entry = shadow.entries.find(e => e.ticker === ticker.toUpperCase() && e.status === 'open');
  if (entry) {
    entry.status = 'closed';
    entry.exitPrice = exitPrice;
    entry.exitDate = exitDate;
    entry.exitReason = exitReason;
  }
  save(shadow, file);
}

export type { ShadowEntry, Shadow, StagedTranche };
