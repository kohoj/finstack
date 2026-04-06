import {
  loadWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  tagTicker,
  untagTicker,
} from '../data/watchlist';
import { FinstackError } from '../errors';

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

export async function watchlist(args: string[]) {
  const sub = args[0];

  if (!sub || sub === 'show') {
    const list = loadWatchlist();
    console.log(JSON.stringify({ watchlist: list, count: list.length }, null, 2));
    return;
  }

  switch (sub) {
    case 'add': {
      const ticker = args[1];
      if (!ticker) {
        console.error(JSON.stringify({ error: 'Usage: finstack watchlist add <ticker> [reason] [--thesis <id>]' }));
        process.exit(1);
      }
      const thesis = parseFlag(args, '--thesis') || null;
      const reason = args.slice(2).filter(a => a !== '--thesis' && a !== thesis).join(' ') || '';
      const entry = addToWatchlist(ticker, reason, undefined, thesis);
      console.log(JSON.stringify(entry, null, 2));
      break;
    }

    case 'remove': {
      const ticker = args[1];
      if (!ticker) {
        console.error(JSON.stringify({ error: 'Usage: finstack watchlist remove <ticker>' }));
        process.exit(1);
      }
      removeFromWatchlist(ticker);
      console.log(JSON.stringify({ message: `${ticker.toUpperCase()} removed from watchlist` }));
      break;
    }

    case 'tag': {
      const ticker = args[1];
      const tag = args[2];
      if (!ticker || !tag) {
        console.error(JSON.stringify({ error: 'Usage: finstack watchlist tag <ticker> <tag>' }));
        process.exit(1);
      }
      tagTicker(ticker, tag);
      console.log(JSON.stringify({ message: `Tagged ${ticker.toUpperCase()} with "${tag}"` }));
      break;
    }

    case 'untag': {
      const ticker = args[1];
      const tag = args[2];
      if (!ticker || !tag) {
        console.error(JSON.stringify({ error: 'Usage: finstack watchlist untag <ticker> <tag>' }));
        process.exit(1);
      }
      untagTicker(ticker, tag);
      console.log(JSON.stringify({ message: `Removed tag "${tag}" from ${ticker.toUpperCase()}` }));
      break;
    }

    default:
      throw new FinstackError(`Unknown subcommand: ${sub}`, undefined, undefined, 'Use show|add|remove|tag|untag');
  }
}
