import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const FINSTACK_DIR = join(homedir(), '.finstack');
const CONSENSUS_FILE = join(FINSTACK_DIR, 'consensus.json');

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
  if (!existsSync(CONSENSUS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(CONSENSUS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function save(data: Assumption[]) {
  mkdirSync(FINSTACK_DIR, { recursive: true });
  writeFileSync(CONSENSUS_FILE, JSON.stringify(data, null, 2));
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
        console.error(JSON.stringify({ error: `Assumption ${id} not found` }));
        process.exit(1);
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
      console.error(JSON.stringify({ error: `Unknown subcommand: ${sub}. Use list|add|update|alerts` }));
      process.exit(1);
  }
}
