import { atomicWriteJSON, readJSONSafe, withFileLock } from '../fs';
import { paths } from '../paths';
import { validateTicker } from '../validation';

export interface WatchlistAlert {
  type: 'price' | 'earnings' | 'date';
  condition?: 'above' | 'below';
  value?: number;
  date?: string;
  note: string;
  triggered: boolean;
  triggeredAt?: string;
}

export interface WatchlistEntry {
  ticker: string;
  addedAt: string;
  reason: string;
  tags: string[];
  linkedThesis: string | null;
  alerts: WatchlistAlert[];
}

export function loadWatchlist(file = paths.WATCHLIST_FILE): WatchlistEntry[] {
  return readJSONSafe<WatchlistEntry[]>(file, []);
}

export function addToWatchlist(
  ticker: string,
  reason: string,
  file = paths.WATCHLIST_FILE,
  linkedThesis: string | null = null,
): WatchlistEntry {
  const normalized = validateTicker(ticker);
  return withFileLock(file, () => {
    const list = loadWatchlist(file);
    const existing = list.find(e => e.ticker === normalized);

    if (existing) {
      existing.reason = reason;
      if (linkedThesis) existing.linkedThesis = linkedThesis;
      atomicWriteJSON(file, list);
      return existing;
    }

    const entry: WatchlistEntry = {
      ticker: normalized,
      addedAt: new Date().toISOString(),
      reason,
      tags: [],
      linkedThesis,
      alerts: [],
    };
    list.push(entry);
    atomicWriteJSON(file, list);
    return entry;
  });
}

export function removeFromWatchlist(ticker: string, file = paths.WATCHLIST_FILE): void {
  const normalized = validateTicker(ticker);
  const list = loadWatchlist(file);
  const filtered = list.filter(e => e.ticker !== normalized);
  atomicWriteJSON(file, filtered);
}

export function tagTicker(ticker: string, tag: string, file = paths.WATCHLIST_FILE): boolean {
  const normalized = validateTicker(ticker);
  const list = loadWatchlist(file);
  const entry = list.find(e => e.ticker === normalized);
  if (!entry) return false;
  if (!entry.tags.includes(tag)) entry.tags.push(tag);
  atomicWriteJSON(file, list);
  return true;
}

export function untagTicker(ticker: string, tag: string, file = paths.WATCHLIST_FILE): void {
  const normalized = validateTicker(ticker);
  const list = loadWatchlist(file);
  const entry = list.find(e => e.ticker === normalized);
  if (!entry) return;
  entry.tags = entry.tags.filter(t => t !== tag);
  atomicWriteJSON(file, list);
}

export function addAlert(ticker: string, alert: WatchlistAlert, file = paths.WATCHLIST_FILE): void {
  const normalized = validateTicker(ticker);
  const list = loadWatchlist(file);
  const entry = list.find(e => e.ticker === normalized);
  if (!entry) return;
  entry.alerts.push(alert);
  atomicWriteJSON(file, list);
}
