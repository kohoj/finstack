// engine/src/fs.ts
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

export function atomicWriteJSON(filePath: string, data: unknown, mode = 0o644): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  const json = JSON.stringify(data, null, 2);
  writeFileSync(tmp, json, { mode });
  renameSync(tmp, filePath);
  try {
    chmodSync(filePath, mode);
  } catch {}
}

export function readJSONSafe<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

/**
 * File-level mutex built on mkdir, which is atomic on POSIX.
 *
 * Serializes read-modify-write cycles on a shared JSON file. Callers must run
 * the *whole* cycle inside `fn` — locking only the write still loses updates,
 * because the race is between the read and the write.
 *
 * On timeout the lock is broken and `fn` runs anyway. That is deliberate: a
 * stale lock (left by a killed process) must not wedge the CLI forever. The
 * window is bounded by maxWaitMs and losing an update is preferable to
 * refusing to run.
 */
export function withFileLock<T>(filePath: string, fn: () => T, maxWaitMs = 2000): T {
  const lockDir = `${filePath}.lock`;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    let acquired = false;
    try {
      mkdirSync(lockDir);
      acquired = true;
    } catch {
      // Held by another process — back off and retry.
      // Jittered so that several waiters do not wake in lockstep.
      Bun.sleepSync(10 + Math.random() * 20);
      continue;
    }

    // Acquired. Any throw from here is the caller's, not a lock failure, so it
    // must propagate rather than be mistaken for contention and retried.
    try {
      return fn();
    } finally {
      if (acquired) {
        try {
          rmdirSync(lockDir);
        } catch {}
      }
    }
  }

  // Timed out. Assume the lock is stale, clear it, and proceed unlocked.
  try {
    rmdirSync(lockDir);
  } catch {}
  return fn();
}
