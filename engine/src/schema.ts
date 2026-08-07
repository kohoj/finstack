// engine/src/schema.ts
//
// Validation for state the skills author.
//
// Most finstack state is written by engine commands from typed arguments, so
// it cannot be malformed. Two files are different: theses.json and shadow.json
// hold the output of reasoning — an investment thesis with falsifiable
// conditions, a staged entry plan with a rationale attached to every tranche.
// That content cannot come from CLI flags, so the skills compose it as JSON.
//
// Which means these two files are the only place where a typo, a dropped
// field, or a hallucinated shape reaches disk. Before this module they were
// written with no checking at all, and the failures were silent: a thesis with
// no threshold became `threshold: 0`, which reads as "revenue above zero" — a
// condition that can never falsify.
//
// The validators are hand-written rather than pulled from a schema library.
// The rules include business invariants a JSON Schema cannot express (a stop
// below entry, tranche shares summing to the total), the error messages need
// to name a field path precisely enough for a model to self-correct on retry,
// and adding a dependency to a zero-dependency binary for two call sites is a
// poor trade.

import { FinstackError } from './errors';
import { validateISODate, validateTicker } from './validation';

/** A validation failure, located at a field path. */
export interface SchemaIssue {
  path: string;
  message: string;
}

export class SchemaError extends FinstackError {
  issues: SchemaIssue[];

  constructor(what: string, issues: SchemaIssue[]) {
    const detail = issues.map(i => `${i.path}: ${i.message}`).join('; ');
    super(
      `Invalid ${what}`,
      undefined,
      detail,
      `Fix the field(s) above and retry. Run 'finstack ${what} add --schema' to see the expected shape.`,
    );
    this.name = 'SchemaError';
    this.issues = issues;
  }
}

// ── Primitives ──────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(value: unknown, path: string, issues: SchemaIssue[], minLength = 1): void {
  if (typeof value !== 'string') {
    issues.push({ path, message: `expected a string, got ${describe(value)}` });
    return;
  }
  if (value.trim().length < minLength) {
    issues.push({ path, message: `must not be empty` });
  }
}

function requireNumber(value: unknown, path: string, issues: SchemaIssue[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push({ path, message: `expected a finite number, got ${describe(value)}` });
  }
}

function requirePositiveNumber(value: unknown, path: string, issues: SchemaIssue[]): void {
  requireNumber(value, path, issues);
  if (typeof value === 'number' && Number.isFinite(value) && value <= 0) {
    issues.push({ path, message: `must be greater than zero, got ${value}` });
  }
}

function requireEnum<T extends string>(
  value: unknown,
  path: string,
  issues: SchemaIssue[],
  allowed: readonly T[],
): void {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    issues.push({
      path,
      message: `expected one of ${allowed.join(', ')}, got ${describe(value)}`,
    });
  }
}

function requireArray(value: unknown, path: string, issues: SchemaIssue[], minLength = 0): boolean {
  if (!Array.isArray(value)) {
    issues.push({ path, message: `expected an array, got ${describe(value)}` });
    return false;
  }
  if (value.length < minLength) {
    issues.push({ path, message: `must contain at least ${minLength} item(s)` });
    return false;
  }
  return true;
}

function requireDate(value: unknown, path: string, issues: SchemaIssue[]): void {
  if (typeof value !== 'string') {
    issues.push({ path, message: `expected a YYYY-MM-DD date, got ${describe(value)}` });
    return;
  }
  try {
    validateISODate(value, path);
  } catch {
    issues.push({ path, message: `not a valid YYYY-MM-DD date: ${value}` });
  }
}

function checkTicker(value: unknown, path: string, issues: SchemaIssue[]): string | null {
  if (typeof value !== 'string') {
    issues.push({ path, message: `expected a ticker string, got ${describe(value)}` });
    return null;
  }
  try {
    return validateTicker(value, path);
  } catch (e) {
    issues.push({ path, message: (e as Error).message });
    return null;
  }
}

/**
 * Reject fields that are not part of the schema.
 *
 * A misspelled key would otherwise be dropped on write with no signal —
 * `falsificationTest` typed as `falsificationtest` produces a condition with
 * an empty test, which looks valid and can never fail.
 */
function rejectUnknownKeys(
  obj: Record<string, unknown>,
  known: readonly string[],
  path: string,
  issues: SchemaIssue[],
): void {
  for (const key of Object.keys(obj)) {
    if (!(known as readonly string[]).includes(key)) {
      const suggestion = closestKey(key, known);
      issues.push({
        path: path ? `${path}.${key}` : key,
        message: suggestion
          ? `unknown field — did you mean "${suggestion}"?`
          : `unknown field (allowed: ${known.join(', ')})`,
      });
    }
  }
}

/** Nearest known key by edit distance, when one is close enough to be a typo. */
function closestKey(key: string, known: readonly string[]): string | null {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of known) {
    const d = editDistance(key.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  // Only suggest when the difference is plausibly a typo rather than a
  // different word entirely.
  return bestDistance <= Math.max(2, Math.floor(key.length / 3)) ? best : null;
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[b.length];
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'nothing';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'string') return `"${value.slice(0, 40)}"`;
  return String(value);
}

// ── Thesis ──────────────────────────────────────────────────────────────────

export const OPERATORS = ['>', '<', '>=', '<=', '=='] as const;

const THESIS_KEYS = ['ticker', 'thesis', 'verdict', 'conditions'] as const;
const EARNINGS_CONDITION_KEYS = [
  'description',
  'type',
  'metric',
  'operator',
  'threshold',
  'resolveBy',
] as const;
const EVENT_CONDITION_KEYS = ['description', 'type', 'falsificationTest', 'watchTickers'] as const;

export interface ThesisInput {
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
}

/**
 * Validate a thesis as composed by /judge.
 *
 * Throws SchemaError listing every problem found, rather than the first —
 * a model correcting its output should not need one round trip per field.
 */
export function validateThesisInput(raw: unknown): ThesisInput {
  const issues: SchemaIssue[] = [];

  if (!isPlainObject(raw)) {
    throw new SchemaError('thesis', [
      { path: '(root)', message: `expected a JSON object, got ${describe(raw)}` },
    ]);
  }

  rejectUnknownKeys(raw, THESIS_KEYS, '', issues);

  const ticker = checkTicker(raw.ticker, 'ticker', issues);
  requireString(raw.thesis, 'thesis', issues);
  requireString(raw.verdict, 'verdict', issues);

  // A thesis with no conditions cannot be falsified, which is the entire point
  // of registering one.
  if (requireArray(raw.conditions, 'conditions', issues, 1)) {
    (raw.conditions as unknown[]).forEach((cond, i) => {
      validateCondition(cond, `conditions[${i}]`, issues);
    });
  }

  if (issues.length > 0) throw new SchemaError('thesis', issues);

  return { ...(raw as unknown as ThesisInput), ticker: ticker as string };
}

function validateCondition(raw: unknown, path: string, issues: SchemaIssue[]): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: `expected an object, got ${describe(raw)}` });
    return;
  }

  requireString(raw.description, `${path}.description`, issues);
  requireEnum(raw.type, `${path}.type`, issues, ['earnings', 'event'] as const);

  // The two condition types are a discriminated union in the store but arrive
  // as one flat shape with optional fields. Checking them together is what
  // catches an earnings condition missing its threshold — which would default
  // to 0 and read as "above zero", a condition that can never fail.
  if (raw.type === 'earnings') {
    rejectUnknownKeys(raw, EARNINGS_CONDITION_KEYS, path, issues);
    requireString(raw.metric, `${path}.metric`, issues);
    requireEnum(raw.operator, `${path}.operator`, issues, OPERATORS);
    requireNumber(raw.threshold, `${path}.threshold`, issues);
    requireDate(raw.resolveBy, `${path}.resolveBy`, issues);
  } else if (raw.type === 'event') {
    rejectUnknownKeys(raw, EVENT_CONDITION_KEYS, path, issues);
    requireString(raw.falsificationTest, `${path}.falsificationTest`, issues);

    if (raw.watchTickers !== undefined) {
      if (requireArray(raw.watchTickers, `${path}.watchTickers`, issues)) {
        (raw.watchTickers as unknown[]).forEach((t, i) => {
          checkTicker(t, `${path}.watchTickers[${i}]`, issues);
        });
      }
    }
  }
}

// ── Shadow entry ────────────────────────────────────────────────────────────

const SHADOW_KEYS = [
  'ticker',
  'action',
  'entryDate',
  'totalShares',
  'stagedPlan',
  'stopLoss',
  'takeProfit',
  'timeHorizon',
  'linkedThesis',
  'sourceJudge',
  'sourceAct',
] as const;

const TRANCHE_KEYS = [
  'tranche',
  'shares',
  'trigger',
  'triggerPrice',
  'fallbackDate',
  'status',
  'fillPrice',
  'fillDate',
] as const;

const PRICE_LEVEL_KEYS = ['price', 'reason'] as const;

export interface ShadowInput {
  ticker: string;
  action: string;
  entryDate: string;
  totalShares: number;
  stagedPlan: Array<{
    tranche: number;
    shares: number;
    trigger: string;
    triggerPrice?: number;
    fallbackDate?: string;
    status: 'pending' | 'filled' | 'expired';
    fillPrice: number | null;
    fillDate: string | null;
  }>;
  stopLoss: { price: number; reason: string };
  takeProfit: { price: number; reason: string };
  timeHorizon: string;
  linkedThesis: string | null;
  sourceJudge: string;
  sourceAct: string;
}

/**
 * Validate a shadow entry as composed by /act.
 *
 * Beyond field types, this enforces the invariants that make the entry usable
 * as a counterfactual: the tranches must add up to the position, and the stop
 * and target must sit on the correct side of the entry. A shadow entry that
 * violates either silently corrupts every later alpha calculation.
 */
export function validateShadowInput(raw: unknown): ShadowInput {
  const issues: SchemaIssue[] = [];

  if (!isPlainObject(raw)) {
    throw new SchemaError('shadow entry', [
      { path: '(root)', message: `expected a JSON object, got ${describe(raw)}` },
    ]);
  }

  rejectUnknownKeys(raw, SHADOW_KEYS, '', issues);

  const ticker = checkTicker(raw.ticker, 'ticker', issues);
  requireEnum(raw.action, 'action', issues, ['buy', 'sell'] as const);
  requireDate(raw.entryDate, 'entryDate', issues);
  requirePositiveNumber(raw.totalShares, 'totalShares', issues);
  requireDate(raw.timeHorizon, 'timeHorizon', issues);
  requireString(raw.sourceJudge, 'sourceJudge', issues);
  requireString(raw.sourceAct, 'sourceAct', issues);

  if (raw.linkedThesis !== null && typeof raw.linkedThesis !== 'string') {
    issues.push({
      path: 'linkedThesis',
      message: `expected a thesis id or null, got ${describe(raw.linkedThesis)}`,
    });
  }

  validatePriceLevel(raw.stopLoss, 'stopLoss', issues);
  validatePriceLevel(raw.takeProfit, 'takeProfit', issues);

  let trancheTotal = 0;
  if (requireArray(raw.stagedPlan, 'stagedPlan', issues, 1)) {
    (raw.stagedPlan as unknown[]).forEach((t, i) => {
      trancheTotal += validateTranche(t, `stagedPlan[${i}]`, issues);
    });
  }

  // Cross-field invariants. Only checked when the parts are individually
  // valid, so the user is not told the sum is wrong when a tranche is missing.
  if (issues.length === 0) {
    const total = raw.totalShares as number;
    if (trancheTotal !== total) {
      issues.push({
        path: 'stagedPlan',
        message: `tranche shares sum to ${trancheTotal} but totalShares is ${total}`,
      });
    }

    const stop = (raw.stopLoss as Record<string, unknown>).price as number;
    const target = (raw.takeProfit as Record<string, unknown>).price as number;

    if (raw.action === 'buy' && stop >= target) {
      issues.push({
        path: 'stopLoss.price',
        message: `stop (${stop}) must be below take-profit (${target}) for a long position`,
      });
    }
    if (raw.action === 'sell' && stop <= target) {
      issues.push({
        path: 'stopLoss.price',
        message: `stop (${stop}) must be above take-profit (${target}) for a short position`,
      });
    }
  }

  if (issues.length > 0) throw new SchemaError('shadow entry', issues);

  return { ...(raw as unknown as ShadowInput), ticker: ticker as string };
}

function validatePriceLevel(raw: unknown, path: string, issues: SchemaIssue[]): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: `expected {price, reason}, got ${describe(raw)}` });
    return;
  }
  rejectUnknownKeys(raw, PRICE_LEVEL_KEYS, path, issues);
  requirePositiveNumber(raw.price, `${path}.price`, issues);
  // The reason is not decoration: /reflect reads it when judging whether an
  // exit was planned or panicked.
  requireString(raw.reason, `${path}.reason`, issues);
}

/** Validate one tranche and return its share count for the sum check. */
function validateTranche(raw: unknown, path: string, issues: SchemaIssue[]): number {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: `expected an object, got ${describe(raw)}` });
    return 0;
  }

  rejectUnknownKeys(raw, TRANCHE_KEYS, path, issues);
  requirePositiveNumber(raw.tranche, `${path}.tranche`, issues);
  requirePositiveNumber(raw.shares, `${path}.shares`, issues);
  requireString(raw.trigger, `${path}.trigger`, issues);
  requireEnum(raw.status, `${path}.status`, issues, ['pending', 'filled', 'expired'] as const);

  if (raw.triggerPrice !== undefined) {
    requirePositiveNumber(raw.triggerPrice, `${path}.triggerPrice`, issues);
  }
  if (raw.fallbackDate !== undefined) {
    requireDate(raw.fallbackDate, `${path}.fallbackDate`, issues);
  }

  // A filled tranche without a price cannot contribute to cost basis, so the
  // shadow position would be priced from the real trade instead — exactly the
  // comparison the shadow exists to avoid.
  if (raw.status === 'filled') {
    requirePositiveNumber(raw.fillPrice, `${path}.fillPrice`, issues);
    if (raw.fillDate !== undefined && raw.fillDate !== null) {
      requireDate(raw.fillDate, `${path}.fillDate`, issues);
    }
  } else {
    if (raw.fillPrice !== undefined && raw.fillPrice !== null) {
      issues.push({
        path: `${path}.fillPrice`,
        message: `must be null unless status is "filled"`,
      });
    }
  }

  return typeof raw.shares === 'number' && Number.isFinite(raw.shares) ? raw.shares : 0;
}

// ── Documentation ───────────────────────────────────────────────────────────

/** The expected thesis shape, for `--schema` and for skill authors. */
export const THESIS_SCHEMA_DOC = `{
  "ticker": "NVDA",
  "thesis": "One paragraph. The claim, not the summary.",
  "verdict": "The conditional verdict from the synthesis.",
  "conditions": [
    {
      "description": "Q2 gross margin stays above 70%",
      "type": "earnings",
      "metric": "grossMargin",
      "operator": ">",              // > < >= <= ==
      "threshold": 0.7,
      "resolveBy": "2026-08-20"     // YYYY-MM-DD
    },
    {
      "description": "No top-4 hyperscaler cuts capex guidance",
      "type": "event",
      "falsificationTest": "Any top-4 hyperscaler guides capex down >10%",
      "watchTickers": ["MSFT", "GOOGL", "AMZN", "META"]
    }
  ]
}

At least one condition is required — a thesis that cannot be falsified is not
a thesis. Each "if X then Y" in the conditional confidence map becomes one
condition.`;

/** The expected shadow-entry shape. */
export const SHADOW_SCHEMA_DOC = `{
  "ticker": "NVDA",
  "action": "buy",                  // buy | sell
  "entryDate": "2026-08-07",        // YYYY-MM-DD
  "totalShares": 50,
  "stagedPlan": [
    {
      "tranche": 1,
      "shares": 25,
      "trigger": "immediate",
      "status": "filled",           // pending | filled | expired
      "fillPrice": 845,             // required when filled, null otherwise
      "fillDate": "2026-08-07"
    },
    {
      "tranche": 2,
      "shares": 25,
      "trigger": "pullback to 800",
      "triggerPrice": 800,
      "fallbackDate": "2026-09-15",
      "status": "pending",
      "fillPrice": null,
      "fillDate": null
    }
  ],
  "stopLoss":   { "price": 720,  "reason": "Below the January consolidation low" },
  "takeProfit": { "price": 1100, "reason": "Prior resistance plus the 30% target" },
  "timeHorizon": "2026-12-31",      // YYYY-MM-DD
  "linkedThesis": "t1786...",       // thesis id, or null
  "sourceJudge": "journal/NVDA-2026-08-06.md",
  "sourceAct": "journal/act-NVDA-2026-08-07.md"
}

Tranche shares must sum to totalShares. For a buy, the stop must sit below the
take-profit. Both reasons are read by /reflect when judging whether an exit was
planned or panicked, so neither may be empty.`;
