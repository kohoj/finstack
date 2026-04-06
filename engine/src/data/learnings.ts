import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { FINSTACK_HOME } from '../paths';
import { join } from 'path';

const LEARNINGS_FILE = join(FINSTACK_HOME, 'learnings.jsonl');

export interface Learning {
  id: string;
  timestamp: string;
  skill: string;
  type: 'error' | 'workaround' | 'insight';
  summary: string;
  detail: string;
  tags: string[];
}

export function appendLearning(learning: Omit<Learning, 'id' | 'timestamp'>, file = LEARNINGS_FILE): Learning {
  mkdirSync(dirname(file), { recursive: true });
  const entry: Learning = {
    id: `l${Date.now()}`,
    timestamp: new Date().toISOString(),
    ...learning,
  };
  appendFileSync(file, JSON.stringify(entry) + '\n');
  return entry;
}

export function loadLearnings(file = LEARNINGS_FILE): Learning[] {
  if (!existsSync(file)) return [];
  try {
    return readFileSync(file, 'utf-8')
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

export function searchLearnings(opts: {
  keyword?: string;
  skill?: string;
  limit?: number;
  file?: string;
}): Learning[] {
  const { keyword, skill, limit = 10, file = LEARNINGS_FILE } = opts;
  let results = loadLearnings(file);

  if (skill) {
    results = results.filter(l => l.skill === skill);
  }

  if (keyword) {
    const kw = keyword.toLowerCase();
    results = results.filter(l =>
      l.summary.toLowerCase().includes(kw) ||
      l.detail.toLowerCase().includes(kw) ||
      l.tags.some(t => t.toLowerCase().includes(kw))
    );
  }

  // Most recent first
  results.reverse();
  return results.slice(0, limit);
}

export function recentLearnings(opts: {
  limit?: number;
  skill?: string;
  file?: string;
}): Learning[] {
  return searchLearnings({ ...opts, keyword: undefined });
}
