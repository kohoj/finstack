// engine/test/data/profile.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProfile, setRiskBudget } from '../../src/data/profile';

// Bind to a private file, like equity.test.ts, rather than the env-derived
// paths.PROFILE_FILE: a concurrently scheduled sibling test can repoint
// FINSTACK_HOME mid-test, so sharing the env path leaks state across tests.
const TEST_DIR = join(tmpdir(), `.finstack-test-profile-${Date.now()}`);
const FILE = join(TEST_DIR, 'profile.json');

describe('risk profile', () => {
  beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterEach(() => {
    if (existsSync(FILE)) unlinkSync(FILE);
  });

  it('defaults to a 2% risk budget when no file exists', () => {
    expect(loadProfile(FILE).riskBudgetPct).toBe(2);
  });

  it('persists a set budget and reads it back', () => {
    const updated = setRiskBudget(3.5, FILE);
    expect(updated.riskBudgetPct).toBe(3.5);
    expect(updated.updatedAt).not.toBe('');
    // A fresh load sees the persisted value, not the default.
    expect(loadProfile(FILE).riskBudgetPct).toBe(3.5);
  });

  it('rejects a non-positive budget', () => {
    expect(() => setRiskBudget(0, FILE)).toThrow(/between 0 and 100/);
    expect(() => setRiskBudget(-1, FILE)).toThrow(/between 0 and 100/);
  });

  it('rejects a budget above 100%', () => {
    expect(() => setRiskBudget(150, FILE)).toThrow(/between 0 and 100/);
  });

  it('treats a stored non-positive budget as unset', () => {
    // A hand-edited or corrupt file must not disable sizing: zero is meaningless
    // as a risk budget, so it falls back to the default rather than being obeyed.
    setRiskBudget(4, FILE);
    Bun.write(FILE, JSON.stringify({ riskBudgetPct: 0, updatedAt: 'x' }));
    expect(loadProfile(FILE).riskBudgetPct).toBe(2);
  });

  it('does not pollute the default across loads', () => {
    // readJSONSafe returns its fallback by reference; a shared constant would
    // carry a mutation into the next caller. Two independent loads of a missing
    // file must both be the pristine default.
    const a = loadProfile(FILE);
    a.riskBudgetPct = 99;
    expect(loadProfile(FILE).riskBudgetPct).toBe(2);
  });
});
