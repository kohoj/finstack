import { CONSENSUS_FILE } from '../paths';
import { atomicWriteJSON, readJSONSafe } from '../fs';
import { FinstackError } from '../errors';

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
  return readJSONSafe<Assumption[]>(CONSENSUS_FILE, []);
}

function save(data: Assumption[]) {
  atomicWriteJSON(CONSENSUS_FILE, data);
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
        console.error(JSON.stringify({ error: 'Usage: finstack regime add <assumption text>' }));
        process.exit(1);
      }
      const assumptions = load();
      const newItem: Assumption = {
        id: `a${Date.now()}`,
        assumption: text,
        confidence: 5,
        trend: 'stable',
        history: [{ date: new Date().toISOString(), confidence: 5, event: 'Initial entry' }],
        portfolioExposure: [],
        updatedAt: new Date().toISOString(),
      };
      assumptions.push(newItem);
      save(assumptions);
      console.log(JSON.stringify(newItem, null, 2));
      break;
    }

    case 'update': {
      const id = args[1];
      const confidence = parseInt(args[2]);
      const event = args.slice(3).join(' ') || 'Manual update';
      if (!id || isNaN(confidence)) {
        console.error(JSON.stringify({ error: 'Usage: finstack regime update <id> <confidence> [event]' }));
        process.exit(1);
      }
      const assumptions = load();
      const item = assumptions.find(a => a.id === id);
      if (!item) {
        throw new FinstackError(`Assumption ${id} not found`);
      }
      const prevConfidence = item.confidence;
      item.confidence = Math.max(0, Math.min(10, confidence));
      item.trend = confidence > prevConfidence ? 'rising' : confidence < prevConfidence ? 'declining' : item.trend;
      item.history.push({ date: new Date().toISOString(), confidence: item.confidence, event });
      item.updatedAt = new Date().toISOString();
      save(assumptions);
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
      throw new FinstackError(`Unknown subcommand: ${sub}`, undefined, undefined, 'Use list|add|update|alerts');
  }
}
