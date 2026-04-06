// engine/src/fs.ts
import { writeFileSync, readFileSync, renameSync, mkdirSync, existsSync, chmodSync, rmdirSync } from 'fs';
import { dirname } from 'path';

export function atomicWriteJSON(filePath: string, data: unknown, mode = 0o644): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}`;
  const json = JSON.stringify(data, null, 2);
  writeFileSync(tmp, json, { mode });
  renameSync(tmp, filePath);
  try { chmodSync(filePath, mode); } catch {}
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
 * Simple file-level mutex using mkdir (atomic on POSIX).
 * Spins up to maxWaitMs with 10ms intervals, then proceeds without lock.
 */
export function withFileLock<T>(filePath: string, fn: () => T, maxWaitMs = 2000): T {
  const lockDir = `${filePath}.lock`;
  const deadline = Date.now() + maxWaitMs;

  // Try to acquire lock
  while (Date.now() < deadline) {
    try {
      mkdirSync(lockDir);
      // Lock acquired
      try {
        return fn();
      } finally {
        try { rmdirSync(lockDir); } catch {}
      }
    } catch {
      // Lock held by another process — wait
      const wait = 10 + Math.random() * 20;
      Bun.sleepSync(wait);
    }
  }

  // Timeout — proceed without lock (stale lock or very slow operation)
  try { rmdirSync(lockDir); } catch {}
  return fn();
}
