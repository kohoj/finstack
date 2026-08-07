import { FinstackError } from '../errors';
import { atomicWriteJSON, readJSONSafe, withFileLock } from '../fs';
import { paths } from '../paths';

interface Assumption {
  id: string;
  assumption: string;
  confidence: number;
  trend: 'rising' | 'stable' | 'declining';
  history: { date: string; confidence: number; event: string }[];
  portfolioExposure: string[];
  updatedAt: string;
}

function load(): Assumption[] {
  return readJSONSafe<Assumption[]>(paths.CONSENSUS_FILE, []);
}

function save(data: Assumption[]) {
  atomicWriteJSON(paths.CONSENSUS_FILE, data);
}

/**
 * Read-modify-write consensus.json under a file lock. /sense updates
 * assumptions while the user may be running `regime update` by hand, so the
 * whole cycle must be serialized.
 */
function mutate<T>(fn: (assumptions: Assumption[]) => T): T {
  return withFileLock(paths.CONSENSUS_FILE, () => {
    const assumptions = load();
    const result = fn(assumptions);
    save(assumptions);
    return result;
  });
}

export async function regime(args: string[]) {
  const sub = args[0] || 'list';

  switch (sub) {
    case 'list': {
      const assumptions = load();
      console.log(JSON.stringify({ assumptions, count: assumptions.length }, null, 2));
      break;
    }

    case 'add': {
      const text = args.slice(1).join(' ');
      if (!text) {
        throw new FinstackError(
          'Usage: finstack regime add <assumption text>',
          undefined,
          'No assumption text provided',
          'Example: finstack regime add "AI capex growth continues through 2027"',
        );
      }
      const newItem = mutate(assumptions => {
        // Date.now() alone collides when two adds land in the same millisecond,
        // which parallel skill invocations do. Suffix with a short random tag.
        const item: Assumption = {
          id: `a${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
          assumption: text,
          confidence: 5,
          trend: 'stable',
          history: [{ date: new Date().toISOString(), confidence: 5, event: 'Initial entry' }],
          portfolioExposure: [],
          updatedAt: new Date().toISOString(),
        };
        assumptions.push(item);
        return item;
      });
      console.log(JSON.stringify(newItem, null, 2));
      break;
    }

    case 'update': {
      const id = args[1];
      const confidence = parseInt(args[2], 10);
      const event = args.slice(3).join(' ') || 'Manual update';
      if (!id || Number.isNaN(confidence)) {
        throw new FinstackError(
          'Usage: finstack regime update <id> <confidence> [event]',
          undefined,
          'Assumption id and a numeric confidence (0-10) are required',
          'Run `finstack regime list` to see ids, then: finstack regime update a123 4 "TSMC capex cut"',
        );
      }
      const item = mutate(assumptions => {
        const found = assumptions.find(a => a.id === id);
        if (!found) {
          throw new FinstackError(
            `Assumption ${id} not found`,
            undefined,
            'No assumption with that id exists',
            'Run `finstack regime list` to see ids',
          );
        }
        const prevConfidence = found.confidence;
        found.confidence = Math.max(0, Math.min(10, confidence));
        found.trend =
          confidence > prevConfidence
            ? 'rising'
            : confidence < prevConfidence
              ? 'declining'
              : found.trend;
        found.history.push({
          date: new Date().toISOString(),
          confidence: found.confidence,
          event,
        });
        found.updatedAt = new Date().toISOString();
        return found;
      });
      console.log(JSON.stringify(item, null, 2));
      break;
    }

    case 'alerts': {
      const assumptions = load();
      const alerts = assumptions.filter(a => {
        if (a.history.length < 2) return false;
        const recent = a.history.slice(-3);
        const drop = recent[0].confidence - recent[recent.length - 1].confidence;
        return drop >= 2 || a.confidence <= 3;
      });
      console.log(JSON.stringify({ alerts, count: alerts.length }, null, 2));
      break;
    }

    default:
      throw new FinstackError(
        `Unknown subcommand: ${sub}`,
        undefined,
        undefined,
        'Use list|add|update|alerts',
      );
  }
}
