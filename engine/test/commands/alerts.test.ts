// engine/test/commands/alerts.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { atomicWriteJSON } from '../../src/fs';
import { aggregateAlerts } from '../../src/commands/alerts';

const TEST_DIR = join(tmpdir(), `finstack-alerts-test-${Date.now()}`);

describe('aggregateAlerts', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns empty for no data files', () => {
    const result = aggregateAlerts({
      watchlistFile: join(TEST_DIR, 'watchlist.json'),
      thesesFile: join(TEST_DIR, 'theses.json'),
      dueWithinDays: 7,
    });
    expect(result).toEqual([]);
  });

  it('picks up thesis obituary due dates', () => {
    const today = new Date().toISOString().split('T')[0];
    atomicWriteJSON(join(TEST_DIR, 'theses.json'), {
      theses: [{
        id: 't1',
        ticker: 'NVDA',
        thesis: 'AI capex grows',
        status: 'dead',
        obituaryDueDate: today,
        conditions: [],
        statusHistory: [],
        createdAt: '2025-01-01',
        lastChecked: '2025-01-01',
        verdict: 'buy',
      }],
    });

    const result = aggregateAlerts({
      watchlistFile: join(TEST_DIR, 'watchlist.json'),
      thesesFile: join(TEST_DIR, 'theses.json'),
      dueWithinDays: 7,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].source).toBe('thesis');
    expect(result[0].ticker).toBe('NVDA');
  });

  it('picks up watchlist date alerts', () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    atomicWriteJSON(join(TEST_DIR, 'watchlist.json'), [{
      ticker: 'TSLA',
      addedAt: '2025-01-01',
      reason: 'test',
      tags: [],
      linkedThesis: null,
      alerts: [{ type: 'date', date: tomorrow, note: 'earnings date', triggered: false }],
    }]);

    const result = aggregateAlerts({
      watchlistFile: join(TEST_DIR, 'watchlist.json'),
      thesesFile: join(TEST_DIR, 'theses.json'),
      dueWithinDays: 7,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].source).toBe('watchlist');
    expect(result[0].ticker).toBe('TSLA');
  });

  it('picks up thesis condition resolveBy dates', () => {
    const inThreeDays = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
    atomicWriteJSON(join(TEST_DIR, 'theses.json'), {
      theses: [{
        id: 't2',
        ticker: 'AMD',
        thesis: 'test',
        verdict: 'buy',
        status: 'alive',
        obituaryDueDate: null,
        conditions: [{
          id: 'c1',
          description: 'Q2 gross margin > 20%',
          type: 'earnings',
          metric: 'grossMargin',
          operator: '>',
          threshold: 0.2,
          resolveBy: inThreeDays,
          status: 'pending',
          actualValue: null,
          resolvedAt: null,
        }],
        statusHistory: [],
        createdAt: '2025-01-01',
        lastChecked: '2025-01-01',
      }],
    });

    const result = aggregateAlerts({
      watchlistFile: join(TEST_DIR, 'watchlist.json'),
      thesesFile: join(TEST_DIR, 'theses.json'),
      dueWithinDays: 7,
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].ticker).toBe('AMD');
    expect(result[0].type).toBe('condition_resolveBy');
  });

  it('sorts by urgency: overdue > today > soon > later', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    const inFiveDays = new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0];

    atomicWriteJSON(join(TEST_DIR, 'watchlist.json'), [
      { ticker: 'LATER', addedAt: '2025-01-01', reason: '', tags: [], linkedThesis: null, alerts: [{ type: 'date', date: inFiveDays, note: 'later', triggered: false }] },
      { ticker: 'OVERDUE', addedAt: '2025-01-01', reason: '', tags: [], linkedThesis: null, alerts: [{ type: 'date', date: yesterday, note: 'overdue', triggered: false }] },
      { ticker: 'TODAY', addedAt: '2025-01-01', reason: '', tags: [], linkedThesis: null, alerts: [{ type: 'date', date: today, note: 'today', triggered: false }] },
    ]);

    const result = aggregateAlerts({
      watchlistFile: join(TEST_DIR, 'watchlist.json'),
      thesesFile: join(TEST_DIR, 'theses.json'),
      dueWithinDays: 30,
    });
    expect(result[0].ticker).toBe('OVERDUE');
    expect(result[1].ticker).toBe('TODAY');
    expect(result[2].ticker).toBe('LATER');
  });
});
