import {
  loadTheses, getAlive, getDead, getObituaryQueue,
  killThesis as killThesisData, transitionThesis,
  type Thesis, type ThesesStore,
} from '../data/thesis';

export function formatThesisList(theses: Thesis[]): any[] {
  return theses.map(t => {
    const pendingCount = t.conditions.filter(c => c.status === 'pending').length;
    const failedCount = t.conditions.filter(c => c.status === 'failed').length;
    const condSummary = failedCount > 0
      ? `${failedCount} failed, ${pendingCount} pending`
      : `${pendingCount} pending`;

    return {
      id: t.id,
      ticker: t.ticker,
      thesis: t.thesis,
      status: t.status.toUpperCase(),
      conditions: condSummary,
      since: t.createdAt.split('T')[0],
      obituaryDue: t.obituaryDueDate || null,
    };
  });
}

export function formatThesisHistory(theses: Thesis[]) {
  const alive = theses.filter(t => t.status !== 'dead').length;
  const dead = theses.filter(t => t.status === 'dead').length;
  const threatened = theses.filter(t => t.status === 'threatened').length;

  const deadTheses = theses.filter(t => t.status === 'dead');
  const causeOfDeath: Record<string, number> = {};
  for (const t of deadTheses) {
    const lastChange = t.statusHistory[t.statusHistory.length - 1];
    const cause = lastChange?.reason || 'unknown';
    causeOfDeath[cause] = (causeOfDeath[cause] || 0) + 1;
  }

  const lifespans = deadTheses.map(t => {
    const created = new Date(t.createdAt).getTime();
    const died = new Date(t.statusHistory[t.statusHistory.length - 1]?.date || t.createdAt).getTime();
    return Math.ceil((died - created) / 86400000);
  });
  const avgLifespan = lifespans.length > 0
    ? Math.round(lifespans.reduce((s, l) => s + l, 0) / lifespans.length)
    : 0;

  return {
    total: theses.length,
    alive,
    dead,
    threatened,
    causeOfDeath,
    avgLifespanDays: avgLifespan,
    obituariesPending: getObituaryQueue().length,
  };
}

export async function thesis(args: string[]) {
  const sub = args[0] || 'list';

  switch (sub) {
    case 'list': {
      const all = loadTheses();
      const output = formatThesisList(all.theses);
      console.log(JSON.stringify(output, null, 2));
      break;
    }

    case 'check': {
      const ticker = args[1]?.toUpperCase();
      const alive = getAlive();
      const filtered = ticker ? alive.filter(t => t.ticker === ticker) : alive;
      const withEarnings = filtered.filter(t =>
        t.conditions.some(c => c.type === 'earnings' && c.status === 'pending'),
      );
      console.log(JSON.stringify({
        message: `${withEarnings.length} theses with pending earnings conditions`,
        theses: formatThesisList(withEarnings),
      }, null, 2));
      break;
    }

    case 'kill': {
      const id = args[1];
      const reason = args.slice(2).join(' ') || 'Manual kill';
      if (!id) {
        console.error(JSON.stringify({ error: 'Usage: finstack thesis kill <id> <reason>' }));
        process.exit(1);
      }
      killThesisData(id, reason);
      console.log(JSON.stringify({ message: `Thesis ${id} killed: ${reason}` }));
      break;
    }

    case 'history': {
      const all = loadTheses();
      const summary = formatThesisHistory(all.theses);
      console.log(JSON.stringify(summary, null, 2));
      break;
    }

    default:
      console.error(JSON.stringify({ error: `Unknown subcommand: ${sub}. Use list|check|kill|history` }));
      process.exit(1);
  }
}
