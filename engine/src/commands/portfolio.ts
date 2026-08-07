import { FinstackError } from '../errors';
import { atomicWriteJSON, readJSONSafe, withFileLock } from '../fs';
import { paths } from '../paths';
import { validatePositiveNumber, validateTicker } from '../validation';

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
  const data = readJSONSafe<Portfolio>(paths.PORTFOLIO_FILE, {
    positions: [],
    transactions: [],
    updatedAt: new Date().toISOString(),
  });
  if (!data.transactions) data.transactions = [];
  return data;
}

function save(data: Portfolio) {
  data.updatedAt = new Date().toISOString();
  atomicWriteJSON(paths.PORTFOLIO_FILE, data);
}

/**
 * Read-modify-write portfolio.json under a file lock.
 *
 * Locking only the write is useless: the lost update happens between the read
 * and the write, when a second process reads the same base state. The whole
 * cycle has to be inside the lock.
 */
function mutate<T>(fn: (p: Portfolio) => T): T {
  return withFileLock(paths.PORTFOLIO_FILE, () => {
    const p = load();
    const result = fn(p);
    save(p);
    return result;
  });
}

function loadShadow(): any {
  return readJSONSafe(paths.SHADOW_FILE, { entries: [] });
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
      const ticker = validateTicker(args[1]);
      const shares = validatePositiveNumber(args[2], 'shares');
      const avgCost = validatePositiveNumber(args[3], 'avgCost');
      const p = mutate(p => {
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
        return p;
      });
      console.log(JSON.stringify(p, null, 2));
      break;
    }

    case 'remove': {
      const ticker = validateTicker(args[1]);

      const reason = parseFlag(args, '--reason') || null;
      const priceStr = parseFlag(args, '--price');
      // Validated up front: an unchecked NaN here would be written into the
      // transaction log and corrupt every downstream alpha calculation.
      const sellPriceOverride =
        priceStr === undefined ? undefined : validatePositiveNumber(priceStr, 'price');

      // Read outside the lock: shadow.json is a different file and is only
      // read here, so holding the portfolio lock across it would widen the
      // critical section for no benefit.
      const shadow = loadShadow();
      const shadowEntry = shadow.entries?.find(
        (e: any) => e.ticker === ticker && e.status === 'open',
      );

      // Deviation detection — surfaced before the mutation so the user sees the
      // prompt even when they proceed.
      if (shadowEntry && !reason) {
        const horizonDate = new Date(shadowEntry.timeHorizon);
        const daysRemaining = Math.ceil((horizonDate.getTime() - Date.now()) / 86400000);
        if (daysRemaining > 0) {
          console.log(
            JSON.stringify(
              {
                deviation_detected: true,
                ticker,
                shadow_status: 'open',
                planned_exit: shadowEntry.timeHorizon,
                days_remaining: daysRemaining,
                prompt: `You're closing ${ticker} ${daysRemaining} days before your plan's horizon. Reason?`,
                options: ['thesis-changed', 'stop-triggered', 'emotional', 'need-cash', 'other'],
                usage: `finstack portfolio remove ${ticker} --reason <reason>`,
              },
              null,
              2,
            ),
          );
        }
      }

      const updated = mutate(p => {
        const position = p.positions.find(pos => pos.ticker === ticker);
        if (position) {
          const sellPrice = sellPriceOverride ?? position.avgCost;
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
        return p;
      });
      console.log(JSON.stringify(updated, null, 2));
      break;
    }

    case 'init': {
      const result = withFileLock(paths.PORTFOLIO_FILE, () => {
        const p = load();
        if (p.positions.length > 0) {
          return { message: 'Portfolio already exists', ...p };
        }
        save(p);
        return { message: 'Empty portfolio initialized', ...p };
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    default:
      throw new FinstackError(
        `Unknown subcommand: ${sub}`,
        undefined,
        undefined,
        'Use show|add|remove|init',
      );
  }
}
