import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const DEFAULT_FILE = join(homedir(), '.finstack', 'theses.json');

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

export function loadTheses(file = DEFAULT_FILE): ThesesStore {
  if (!existsSync(file)) return { theses: [] };
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return { theses: [] };
  }
}

function save(data: ThesesStore, file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
}

let _condCounter = 0;

export function registerThesis(params: {
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
}, file = DEFAULT_FILE): Thesis {
  const store = loadTheses(file);
  const now = new Date().toISOString();

  const conditions: Condition[] = params.conditions.map((c) => {
    const id = `c${++_condCounter}`;
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
    id: `t${Date.now()}`,
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
  save(store, file);
  return thesis;
}

export function transitionThesis(id: string, to: ThesisStatus, reason: string, file = DEFAULT_FILE): void {
  const store = loadTheses(file);
  const thesis = store.theses.find(t => t.id === id);
  if (!thesis) return;

  const from = thesis.status;
  thesis.status = to;
  thesis.statusHistory.push({ date: new Date().toISOString(), from, to, reason });
  thesis.lastChecked = new Date().toISOString();
  save(store, file);
}

export function killThesis(id: string, reason: string, file = DEFAULT_FILE): void {
  const store = loadTheses(file);
  const thesis = store.theses.find(t => t.id === id);
  if (!thesis) return;

  const from = thesis.status;
  thesis.status = 'dead';
  thesis.statusHistory.push({ date: new Date().toISOString(), from, to: 'dead', reason });
  const created = new Date(thesis.createdAt);
  created.setDate(created.getDate() + 90);
  thesis.obituaryDueDate = created.toISOString().split('T')[0];
  thesis.lastChecked = new Date().toISOString();
  save(store, file);
}

export function addThreat(
  thesisId: string,
  conditionId: string,
  threat: Threat,
  file = DEFAULT_FILE,
): void {
  const store = loadTheses(file);
  const thesis = store.theses.find(t => t.id === thesisId);
  if (!thesis) return;
  const cond = thesis.conditions.find(c => c.id === conditionId);
  if (!cond || cond.type !== 'event') return;
  cond.threats.push(threat);
  thesis.lastChecked = new Date().toISOString();
  save(store, file);
}

export function getAlive(file = DEFAULT_FILE): Thesis[] {
  const store = loadTheses(file);
  return store.theses.filter(t => t.status !== 'dead');
}

export function getDead(file = DEFAULT_FILE): Thesis[] {
  const store = loadTheses(file);
  return store.theses.filter(t => t.status === 'dead');
}

export function getObituaryQueue(file = DEFAULT_FILE): Thesis[] {
  const today = new Date().toISOString().split('T')[0];
  return getDead(file).filter(t => t.obituaryDueDate && t.obituaryDueDate <= today);
}

export type { Thesis, Condition, EarningsCondition, EventCondition, Threat, ThesisStatus, ThesesStore };
