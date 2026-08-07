import { appendLearning, recentLearnings, searchLearnings } from '../data/learnings';
import { FinstackError } from '../errors';

const TYPES = ['error', 'workaround', 'insight'] as const;
type LearningType = (typeof TYPES)[number];

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function parseLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new FinstackError(
      `Invalid --limit value: ${raw}`,
      undefined,
      'Limit must be a positive integer',
      `Example: finstack learn recent --limit ${fallback}`,
    );
  }
  return n;
}

export async function learn(args: string[]) {
  const sub = args[0];

  switch (sub) {
    case 'add': {
      // Filter out --flag and their values
      const flagValues = new Set<string>();
      for (let i = 1; i < args.length; i++) {
        if (args[i].startsWith('--') && i + 1 < args.length) {
          flagValues.add(args[i]);
          flagValues.add(args[i + 1]);
          i++; // skip value
        }
      }
      const summary = args
        .slice(1)
        .filter(a => !flagValues.has(a))
        .join(' ');
      if (!summary) {
        throw new FinstackError(
          'Usage: finstack learn add <summary> [--skill <name>] [--type <error|workaround|insight>]',
          undefined,
          'No summary text provided',
          'Example: finstack learn add "EDGAR returns 403 from EU IPs" --skill research --type error',
        );
      }
      const skill = parseFlag(args, '--skill') || 'unknown';
      const rawType = parseFlag(args, '--type') || 'insight';
      if (!(TYPES as readonly string[]).includes(rawType)) {
        throw new FinstackError(
          `Invalid --type value: ${rawType}`,
          undefined,
          `Type must be one of ${TYPES.join(', ')}`,
          'Example: --type error',
        );
      }
      const type = rawType as LearningType;
      const entry = appendLearning({ skill, type, summary, detail: '', tags: [] });
      console.log(JSON.stringify(entry, null, 2));
      break;
    }

    case 'search': {
      const keyword =
        args
          .slice(1)
          .filter(a => !a.startsWith('--'))
          .join(' ') || undefined;
      const skill = parseFlag(args, '--skill');
      const limit = parseLimit(parseFlag(args, '--limit'), 10);
      const results = searchLearnings({ keyword, skill, limit });
      console.log(JSON.stringify({ learnings: results, count: results.length }, null, 2));
      break;
    }

    case 'recent': {
      const skill = parseFlag(args, '--skill');
      const limit = parseLimit(parseFlag(args, '--limit'), 5);
      const results = recentLearnings({ limit, skill });
      console.log(JSON.stringify({ learnings: results, count: results.length }, null, 2));
      break;
    }

    default:
      throw new FinstackError(
        sub ? `Unknown subcommand: ${sub}` : 'Usage: finstack learn add|search|recent',
        undefined,
        undefined,
        'Use add|search|recent',
      );
  }
}
