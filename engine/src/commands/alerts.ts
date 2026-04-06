import { WATCHLIST_FILE, THESES_FILE } from '../paths';
import { readJSONSafe } from '../fs';
import type { ThesesStore } from '../data/thesis';

// Temporary WatchlistEntry type definition until watchlist.ts is created
interface WatchlistEntry {
  ticker: string;
  addedAt: string;
  reason: string;
  tags: string[];
  linkedThesis: string | null;
  alerts: Array<{
    type: 'date' | 'earnings' | 'price';
    date?: string;
    note: string;
    triggered: boolean;
  }>;
}

export interface Alert {
  ticker: string;
  source: 'watchlist' | 'thesis' | 'thesis_condition' | 'earnings';
  type: string;
  date: string;
  daysUntil: number;
  description: string;
  urgency: 'overdue' | 'today' | 'soon' | 'upcoming';
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / 86400000);
}

function urgencyOf(days: number): Alert['urgency'] {
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 3) return 'soon';
  return 'upcoming';
}

const URGENCY_ORDER: Record<Alert['urgency'], number> = {
  overdue: 0,
  today: 1,
  soon: 2,
  upcoming: 3,
};

export function aggregateAlerts(opts: {
  watchlistFile?: string;
  thesesFile?: string;
  dueWithinDays?: number;
  source?: string;
}): Alert[] {
  const {
    watchlistFile = WATCHLIST_FILE,
    thesesFile = THESES_FILE,
    dueWithinDays = 7,
    source,
  } = opts;

  const alerts: Alert[] = [];

  // Watchlist alerts (includes date + earnings types)
  if (!source || source === 'watchlist' || source === 'earnings') {
    const watchlist = readJSONSafe<WatchlistEntry[]>(watchlistFile, []);
    for (const entry of watchlist) {
      for (const alert of entry.alerts) {
        if (alert.triggered) continue;
        if (alert.type === 'date' || alert.type === 'earnings') {
          const dateStr = alert.date;
          if (!dateStr) continue;
          const days = daysUntil(dateStr);
          if (days <= dueWithinDays) {
            alerts.push({
              ticker: entry.ticker,
              source: 'watchlist',
              type: alert.type,
              date: dateStr,
              daysUntil: days,
              description: alert.note,
              urgency: urgencyOf(days),
            });
          }
        }
      }
    }
  }

  // Thesis deadlines
  if (!source || source === 'thesis') {
    const store = readJSONSafe<ThesesStore>(thesesFile, { theses: [] });
    for (const thesis of store.theses) {
      // Obituary due dates
      if (thesis.status === 'dead' && thesis.obituaryDueDate) {
        const days = daysUntil(thesis.obituaryDueDate);
        if (days <= dueWithinDays) {
          alerts.push({
            ticker: thesis.ticker,
            source: 'thesis',
            type: 'obituary_due',
            date: thesis.obituaryDueDate,
            daysUntil: days,
            description: `论文"${thesis.thesis.slice(0, 40)}"复盘到期`,
            urgency: urgencyOf(days),
          });
        }
      }

      // Condition resolveBy dates
      if (thesis.status !== 'dead') {
        for (const cond of thesis.conditions) {
          if (cond.status !== 'pending') continue;
          if (cond.type === 'earnings' && cond.resolveBy) {
            const days = daysUntil(cond.resolveBy);
            if (days <= dueWithinDays) {
              alerts.push({
                ticker: thesis.ticker,
                source: 'thesis_condition',
                type: 'condition_resolveBy',
                date: cond.resolveBy,
                daysUntil: days,
                description: `论文条件"${cond.description.slice(0, 40)}"即将到验证日`,
                urgency: urgencyOf(days),
              });
            }
          }
        }
      }
    }
  }

  // Sort: overdue first, then today, then by date ascending
  alerts.sort((a, b) => {
    const urgDiff = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
    if (urgDiff !== 0) return urgDiff;
    return a.daysUntil - b.daysUntil;
  });

  return alerts;
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

export async function alerts(args: string[]) {
  const dueStr = parseFlag(args, '--due');
  const source = parseFlag(args, '--source');
  const dueWithinDays = dueStr ? parseInt(dueStr) : 7;

  const result = aggregateAlerts({ dueWithinDays, source });
  console.log(JSON.stringify({ alerts: result, count: result.length }, null, 2));
}
