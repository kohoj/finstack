import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { registerThesis, loadTheses, killThesis } from '../../src/data/thesis';
import { formatThesisList, formatThesisHistory } from '../../src/commands/thesis';

const TEST_DIR = join(tmpdir(), '.finstack-test-thesiscmd-' + Date.now());
const TEST_FILE = join(TEST_DIR, 'theses.json');

describe('thesis commands', () => {
  beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterEach(() => { if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE); });

  it('formatThesisList produces table output', () => {
    registerThesis({
      ticker: 'NVDA', thesis: 'AI capex continues', verdict: 'lean-buy',
      conditions: [{ description: 'EPS beat', type: 'earnings', metric: 'surprisePct', operator: '>', threshold: 5, resolveBy: '2026-08-28' }],
    }, TEST_FILE);
    const data = loadTheses(TEST_FILE);
    const output = formatThesisList(data.theses);
    expect(output.length).toBe(1);
    expect(output[0].ticker).toBe('NVDA');
    expect(output[0].status).toBe('ALIVE');
    expect(output[0].conditions).toBe('1 pending');
  });

  it('formatThesisHistory produces summary', () => {
    registerThesis({ ticker: 'NVDA', thesis: 't1', verdict: 'buy', conditions: [{ description: 'x', type: 'event', falsificationTest: '?', watchTickers: [] }] }, TEST_FILE);
    registerThesis({ ticker: 'AAPL', thesis: 't2', verdict: 'buy', conditions: [{ description: 'x', type: 'event', falsificationTest: '?', watchTickers: [] }] }, TEST_FILE);
    const data = loadTheses(TEST_FILE);
    killThesis(data.theses[0].id, 'earnings miss', TEST_FILE);
    const updated = loadTheses(TEST_FILE);
    const summary = formatThesisHistory(updated.theses);
    expect(summary.total).toBe(2);
    expect(summary.alive).toBe(1);
    expect(summary.dead).toBe(1);
  });
});
