import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const FINSTACK_DIR = join(homedir(), '.finstack');
const PORTFOLIO_FILE = join(FINSTACK_DIR, 'portfolio.json');

interface Position {
  ticker: string;
  shares: number;
  avgCost: number;
  addedAt: string;
  notes?: string;
}

interface Portfolio {
  positions: Position[];
  updatedAt: string;
}

function load(): Portfolio {
  if (!existsSync(PORTFOLIO_FILE)) return { positions: [], updatedAt: new Date().toISOString() };
  try {
    return JSON.parse(readFileSync(PORTFOLIO_FILE, 'utf-8'));
  } catch {
    return { positions: [], updatedAt: new Date().toISOString() };
  }
}

function save(data: Portfolio) {
  mkdirSync(FINSTACK_DIR, { recursive: true });
  data.updatedAt = new Date().toISOString();
  writeFileSync(PORTFOLIO_FILE, JSON.stringify(data, null, 2));
}

export async function portfolio(args: string[]) {
  const sub = args[0] || 'show';

  switch (sub) {
    case 'show': {
      const p = load();
      console.log(JSON.stringify(p, null, 2));
      break;
    }

    case 'add': {
      const ticker = args[1]?.toUpperCase();
      const shares = parseFloat(args[2]);
      const avgCost = parseFloat(args[3]);
      if (!ticker || isNaN(shares) || isNaN(avgCost)) {
        console.error(JSON.stringify({ error: 'Usage: finstack portfolio add <ticker> <shares> <avgCost>' }));
        process.exit(1);
      }
      const p = load();
      const existing = p.positions.find(pos => pos.ticker === ticker);
      if (existing) {
        const totalShares = existing.shares + shares;
        existing.avgCost = (existing.avgCost * existing.shares + avgCost * shares) / totalShares;
        existing.shares = totalShares;
      } else {
        p.positions.push({ ticker, shares, avgCost, addedAt: new Date().toISOString() });
      }
      save(p);
      console.log(JSON.stringify(p, null, 2));
      break;
    }

    case 'remove': {
      const ticker = args[1]?.toUpperCase();
      if (!ticker) {
        console.error(JSON.stringify({ error: 'Usage: finstack portfolio remove <ticker>' }));
        process.exit(1);
      }
      const p = load();
      p.positions = p.positions.filter(pos => pos.ticker !== ticker);
      save(p);
      console.log(JSON.stringify(p, null, 2));
      break;
    }

    case 'init': {
      const p = load();
      if (p.positions.length > 0) {
        console.log(JSON.stringify({ message: 'Portfolio already exists', ...p }, null, 2));
      } else {
        save(p);
        console.log(JSON.stringify({ message: 'Empty portfolio initialized', ...p }, null, 2));
      }
      break;
    }

    default:
      console.error(JSON.stringify({ error: `Unknown subcommand: ${sub}. Use show|add|remove|init` }));
      process.exit(1);
  }
}
