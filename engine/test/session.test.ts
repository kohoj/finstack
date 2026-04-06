import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), `finstack-session-test-${Date.now()}`);
const SESSION_DIR = join(TEST_DIR, 'sessions');

// Set env before import
process.env.FINSTACK_HOME = TEST_DIR;

import { registerSession, getActiveSessions, cleanStaleSessions, unregisterSession } from '../src/session';

describe('session tracking', () => {
  beforeEach(() => {
    // Clean up test directory if it exists
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(SESSION_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('registers a session', () => {
    registerSession('sense');
    const sessions = getActiveSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    const ours = sessions.find(s => s.ppid === process.ppid);
    expect(ours).toBeDefined();
    expect(ours!.skill).toBe('sense');
  });

  it('returns empty when no sessions', () => {
    const sessions = getActiveSessions();
    expect(sessions).toEqual([]);
  });

  it('cleans stale sessions', () => {
    // Write a stale session (3 hours old)
    const staleTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      join(SESSION_DIR, '99999.json'),
      JSON.stringify({ pid: 99999, ppid: 99999, skill: 'old', startedAt: staleTime })
    );

    const cleaned = cleanStaleSessions();
    expect(cleaned).toBe(1);

    const sessions = getActiveSessions();
    expect(sessions.find(s => s.ppid === 99999)).toBeUndefined();
  });

  it('unregisters current session', () => {
    registerSession('judge');
    unregisterSession();
    const sessions = getActiveSessions();
    const ours = sessions.find(s => s.ppid === process.ppid);
    expect(ours).toBeUndefined();
  });

  it('handles corrupt session files', () => {
    writeFileSync(join(SESSION_DIR, 'corrupt.json'), 'not json{{{');
    const cleaned = cleanStaleSessions();
    expect(cleaned).toBe(1);
  });
});
