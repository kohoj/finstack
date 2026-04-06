import { existsSync, readdirSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { atomicWriteJSON, readJSONSafe } from './fs';
import { homedir } from 'os';

const getSessionDir = () => join(process.env.FINSTACK_HOME || join(homedir(), '.finstack'), 'sessions');
const SESSION_TTL = 2 * 60 * 60 * 1000; // 2 hours

interface SessionInfo {
  pid: number;
  ppid: number;
  skill: string;
  startedAt: string;
}

export function registerSession(skill: string): void {
  mkdirSync(getSessionDir(), { recursive: true });
  const file = join(getSessionDir(), `${process.ppid}.json`);
  atomicWriteJSON(file, {
    pid: process.pid,
    ppid: process.ppid,
    skill,
    startedAt: new Date().toISOString(),
  });
}

export function getActiveSessions(): SessionInfo[] {
  if (!existsSync(getSessionDir())) return [];

  const now = Date.now();
  const sessions: SessionInfo[] = [];

  try {
    const files = readdirSync(getSessionDir()).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const filePath = join(getSessionDir(), file);
      const session = readJSONSafe<SessionInfo>(filePath, null as any);
      if (!session) continue;

      const age = now - new Date(session.startedAt).getTime();
      if (age > SESSION_TTL) {
        // Stale session, clean up
        try { unlinkSync(filePath); } catch {}
        continue;
      }

      sessions.push(session);
    }
  } catch {}

  return sessions;
}

export function cleanStaleSessions(): number {
  if (!existsSync(getSessionDir())) return 0;

  const now = Date.now();
  let cleaned = 0;

  try {
    const files = readdirSync(getSessionDir()).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const filePath = join(getSessionDir(), file);
      const session = readJSONSafe<SessionInfo>(filePath, null as any);
      if (!session) {
        try { unlinkSync(filePath); } catch {}
        cleaned++;
        continue;
      }

      const age = now - new Date(session.startedAt).getTime();
      if (age > SESSION_TTL) {
        try { unlinkSync(filePath); } catch {}
        cleaned++;
      }
    }
  } catch {}

  return cleaned;
}

export function unregisterSession(): void {
  const file = join(getSessionDir(), `${process.ppid}.json`);
  try { unlinkSync(file); } catch {}
}
