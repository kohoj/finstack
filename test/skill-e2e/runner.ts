#!/usr/bin/env bun
/**
 * E2E skill runner.
 *
 * Drives real skills through `codex exec` against fixture data and reports what
 * happened — which engine commands ran, what was written to FINSTACK_HOME, and
 * what the model said.
 *
 * Gated behind EVALS=1 because every run costs API calls:
 *   EVALS=1 bun test test/skill-e2e/
 *
 * What these tests assert, and what they deliberately do not: the target is the
 * structural contract — the commands a skill invokes, the files it writes, the
 * markers its output format requires. Asserting on the prose itself would be
 * flaky without testing anything the prose is supposed to guarantee. A skill
 * that writes a well-formed journal entry containing bad analysis is a
 * reasoning bug, not something a string match can catch.
 */

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** State files a fixture directory may provide. */
const FIXTURE_FILES = [
  'portfolio.json',
  'watchlist.json',
  'theses.json',
  'shadow.json',
  'consensus.json',
  'profile.json',
] as const;

export interface SkillResult {
  success: boolean;
  transcript: string;
  /** Engine commands seen in the transcript, deduplicated. */
  engineCommands: string[];
  duration: number;
  exitCode: number | null;
  /**
   * The test home, still on disk. The caller owns it and must call cleanup().
   * Kept alive so tests can assert on what the skill wrote — the previous
   * runner deleted it before returning, which made file assertions impossible.
   */
  home: string;
  cleanup: () => void;
  /** Files under journal/, relative to the home. */
  journalFiles: string[];
  /** Read a file from the test home, or null if absent. */
  readHomeFile: (relativePath: string) => string | null;
}

function listJournal(home: string): string[] {
  const dir = join(home, 'journal');
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export async function runSkill(
  /** Names the temp home and the case; does not select the skill. */
  skillName: string,
  /** What the user says. The host decides which skill applies. */
  prompt: string,
  opts: { timeout?: number; fixturesDir?: string } = {},
): Promise<SkillResult> {
  const { timeout = 300_000, fixturesDir } = opts;

  const home = join(tmpdir(), `finstack-e2e-${skillName}-${Date.now()}`);
  for (const sub of ['journal', 'patterns', 'cache', 'reports', 'sessions']) {
    mkdirSync(join(home, sub), { recursive: true });
  }

  if (fixturesDir && existsSync(fixturesDir)) {
    for (const file of FIXTURE_FILES) {
      const src = join(fixturesDir, file);
      if (existsSync(src)) cpSync(src, join(home, file));
    }
  }

  const cleanup = () => {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {}
  };

  const readHomeFile = (relativePath: string): string | null => {
    const file = join(home, relativePath);
    if (!existsSync(file)) return null;
    try {
      return readFileSync(file, 'utf-8');
    } catch {
      return null;
    }
  };

  const startTime = Date.now();

  return new Promise<SkillResult>(resolve => {
    // Codex skills are model-invoked: there is no slash syntax to force one.
    // The prompt has to read like something a user would actually say, and
    // whether the right skill fires is part of what is being tested.
    const proc = spawn('codex', ['exec', '--skip-git-repo-check', prompt], {
      env: { ...process.env, FINSTACK_HOME: home },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => {
      stdout += d.toString();
    });
    proc.stderr.on('data', d => {
      stderr += d.toString();
    });

    const timer = setTimeout(() => proc.kill('SIGTERM'), timeout);

    proc.on('close', code => {
      clearTimeout(timer);

      // Both spellings appear: `$F quote` in the skill text, `finstack quote`
      // when the model writes the command out in full.
      const commands = new Set<string>();
      for (const m of stdout.matchAll(/\$F\s+(\w+)/g)) commands.add(m[1]);
      for (const m of stdout.matchAll(/\bfinstack\s+(\w+)/g)) {
        if (m[1] !== 'help') commands.add(m[1]);
      }

      resolve({
        success: code === 0,
        transcript: stdout + stderr,
        engineCommands: [...commands].sort(),
        duration: Date.now() - startTime,
        exitCode: code,
        home,
        cleanup,
        journalFiles: listJournal(home),
        readHomeFile,
      });
    });

    proc.on('error', err => {
      clearTimeout(timer);
      resolve({
        success: false,
        transcript: `Process error: ${err.message}`,
        engineCommands: [],
        duration: Date.now() - startTime,
        exitCode: null,
        home,
        cleanup,
        journalFiles: [],
        readHomeFile,
      });
    });
  });
}

export function shouldRunE2E(): boolean {
  return process.env.EVALS === '1';
}

/** True when the `codex` CLI is on PATH — E2E cannot run without it. */
export function codexAvailable(): boolean {
  try {
    return Bun.spawnSync(['which', 'codex']).exitCode === 0;
  } catch {
    return false;
  }
}
