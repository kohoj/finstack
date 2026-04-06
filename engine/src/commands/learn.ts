import { appendLearning, searchLearnings, recentLearnings } from '../data/learnings';

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
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
      const summary = args.slice(1).filter(a => !flagValues.has(a)).join(' ');
      if (!summary) {
        console.error(JSON.stringify({ error: 'Usage: finstack learn add <summary> [--skill <name>] [--type <error|workaround|insight>]' }));
        process.exit(1);
      }
      const skill = parseFlag(args, '--skill') || 'unknown';
      const type = (parseFlag(args, '--type') || 'insight') as 'error' | 'workaround' | 'insight';
      const entry = appendLearning({ skill, type, summary, detail: '', tags: [] });
      console.log(JSON.stringify(entry, null, 2));
      break;
    }

    case 'search': {
      const keyword = args.slice(1).filter(a => !a.startsWith('--')).join(' ') || undefined;
      const skill = parseFlag(args, '--skill');
      const limitStr = parseFlag(args, '--limit');
      const limit = limitStr ? parseInt(limitStr) : 10;
      const results = searchLearnings({ keyword, skill, limit });
      console.log(JSON.stringify({ learnings: results, count: results.length }, null, 2));
      break;
    }

    case 'recent': {
      const limitStr = parseFlag(args, '--limit');
      const skill = parseFlag(args, '--skill');
      const limit = limitStr ? parseInt(limitStr) : 5;
      const results = recentLearnings({ limit, skill });
      console.log(JSON.stringify({ learnings: results, count: results.length }, null, 2));
      break;
    }

    default:
      console.error(JSON.stringify({ error: 'Usage: finstack learn add|search|recent' }));
      process.exit(1);
  }
}
