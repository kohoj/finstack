#!/usr/bin/env bun

import { quote } from './commands/quote';
import { financials } from './commands/financials';
import { scan } from './commands/scan';
import { regime } from './commands/regime';
import { portfolio } from './commands/portfolio';

const commands: Record<string, (args: string[]) => Promise<void>> = {
  quote,
  financials,
  scan,
  regime,
  portfolio,
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

Data: ~/.finstack/
Cache: ~/.finstack/cache/ (5min quotes, 1hr financials, 15min scans)
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
