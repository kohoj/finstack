// engine/test/fs.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWriteJSON, readJSONSafe, withFileLock } from '../src/fs';

const TEST_DIR = join(tmpdir(), `finstack-fs-test-${Date.now()}`);

describe('atomicWriteJSON', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('writes valid JSON to file', () => {
    const file = join(TEST_DIR, 'test.json');
    atomicWriteJSON(file, { hello: 'world' });
    const content = JSON.parse(readFileSync(file, 'utf-8'));
    expect(content).toEqual({ hello: 'world' });
  });

  it('creates parent directories if needed', () => {
    const file = join(TEST_DIR, 'sub', 'dir', 'test.json');
    atomicWriteJSON(file, { nested: true });
    expect(existsSync(file)).toBe(true);
  });

  it('does not leave tmp files on success', () => {
    const file = join(TEST_DIR, 'clean.json');
    atomicWriteJSON(file, { clean: true });
    const files = readdirSync(TEST_DIR);
    expect(files.filter((f: string) => f.includes('.tmp.'))).toHaveLength(0);
  });

  it('overwrites existing file atomically', () => {
    const file = join(TEST_DIR, 'overwrite.json');
    atomicWriteJSON(file, { version: 1 });
    atomicWriteJSON(file, { version: 2 });
    const content = JSON.parse(readFileSync(file, 'utf-8'));
    expect(content).toEqual({ version: 2 });
  });

  it('uses 0o600 mode for sensitive files', () => {
    const file = join(TEST_DIR, 'keys.json');
    atomicWriteJSON(file, { secret: 'abc' }, 0o600);
    const stat = statSync(file);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('uses 0o644 mode by default', () => {
    const file = join(TEST_DIR, 'normal.json');
    atomicWriteJSON(file, { public: true });
    const stat = statSync(file);
    expect(stat.mode & 0o777).toBe(0o644);
  });
});

describe('readJSONSafe', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('reads valid JSON file', () => {
    const file = join(TEST_DIR, 'valid.json');
    atomicWriteJSON(file, { data: 42 });
    const result = readJSONSafe(file, { data: 0 });
    expect(result).toEqual({ data: 42 });
  });

  it('returns fallback for missing file', () => {
    const result = readJSONSafe(join(TEST_DIR, 'missing.json'), { fallback: true });
    expect(result).toEqual({ fallback: true });
  });

  it('returns fallback for corrupted JSON', () => {
    const file = join(TEST_DIR, 'corrupt.json');
    writeFileSync(file, 'not json{{{');
    const result = readJSONSafe(file, []);
    expect(result).toEqual([]);
  });
});

describe('withFileLock', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns the callback result', () => {
    const file = join(TEST_DIR, 'locked.json');
    expect(withFileLock(file, () => 42)).toBe(42);
  });

  it('releases the lock after a successful call', () => {
    const file = join(TEST_DIR, 'locked.json');
    withFileLock(file, () => 'ok');
    expect(existsSync(`${file}.lock`)).toBe(false);
  });

  // Regression: the original implementation wrapped mkdir and fn() in one try,
  // so a throw from fn() was indistinguishable from lock contention. The loop
  // retried, calling fn() once per attempt until the deadline — running a
  // side-effecting mutation many times before finally surfacing the error.
  it('runs the callback exactly once when it throws', () => {
    const file = join(TEST_DIR, 'locked.json');
    let calls = 0;

    expect(() =>
      withFileLock(
        file,
        () => {
          calls++;
          throw new Error('business failure');
        },
        300,
      ),
    ).toThrow('business failure');

    expect(calls).toBe(1);
  });

  it('releases the lock when the callback throws', () => {
    const file = join(TEST_DIR, 'locked.json');
    expect(() =>
      withFileLock(file, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(existsSync(`${file}.lock`)).toBe(false);
  });

  it('breaks a stale lock rather than hanging forever', () => {
    const file = join(TEST_DIR, 'locked.json');
    // Simulate a lock left behind by a killed process.
    mkdirSync(`${file}.lock`);

    const start = Date.now();
    const result = withFileLock(file, () => 'recovered', 200);
    const elapsed = Date.now() - start;

    expect(result).toBe('recovered');
    // Waited for the deadline, then proceeded — did not block indefinitely.
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(2000);
  });
});
