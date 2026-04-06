/**
 * E2E Skill Smoke Tests
 *
 * These tests run actual Claude Code sessions to verify skills work end-to-end.
 * Only run when EVALS=1 is set (expensive — uses Claude API).
 *
 * Usage: EVALS=1 bun test test/skill-e2e/
 */
import { describe, it, expect } from 'bun:test';
import { runSkill, shouldRunE2E } from './runner';
import { join } from 'path';

const FIXTURES = join(import.meta.dir, 'fixtures');
const TIMEOUT = 5 * 60 * 1000; // 5 minutes per skill

describe.skipIf(!shouldRunE2E())('E2E Skill Tests', () => {

  it('/sense reads portfolio and watchlist', async () => {
    const result = await runSkill('sense', '', { fixturesDir: FIXTURES, timeout: TIMEOUT });
    expect(result.success).toBe(true);
    // /sense should call engine commands for portfolio data
    expect(result.transcript.length).toBeGreaterThan(100);
  }, TIMEOUT + 10_000);

  it('/screen runs with preset', async () => {
    const result = await runSkill('screen', '--preset growth --limit 3', {
      fixturesDir: FIXTURES,
      timeout: TIMEOUT,
    });
    expect(result.success).toBe(true);
    expect(result.transcript.length).toBeGreaterThan(50);
  }, TIMEOUT + 10_000);

  it('/review generates weekly summary', async () => {
    const result = await runSkill('review', '--period week', {
      fixturesDir: FIXTURES,
      timeout: TIMEOUT,
    });
    expect(result.success).toBe(true);
  }, TIMEOUT + 10_000);

});

// This test always runs — validates the runner itself without calling Claude
describe('E2E Runner', () => {
  it('shouldRunE2E returns false by default', () => {
    // EVALS is not set in normal test runs
    const original = process.env.EVALS;
    delete process.env.EVALS;
    expect(shouldRunE2E()).toBe(false);
    if (original) process.env.EVALS = original;
  });

  it('runSkill handles missing claude binary gracefully', async () => {
    // If claude isn't installed, the runner should not crash
    const result = await runSkill('nonexistent', '', { timeout: 5000 });
    // Either fails gracefully or succeeds (if claude is installed)
    expect(typeof result.success).toBe('boolean');
    expect(typeof result.duration).toBe('number');
  }, 10_000);
});
