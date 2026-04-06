import { THESES_FILE, SHADOW_FILE, PORTFOLIO_FILE, JOURNAL_DIR } from '../paths';
import { readJSONSafe } from '../fs';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ThesesStore } from '../data/thesis';

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

export interface ReviewData {
  period: { from: string; to: string };
  decisions: {
    newTheses: number;
    closedTheses: number;
    threatenedTheses: number;
    totalActive: number;
  };
  journalEntries: number;
  journalByType: Record<string, number>;
}

export function aggregateReview(opts: {
  from: string;
  to: string;
  thesesFile?: string;
  journalDir?: string;
}): ReviewData {
  const { from, to, thesesFile = THESES_FILE, journalDir = JOURNAL_DIR } = opts;

  // Thesis statistics
  const store = readJSONSafe<ThesesStore>(thesesFile, { theses: [] });
  const theses = store.theses;

  const newTheses = theses.filter(t => t.createdAt >= from && t.createdAt <= to + 'T23:59:59Z').length;

  const closedTheses = theses.filter(t => {
    if (t.status !== 'dead') return false;
    const deathEntry = t.statusHistory.find(h => h.to === 'dead');
    return deathEntry && deathEntry.date >= from && deathEntry.date <= to + 'T23:59:59Z';
  }).length;

  const threatenedTheses = theses.filter(t =>
    t.status === 'threatened' || t.status === 'critical'
  ).length;

  const totalActive = theses.filter(t => t.status !== 'dead').length;

  // Journal entries
  let journalEntries = 0;
  const journalByType: Record<string, number> = {};

  if (existsSync(journalDir)) {
    try {
      const files = readdirSync(journalDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        // Extract date from filename: sense-2026-04-07.md or NVDA-2026-04-07.md
        const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
        if (!dateMatch) continue;
        const fileDate = dateMatch[1];
        if (fileDate < from || fileDate > to) continue;

        journalEntries++;

        // Categorize by prefix
        const type = file.split('-')[0] || 'other';
        journalByType[type] = (journalByType[type] || 0) + 1;
      }
    } catch {}
  }

  return {
    period: { from, to },
    decisions: {
      newTheses,
      closedTheses,
      threatenedTheses,
      totalActive,
    },
    journalEntries,
    journalByType,
  };
}

export async function reviewCmd(args: string[]) {
  const periodType = parseFlag(args, '--period');
  const fromStr = parseFlag(args, '--from');
  const toStr = parseFlag(args, '--to');

  let from: string;
  let to: string;

  if (fromStr && toStr) {
    from = fromStr;
    to = toStr;
  } else {
    to = new Date().toISOString().split('T')[0];
    switch (periodType) {
      case 'month':
        from = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
        break;
      case 'quarter':
        from = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];
        break;
      case 'week':
      default:
        from = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
        break;
    }
  }

  const data = aggregateReview({ from, to });
  console.log(JSON.stringify(data, null, 2));
}
