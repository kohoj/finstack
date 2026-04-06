import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { atomicWriteJSON } from '../../src/fs';
import { aggregateReview } from '../../src/commands/review-cmd';

const TEST_DIR = join(tmpdir(), `finstack-review-test-${Date.now()}`);

describe('aggregateReview', () => {
  beforeEach(() => {
    mkdirSync(join(TEST_DIR, 'journal'), { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns zeros for empty state', () => {
    const result = aggregateReview({
      from: '2026-04-01',
      to: '2026-04-07',
      thesesFile: join(TEST_DIR, 'theses.json'),
      journalDir: join(TEST_DIR, 'journal'),
    });
    expect(result.decisions.newTheses).toBe(0);
    expect(result.decisions.closedTheses).toBe(0);
    expect(result.journalEntries).toBe(0);
  });

  it('counts new theses in period', () => {
    atomicWriteJSON(join(TEST_DIR, 'theses.json'), {
      theses: [
        { id: 't1', ticker: 'NVDA', status: 'alive', createdAt: '2026-04-03T10:00:00Z', conditions: [], statusHistory: [], thesis: '', verdict: '', lastChecked: '', obituaryDueDate: null },
        { id: 't2', ticker: 'AMD', status: 'alive', createdAt: '2026-03-15T10:00:00Z', conditions: [], statusHistory: [], thesis: '', verdict: '', lastChecked: '', obituaryDueDate: null },
      ],
    });

    const result = aggregateReview({
      from: '2026-04-01',
      to: '2026-04-07',
      thesesFile: join(TEST_DIR, 'theses.json'),
      journalDir: join(TEST_DIR, 'journal'),
    });
    expect(result.decisions.newTheses).toBe(1); // only t1 is in range
  });

  it('counts journal entries in period', () => {
    writeFileSync(join(TEST_DIR, 'journal', 'sense-2026-04-03.md'), '# Sense');
    writeFileSync(join(TEST_DIR, 'journal', 'NVDA-2026-04-05.md'), '# Judge NVDA');
    writeFileSync(join(TEST_DIR, 'journal', 'sense-2026-03-20.md'), '# Old'); // out of range

    const result = aggregateReview({
      from: '2026-04-01',
      to: '2026-04-07',
      thesesFile: join(TEST_DIR, 'theses.json'),
      journalDir: join(TEST_DIR, 'journal'),
    });
    expect(result.journalEntries).toBe(2);
    expect(result.journalByType['sense']).toBe(1);
    expect(result.journalByType['NVDA']).toBe(1);
  });

  it('sets period correctly', () => {
    const result = aggregateReview({
      from: '2026-04-01',
      to: '2026-04-07',
      thesesFile: join(TEST_DIR, 'theses.json'),
      journalDir: join(TEST_DIR, 'journal'),
    });
    expect(result.period.from).toBe('2026-04-01');
    expect(result.period.to).toBe('2026-04-07');
  });
});
