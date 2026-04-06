// engine/src/fs.ts
import { writeFileSync, readFileSync, renameSync, mkdirSync, existsSync, chmodSync } from 'fs';
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
