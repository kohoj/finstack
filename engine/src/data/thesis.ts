import { atomicWriteJSON, readJSONSafe, withFileLock } from '../fs';
import { paths } from '../paths';

type ThesisStatus = 'alive' | 'threatened' | 'critical' | 'reinforced' | 'dead';
type ConditionStatus = 'pending' | 'passed' | 'failed';

interface EarningsCondition {
  id: string;
  description: string;
  type: 'earnings';
  metric: string;
  operator: '>' | '<' | '>=' | '<=' | '==';
  threshold: number;
  resolveBy: string;
  status: ConditionStatus;
  actualValue: number | null;
  resolvedAt: string | null;
}

interface EventCondition {
  id: string;
  description: string;
  type: 'event';
  falsificationTest: string;
  watchTickers: string[];
  status: ConditionStatus;
  threats: Threat[];
}

type Condition = EarningsCondition | EventCondition;

interface Threat {
  date: string;
  source: string;
  confidence: 'high' | 'moderate' | 'low';
  reasoning: string;
}

interface StatusChange {
  date: string;
  from: ThesisStatus | null;
  to: ThesisStatus;
  reason: string;
}

interface Thesis {
  id: string;
  ticker: string;
  thesis: string;
  verdict: string;
  conditions: Condition[];
  status: ThesisStatus;
  statusHistory: StatusChange[];
  createdAt: string;
  lastChecked: string;
  obituaryDueDate: string | null;
}

interface ThesesStore {
  theses: Thesis[];
}

export function loadTheses(file = paths.THESES_FILE): ThesesStore {
  return readJSONSafe<ThesesStore>(file, { theses: [] });
}

function save(data: ThesesStore, file: string): void {
  atomicWriteJSON(file, data);
}

/**
 * Read-modify-write theses.json under a file lock.
 *
 * theses.json has the most concurrent writers of any state file: /sense
 * appends threats and flips statuses while scanning, /judge appends new
 * theses, and the user can run `thesis kill` at the same time.
 */
function mutate<T>(file: string, fn: (store: ThesesStore) => T): T {
  return withFileLock(file, () => {
    const store = loadTheses(file);
    const result = fn(store);
    save(store, file);
    return result;
  });
}

export function registerThesis(
  params: {
    ticker: string;
    thesis: string;
    verdict: string;
    conditions: Array<{
      description: string;
      type: 'earnings' | 'event';
      metric?: string;
      operator?: string;
      threshold?: number;
      resolveBy?: string;
      falsificationTest?: string;
      watchTickers?: string[];
    }>;
  },
  file = paths.THESES_FILE,
): Thesis {
  return mutate(file, store => {
    const now = new Date().toISOString();
    const tsBase = Date.now();
    // Random suffix: two theses registered in the same millisecond would
    // otherwise collide, and ids are how skills reference them afterwards.
    const uniq = Math.random().toString(36).slice(2, 6);

    const conditions: Condition[] = params.conditions.map((c, i) => {
      const id = `c${tsBase}${uniq}_${i}`;
      if (c.type === 'earnings') {
        return {
          id,
          description: c.description,
          type: 'earnings' as const,
          metric: c.metric || '',
          operator: (c.operator || '>') as any,
          threshold: c.threshold || 0,
          resolveBy: c.resolveBy || '',
          status: 'pending' as const,
          actualValue: null,
          resolvedAt: null,
        };
      }
      return {
        id,
        description: c.description,
        type: 'event' as const,
        falsificationTest: c.falsificationTest || '',
        watchTickers: c.watchTickers || [],
        status: 'pending' as const,
        threats: [],
      };
    });

    const thesis: Thesis = {
      id: `t${tsBase}${uniq}`,
      ticker: params.ticker.toUpperCase(),
      thesis: params.thesis,
      verdict: params.verdict,
      conditions,
      status: 'alive',
      statusHistory: [{ date: now, from: null, to: 'alive', reason: 'Registered from /judge' }],
      createdAt: now,
      lastChecked: now,
      obituaryDueDate: null,
    };

    store.theses.push(thesis);
    return thesis;
  });
}

export function transitionThesis(
  id: string,
  to: ThesisStatus,
  reason: string,
  file = paths.THESES_FILE,
): void {
  mutate(file, store => {
    const thesis = store.theses.find(t => t.id === id);
    if (!thesis) return;

    const from = thesis.status;
    thesis.status = to;
    thesis.statusHistory.push({ date: new Date().toISOString(), from, to, reason });
    thesis.lastChecked = new Date().toISOString();
  });
}

export function killThesis(id: string, reason: string, file = paths.THESES_FILE): void {
  mutate(file, store => {
    const thesis = store.theses.find(t => t.id === id);
    if (!thesis) return;

    const from = thesis.status;
    thesis.status = 'dead';
    thesis.statusHistory.push({ date: new Date().toISOString(), from, to: 'dead', reason });
    const created = new Date(thesis.createdAt);
    created.setDate(created.getDate() + 90);
    thesis.obituaryDueDate = created.toISOString().split('T')[0];
    thesis.lastChecked = new Date().toISOString();
  });
}

export function addThreat(
  thesisId: string,
  conditionId: string,
  threat: Threat,
  file = paths.THESES_FILE,
): void {
  mutate(file, store => {
    const thesis = store.theses.find(t => t.id === thesisId);
    if (!thesis) return;
    const cond = thesis.conditions.find(c => c.id === conditionId);
    if (cond?.type !== 'event') return;
    cond.threats.push(threat);
    thesis.lastChecked = new Date().toISOString();
  });
}

export function getAlive(file = paths.THESES_FILE): Thesis[] {
  const store = loadTheses(file);
  return store.theses.filter(t => t.status !== 'dead');
}

export function getDead(file = paths.THESES_FILE): Thesis[] {
  const store = loadTheses(file);
  return store.theses.filter(t => t.status === 'dead');
}

export function getObituaryQueue(file = paths.THESES_FILE): Thesis[] {
  const today = new Date().toISOString().split('T')[0];
  return getDead(file).filter(t => t.obituaryDueDate && t.obituaryDueDate <= today);
}

export type {
  Condition,
  EarningsCondition,
  EventCondition,
  ThesesStore,
  Thesis,
  ThesisStatus,
  Threat,
};
