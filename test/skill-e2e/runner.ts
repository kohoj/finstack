#!/usr/bin/env bun
/**
 * E2E Skill Test Runner
 *
 * Executes finstack skills via `claude -p` and validates the output.
 * Runs only when EVALS=1 is set (expensive — uses Claude API).
 *
 * Usage:
 *   EVALS=1 bun test test/skill-e2e/
 */

import { spawn } from 'child_process';
import { mkdirSync, cpSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface SkillResult {
  success: boolean;
  transcript: string;
  toolCalls: string[];
  engineCommands: string[];
  duration: number;
  exitCode: number | null;
}

/**
 * Run a finstack skill via claude -p and capture the output.
 */
export async function runSkill(
  skillName: string,
  prompt: string,
  opts: {
    timeout?: number;
    fixturesDir?: string;
  } = {},
): Promise<SkillResult> {
  const { timeout = 300_000, fixturesDir } = opts;

  // Create isolated test data directory
  const testHome = join(tmpdir(), `finstack-e2e-${Date.now()}`);
  mkdirSync(testHome, { recursive: true });
  mkdirSync(join(testHome, 'journal'), { recursive: true });
  mkdirSync(join(testHome, 'patterns'), { recursive: true });
  mkdirSync(join(testHome, 'cache'), { recursive: true });

  // Copy fixtures if provided
  if (fixturesDir && existsSync(fixturesDir)) {
    const files = ['portfolio.json', 'watchlist.json', 'theses.json', 'shadow.json', 'consensus.json', 'profile.json'];
    for (const file of files) {
      const src = join(fixturesDir, file);
      if (existsSync(src)) {
        cpSync(src, join(testHome, file));
      }
    }
  }

  const startTime = Date.now();

  return new Promise<SkillResult>((resolve) => {
    const fullPrompt = prompt ? `/${skillName} ${prompt}` : `/${skillName}`;

    const proc = spawn('claude', ['-p', fullPrompt], {
      env: {
        ...process.env,
        FINSTACK_HOME: testHome,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      const duration = Date.now() - startTime;

      // Extract engine commands from transcript
      const engineCommands: string[] = [];
      const cmdRegex = /\$F\s+(\w+)/g;
      let match;
      while ((match = cmdRegex.exec(stdout)) !== null) {
        engineCommands.push(match[1]);
      }

      // Extract tool calls (Bash commands that invoke finstack)
      const toolCalls: string[] = [];
      const toolRegex = /finstack\s+(\w+)/g;
      while ((match = toolRegex.exec(stdout)) !== null) {
        toolCalls.push(match[1]);
      }

      // Clean up test directory
      try { rmSync(testHome, { recursive: true, force: true }); } catch {}

      resolve({
        success: code === 0,
        transcript: stdout + stderr,
        toolCalls: [...new Set(toolCalls)],
        engineCommands: [...new Set(engineCommands)],
        duration,
        exitCode: code,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      try { rmSync(testHome, { recursive: true, force: true }); } catch {}
      resolve({
        success: false,
        transcript: `Process error: ${err.message}`,
        toolCalls: [],
        engineCommands: [],
        duration: Date.now() - startTime,
        exitCode: null,
      });
    });
  });
}

/**
 * Check if E2E tests should run.
 */
export function shouldRunE2E(): boolean {
  return process.env.EVALS === '1';
}
