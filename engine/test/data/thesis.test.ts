import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), '.finstack-test-thesis-' + Date.now());
const TEST_FILE = join(TEST_DIR, 'theses.json');

describe('thesis data', () => {
  beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterEach(() => { if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE); });

  it('registers a thesis', () => {
    const { registerThesis, loadTheses } = require('../../src/data/thesis');
    registerThesis({
      ticker: 'NVDA',
      thesis: 'AI capex continues',
      verdict: 'lean-buy',
      conditions: [
        { description: 'Q2 EPS beats by >5%', type: 'earnings', metric: 'surprisePct', operator: '>', threshold: 5, resolveBy: '2026-08-28' },
        { description: 'No cloud capex cuts', type: 'event', falsificationTest: 'Is a top-4 cloud provider cutting AI capex >10%?', watchTickers: ['MSFT', 'GOOGL'] },
      ],
    }, TEST_FILE);
    const data = loadTheses(TEST_FILE);
    expect(data.theses.length).toBe(1);
    expect(data.theses[0].ticker).toBe('NVDA');
    expect(data.theses[0].status).toBe('alive');
    expect(data.theses[0].conditions.length).toBe(2);
    expect(data.theses[0].conditions[0].status).toBe('pending');
    expect(data.theses[0].statusHistory.length).toBe(1);
  });

  it('transitions thesis state', () => {
    const { registerThesis, transitionThesis, loadTheses } = require('../../src/data/thesis');
    registerThesis({
      ticker: 'NVDA', thesis: 'test', verdict: 'buy',
      conditions: [{ description: 'test', type: 'event', falsificationTest: 'test?', watchTickers: [] }],
    }, TEST_FILE);
    const data = loadTheses(TEST_FILE);
    const id = data.theses[0].id;

    transitionThesis(id, 'threatened', 'MSFT cut capex', TEST_FILE);
    const updated = loadTheses(TEST_FILE);
    expect(updated.theses[0].status).toBe('threatened');
    expect(updated.theses[0].statusHistory.length).toBe(2);
  });

  it('kills a thesis and sets obituary date', () => {
    const { registerThesis, killThesis, loadTheses } = require('../../src/data/thesis');
    registerThesis({
      ticker: 'AAPL', thesis: 'test', verdict: 'buy',
      conditions: [{ description: 'test', type: 'event', falsificationTest: 'test?', watchTickers: [] }],
    }, TEST_FILE);
    const data = loadTheses(TEST_FILE);
    const id = data.theses[0].id;

    killThesis(id, 'CPM declining', TEST_FILE);
    const updated = loadTheses(TEST_FILE);
    expect(updated.theses[0].status).toBe('dead');
    expect(updated.theses[0].obituaryDueDate).toBeDefined();
  });

  it('adds a threat to event condition', () => {
    const { registerThesis, addThreat, loadTheses } = require('../../src/data/thesis');
    registerThesis({
      ticker: 'NVDA', thesis: 'test', verdict: 'buy',
      conditions: [{ description: 'no cuts', type: 'event', falsificationTest: 'test?', watchTickers: ['MSFT'] }],
    }, TEST_FILE);
    const data = loadTheses(TEST_FILE);
    const thesisId = data.theses[0].id;
    const condId = data.theses[0].conditions[0].id;

    addThreat(thesisId, condId, {
      date: '2026-04-15',
      source: 'MSFT delays data centers',
      confidence: 'high',
      reasoning: 'Direct capex reduction',
    }, TEST_FILE);

    const updated = loadTheses(TEST_FILE);
    expect(updated.theses[0].conditions[0].threats.length).toBe(1);
  });

  it('getAlive returns only alive and threatened theses', () => {
    const { registerThesis, killThesis, getAlive, loadTheses } = require('../../src/data/thesis');
    registerThesis({ ticker: 'NVDA', thesis: 't1', verdict: 'buy', conditions: [{ description: 'x', type: 'event', falsificationTest: '?', watchTickers: [] }] }, TEST_FILE);
    registerThesis({ ticker: 'AAPL', thesis: 't2', verdict: 'buy', conditions: [{ description: 'x', type: 'event', falsificationTest: '?', watchTickers: [] }] }, TEST_FILE);
    const data = loadTheses(TEST_FILE);
    killThesis(data.theses[0].id, 'dead', TEST_FILE);

    const alive = getAlive(TEST_FILE);
    expect(alive.length).toBe(1);
    expect(alive[0].ticker).toBe('AAPL');
  });
});
