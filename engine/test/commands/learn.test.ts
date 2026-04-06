import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { appendLearning, loadLearnings, searchLearnings, recentLearnings } from '../../src/data/learnings';

const TEST_DIR = join(tmpdir(), `finstack-learn-test-${Date.now()}`);
const TEST_FILE = join(TEST_DIR, 'learnings.jsonl');

describe('learnings', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns empty for missing file', () => {
    expect(loadLearnings(TEST_FILE)).toEqual([]);
  });

  it('appends and loads a learning', () => {
    appendLearning({ skill: 'sense', type: 'error', summary: 'Yahoo crumb expired', detail: '', tags: [] }, TEST_FILE);
    const all = loadLearnings(TEST_FILE);
    expect(all).toHaveLength(1);
    expect(all[0].skill).toBe('sense');
    expect(all[0].summary).toBe('Yahoo crumb expired');
    expect(all[0].id).toStartWith('l');
  });

  it('appends multiple learnings', () => {
    appendLearning({ skill: 'sense', type: 'error', summary: 'first', detail: '', tags: [] }, TEST_FILE);
    appendLearning({ skill: 'judge', type: 'insight', summary: 'second', detail: '', tags: [] }, TEST_FILE);
    expect(loadLearnings(TEST_FILE)).toHaveLength(2);
  });

  it('searches by keyword', () => {
    appendLearning({ skill: 'sense', type: 'error', summary: 'Yahoo crumb expired', detail: '', tags: [] }, TEST_FILE);
    appendLearning({ skill: 'judge', type: 'insight', summary: 'Good bull/bear balance', detail: '', tags: [] }, TEST_FILE);
    const results = searchLearnings({ keyword: 'yahoo', file: TEST_FILE });
    expect(results).toHaveLength(1);
    expect(results[0].summary).toContain('Yahoo');
  });

  it('searches by skill', () => {
    appendLearning({ skill: 'sense', type: 'error', summary: 'first', detail: '', tags: [] }, TEST_FILE);
    appendLearning({ skill: 'judge', type: 'insight', summary: 'second', detail: '', tags: [] }, TEST_FILE);
    const results = searchLearnings({ skill: 'sense', file: TEST_FILE });
    expect(results).toHaveLength(1);
  });

  it('returns most recent first', () => {
    appendLearning({ skill: 'sense', type: 'error', summary: 'older', detail: '', tags: [] }, TEST_FILE);
    appendLearning({ skill: 'sense', type: 'error', summary: 'newer', detail: '', tags: [] }, TEST_FILE);
    const results = recentLearnings({ limit: 2, file: TEST_FILE });
    expect(results[0].summary).toBe('newer');
  });

  it('respects limit', () => {
    for (let i = 0; i < 5; i++) {
      appendLearning({ skill: 'sense', type: 'error', summary: `item ${i}`, detail: '', tags: [] }, TEST_FILE);
    }
    expect(recentLearnings({ limit: 3, file: TEST_FILE })).toHaveLength(3);
  });
});
