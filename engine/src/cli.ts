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
import { alerts } from './commands/alerts';
import { calendar } from './commands/calendar';
import { screen } from './commands/screen';
import { learn } from './commands/learn';
import { report } from './commands/report';
import { formatErrorJSON, FinstackError } from './errors';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

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
  alerts,
  calendar,
  screen,
  learn,
  report,
};

function checkVersion() {
  try {
    const distDir = dirname(process.argv[0] || __dirname);
    const versionFile = join(distDir, '.version');
    if (!existsSync(versionFile)) return;
    const builtHash = readFileSync(versionFile, 'utf-8').trim();
    if (builtHash === 'dev') return;

    const { execSync } = require('child_process');
    const srcDir = join(distDir, '..', '..');
    const currentHash = execSync('git rev-parse HEAD', { cwd: srcDir, encoding: 'utf-8' }).trim();

    if (builtHash !== currentHash) {
      console.error(`⚠ engine binary 版本过旧 (built: ${builtHash.slice(0, 7)}, current: ${currentHash.slice(0, 7)})，请运行: bun run build`);
    }
  } catch {
    // Version check is best-effort, never block
  }
}

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
  earnings <ticker> [--upcoming]         Earnings history + upcoming date
  alpha [--last N]                       Cognitive alpha calculation
  thesis list|check|kill|history         Thesis lifecycle management
  risk [size <ticker> <entry> <stop>]    Portfolio risk + position sizing
  watchlist [add|remove|tag|untag]       Watchlist management
  alerts [--due N] [--source S]          Check pending alerts
  calendar [--range N]                   Upcoming earnings calendar
  screen "<filters>" [--preset P]        Stock screener with filter syntax
  learn add|search|recent                Operational learnings management
  report sense|track|reflect [--no-open] Generate HTML visual reports

Data: ~/.finstack/   (override with FINSTACK_HOME env var)
Cache: ~/.finstack/cache/
`);
    process.exit(command ? 0 : 1);
  }

  checkVersion();

  const fn = commands[command];
  if (!fn) {
    console.error(formatErrorJSON(
      new FinstackError(
        `Unknown command: ${command}`,
        undefined,
        undefined,
        `Run 'finstack help' for available commands`,
      )
    ));
    process.exit(1);
  }

  try {
    await fn(args);
  } catch (e: any) {
    console.error(formatErrorJSON(e));
    process.exit(1);
  }
}

main();
