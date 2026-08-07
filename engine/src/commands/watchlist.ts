import {
  addToWatchlist,
  loadWatchlist,
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
        throw new FinstackError(
          'Usage: finstack watchlist add <ticker> [reason] [--thesis <id>]',
          undefined,
          'No ticker provided',
          'Example: finstack watchlist add NVDA "AI capex cycle"',
        );
      }
      const thesis = parseFlag(args, '--thesis') || null;
      const reason =
        args
          .slice(2)
          .filter(a => a !== '--thesis' && a !== thesis)
          .join(' ') || '';
      const entry = addToWatchlist(ticker, reason, undefined, thesis);
      console.log(JSON.stringify(entry, null, 2));
      break;
    }

    case 'remove': {
      const ticker = args[1];
      if (!ticker) {
        throw new FinstackError(
          'Usage: finstack watchlist remove <ticker>',
          undefined,
          'No ticker provided',
          'Run `finstack watchlist` to see current entries',
        );
      }
      removeFromWatchlist(ticker);
      console.log(JSON.stringify({ message: `${ticker.toUpperCase()} removed from watchlist` }));
      break;
    }

    case 'tag': {
      const ticker = args[1];
      const tag = args[2];
      if (!ticker || !tag) {
        throw new FinstackError(
          'Usage: finstack watchlist tag <ticker> <tag>',
          undefined,
          'Both a ticker and a tag are required',
          'Example: finstack watchlist tag NVDA ai',
        );
      }
      const tagged = tagTicker(ticker, tag);
      if (!tagged) {
        throw new FinstackError(
          `${ticker.toUpperCase()} is not in your watchlist`,
          undefined,
          'Cannot tag a ticker that is not being watched',
          `Add it first: finstack watchlist add ${ticker.toUpperCase()}`,
        );
      }
      console.log(JSON.stringify({ message: `Tagged ${ticker.toUpperCase()} with "${tag}"` }));
      break;
    }

    case 'untag': {
      const ticker = args[1];
      const tag = args[2];
      if (!ticker || !tag) {
        throw new FinstackError(
          'Usage: finstack watchlist untag <ticker> <tag>',
          undefined,
          'Both a ticker and a tag are required',
          'Example: finstack watchlist untag NVDA ai',
        );
      }
      untagTicker(ticker, tag);
      console.log(JSON.stringify({ message: `Removed tag "${tag}" from ${ticker.toUpperCase()}` }));
      break;
    }

    default:
      throw new FinstackError(
        `Unknown subcommand: ${sub}`,
        undefined,
        undefined,
        'Use show|add|remove|tag|untag',
      );
  }
}
