/**
 * Error contract tests.
 *
 * Every command must fail the same way: a single JSON object on stderr with
 * an `error` field, and a non-zero exit code. Skills parse this to decide
 * whether to degrade (e.g. /sense skips FRED when `suggestion` says a key is
 * missing), so the shape is a real interface, not just cosmetics.
 *
 * These run the compiled CLI as a subprocess because the contract is about
 * process-level behavior (stderr + exit code), which unit-testing the exported
 * function cannot observe.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dir, '..', 'src', 'cli.ts');
const TEST_HOME = join(tmpdir(), `finstack-error-contract-${Date.now()}`);

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function run(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(['bun', 'run', CLI, ...args], {
    env: { ...process.env, FINSTACK_HOME: TEST_HOME },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

beforeAll(() => {
  mkdirSync(join(TEST_HOME, 'cache'), { recursive: true });
});

afterAll(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('error contract', () => {
  // Each case triggers a failure that needs no network, so the suite stays
  // fast and deterministic offline.
  const cases: { name: string; args: string[] }[] = [
    { name: 'unknown command', args: ['definitely-not-a-command'] },
    { name: 'filing without ticker', args: ['filing'] },
    { name: 'scan with invalid source', args: ['scan', '--source', 'nonsense'] },
    { name: 'calendar with non-numeric range', args: ['calendar', '--range', 'abc'] },
    { name: 'calendar with negative range', args: ['calendar', '--range', '-5'] },
    { name: 'quote without ticker', args: ['quote'] },
    { name: 'financials without ticker', args: ['financials'] },
    { name: 'earnings without ticker', args: ['earnings'] },
    { name: 'history without ticker', args: ['history'] },
    { name: 'screen without filters', args: ['screen'] },
    { name: 'portfolio add without args', args: ['portfolio', 'add'] },
    { name: 'portfolio add with negative shares', args: ['portfolio', 'add', 'NVDA', '-5', '100'] },
    { name: 'portfolio add with zero cost', args: ['portfolio', 'add', 'NVDA', '10', '0'] },
    { name: 'portfolio remove without ticker', args: ['portfolio', 'remove'] },
    { name: 'watchlist add without ticker', args: ['watchlist', 'add'] },
    { name: 'watchlist tag without args', args: ['watchlist', 'tag'] },
    { name: 'watchlist tag on unwatched ticker', args: ['watchlist', 'tag', 'NVDA', 'ai'] },
    { name: 'watchlist untag without args', args: ['watchlist', 'untag'] },
    { name: 'watchlist unknown subcommand', args: ['watchlist', 'bogus'] },
    { name: 'regime add without text', args: ['regime', 'add'] },
    { name: 'regime update without args', args: ['regime', 'update'] },
    { name: 'keys set without args', args: ['keys', 'set'] },
    { name: 'keys set with unknown provider', args: ['keys', 'set', 'bogusprovider', 'k'] },
    { name: 'keys remove without provider', args: ['keys', 'remove'] },
    { name: 'keys unknown subcommand', args: ['keys', 'bogus'] },
    { name: 'learn add without summary', args: ['learn', 'add'] },
    { name: 'learn add with invalid type', args: ['learn', 'add', 'x', '--type', 'bogus'] },
    { name: 'learn recent with invalid limit', args: ['learn', 'recent', '--limit', 'abc'] },
    { name: 'learn unknown subcommand', args: ['learn', 'bogus'] },
    { name: 'risk size without args', args: ['risk', 'size'] },
    { name: 'risk size with non-numeric price', args: ['risk', 'size', 'NVDA', 'abc', 'def'] },
    { name: 'risk size with stop above entry', args: ['risk', 'size', 'NVDA', '100', '120'] },
    { name: 'thesis kill without id', args: ['thesis', 'kill'] },
    { name: 'thesis kill unknown id', args: ['thesis', 'kill', 'nonexistent'] },
    { name: 'thesis unknown subcommand', args: ['thesis', 'bogus'] },
    { name: 'backtest with unknown thesis', args: ['backtest', '--thesis', 'nonexistent'] },
    { name: 'scenario with unknown name', args: ['scenario', 'not-a-scenario'] },
    { name: 'scenario custom without factors', args: ['scenario', 'custom'] },
    { name: 'scenario custom with bad JSON', args: ['scenario', 'custom', '--factors', '{bad'] },
    {
      name: 'scenario custom with array factors',
      args: ['scenario', 'custom', '--factors', '[1]'],
    },
    { name: 'report without type', args: ['report'] },
    { name: 'report with unknown type', args: ['report', 'bogus'] },
  ];

  for (const { name, args } of cases) {
    it(`${name}: exits non-zero with parseable JSON on stderr`, async () => {
      const { stderr, exitCode } = await run(args);

      expect(exitCode).not.toBe(0);
      expect(stderr.trim()).not.toBe('');

      // The last non-empty stderr line is the error payload. Bun may emit
      // its own diagnostics before it, so we do not assume stderr is only JSON.
      const lastLine = stderr.trim().split('\n').filter(Boolean).pop() as string;
      const parsed = JSON.parse(lastLine);

      expect(parsed).toHaveProperty('error');
      expect(typeof parsed.error).toBe('string');
      expect(parsed.error.length).toBeGreaterThan(0);
    });
  }

  it('does not leak stack traces or file paths', async () => {
    const { stderr } = await run(['filing']);
    const lastLine = stderr.trim().split('\n').filter(Boolean).pop() as string;

    expect(lastLine).not.toContain('.ts:');
    expect(lastLine).not.toContain('node_modules');
    expect(lastLine).not.toMatch(/\s+at\s+/);
  });

  it('includes an actionable suggestion where one applies', async () => {
    const { stderr } = await run(['filing']);
    const lastLine = stderr.trim().split('\n').filter(Boolean).pop() as string;
    const parsed = JSON.parse(lastLine);

    expect(parsed.suggestion).toBeDefined();
    expect(typeof parsed.suggestion).toBe('string');
  });

  it('unknown command suggests the help entry point', async () => {
    const { stderr } = await run(['definitely-not-a-command']);
    const lastLine = stderr.trim().split('\n').filter(Boolean).pop() as string;
    const parsed = JSON.parse(lastLine);

    expect(parsed.suggestion).toContain('help');
  });
});

describe('success contract', () => {
  it('help exits zero and writes to stdout', async () => {
    const { stdout, exitCode } = await run(['help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Commands:');
  });

  it('bare invocation exits non-zero but still prints usage', async () => {
    const { stdout, exitCode } = await run([]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('Commands:');
  });
});
