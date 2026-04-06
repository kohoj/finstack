#!/usr/bin/env bun

import { quote } from './commands/quote';
import { financials } from './commands/financials';
import { scan } from './commands/scan';
import { regime } from './commands/regime';
import { portfolio } from './commands/portfolio';
import { keys } from './commands/keys';
import { macro } from './commands/macro';
import { filing } from './commands/filing';
import { history } from './commands/history';
import { earnings } from './commands/earnings';
import { alpha } from './commands/alpha';
import { thesis } from './commands/thesis';
import { risk } from './commands/risk';
import { watchlist } from './commands/watchlist';

const commands: Record<string, (args: string[]) => Promise<void>> = {
  quote,
  financials,
  scan,
  regime,
  portfolio,
  keys,
  macro,
  filing,
  history,
  earnings,
  alpha,
  thesis,
  risk,
  watchlist,
};

async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  if (!command || command === 'help' || command === '--help') {
    console.log(`finstack — investment thinking engine

Commands:
  quote <ticker>                         Price snapshot with key metrics
  financials <ticker>                    Financial data and ratios
  scan [--source trending|news|all]      Multi-source signal scanning
  regime list|add|update|alerts          Consensus assumption register
  portfolio show|add|remove|init         Portfolio management
  keys set|list|remove                   API key management
  macro [series]                         FRED macro indicators
  filing <ticker>                        SEC EDGAR filings
  history <ticker> [--from --to]         Historical price data
  earnings <ticker>                      Earnings history + calendar
  alpha [--last N]                       Cognitive alpha calculation
  thesis list|check|kill|history         Thesis lifecycle management
  risk [size <ticker> <entry> <stop>]    Portfolio risk + position sizing
  watchlist show|add|remove|tag|untag    Watchlist management with tagging

Data: ~/.finstack/
Cache: ~/.finstack/cache/
`);
    process.exit(command ? 0 : 1);
  }

  const fn = commands[command];
  if (!fn) {
    console.error(JSON.stringify({ error: `Unknown command: ${command}. Run 'finstack help' for usage.` }));
    process.exit(1);
  }

  try {
    await fn(args);
  } catch (e: any) {
    console.error(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}

main();
