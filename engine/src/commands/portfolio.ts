import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const FINSTACK_DIR = join(homedir(), '.finstack');
const PORTFOLIO_FILE = join(FINSTACK_DIR, 'portfolio.json');
const SHADOW_FILE = join(FINSTACK_DIR, 'shadow.json');

interface Position {
  ticker: string;
  shares: number;
  avgCost: number;
  addedAt: string;
  notes?: string;
}

interface Transaction {
  ticker: string;
  action: 'buy' | 'sell';
  shares: number;
  price: number;
  date: string;
  reason: string | null;
}

interface Portfolio {
  positions: Position[];
  transactions: Transaction[];
  updatedAt: string;
}

function load(): Portfolio {
  if (!existsSync(PORTFOLIO_FILE)) return { positions: [], transactions: [], updatedAt: new Date().toISOString() };
  try {
    const data = JSON.parse(readFileSync(PORTFOLIO_FILE, 'utf-8'));
    if (!data.transactions) data.transactions = [];
    return data;
  } catch {
    return { positions: [], transactions: [], updatedAt: new Date().toISOString() };
  }
}

function save(data: Portfolio) {
  mkdirSync(FINSTACK_DIR, { recursive: true });
  data.updatedAt = new Date().toISOString();
  writeFileSync(PORTFOLIO_FILE, JSON.stringify(data, null, 2));
}

function loadShadow(): any {
  if (!existsSync(SHADOW_FILE)) return { entries: [] };
  try {
    return JSON.parse(readFileSync(SHADOW_FILE, 'utf-8'));
  } catch {
    return { entries: [] };
  }
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
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
      p.transactions.push({
        ticker,
        action: 'buy',
        shares,
        price: avgCost,
        date: new Date().toISOString(),
        reason: null,
      });
      save(p);
      console.log(JSON.stringify(p, null, 2));
      break;
    }

    case 'remove': {
      const ticker = args[1]?.toUpperCase();
      if (!ticker) {
        console.error(JSON.stringify({ error: 'Usage: finstack portfolio remove <ticker> [--reason <reason>] [--price <price>]' }));
        process.exit(1);
      }

      const reason = parseFlag(args, '--reason') || null;
      const priceStr = parseFlag(args, '--price');

      const p = load();
      const position = p.positions.find(pos => pos.ticker === ticker);

      // Check for open shadow entry — deviation detection
      const shadow = loadShadow();
      const shadowEntry = shadow.entries?.find((e: any) => e.ticker === ticker && e.status === 'open');

      if (shadowEntry && !reason) {
        const horizonDate = new Date(shadowEntry.timeHorizon);
        const daysRemaining = Math.ceil((horizonDate.getTime() - Date.now()) / 86400000);
        if (daysRemaining > 0) {
          console.log(JSON.stringify({
            deviation_detected: true,
            ticker,
            shadow_status: 'open',
            planned_exit: shadowEntry.timeHorizon,
            days_remaining: daysRemaining,
            prompt: `You're closing ${ticker} ${daysRemaining} days before your plan's horizon. Reason?`,
            options: ['thesis-changed', 'stop-triggered', 'emotional', 'need-cash', 'other'],
            usage: `finstack portfolio remove ${ticker} --reason <reason>`,
          }, null, 2));
        }
      }

      if (position) {
        const sellPrice = priceStr ? parseFloat(priceStr) : position.avgCost;
        p.transactions.push({
          ticker,
          action: 'sell',
          shares: position.shares,
          price: sellPrice,
          date: new Date().toISOString(),
          reason: reason || (shadowEntry ? 'unspecified' : null),
        });
      }

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
