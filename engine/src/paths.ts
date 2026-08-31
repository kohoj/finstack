// engine/src/paths.ts

import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * All finstack state paths, derived from FINSTACK_HOME.
 *
 * Exported as getters on a namespace object rather than plain constants so the
 * value is resolved at access time, not at module load.
 *
 * Why: `export const X = join(process.env.FINSTACK_HOME, ...)` freezes the path
 * for the lifetime of the process. That is invisible in normal use — the CLI is
 * one process per command — but it means the documented FINSTACK_HOME override
 * only works if it is set before the module graph loads, and it makes the
 * engine untestable in-process: whichever test file imports paths.ts first wins,
 * and every other test silently reads and writes that first file's directory.
 *
 * The cost is a join() per access, negligible against the file I/O that follows.
 */

function home(): string {
  return process.env.FINSTACK_HOME || join(homedir(), '.finstack');
}

/**
 * Paths namespace. Import as `import { paths } from '../paths'` and access as
 * `paths.PORTFOLIO_FILE` — the property is evaluated on each read.
 */
export const paths = {
  get FINSTACK_HOME(): string {
    return home();
  },
  get CACHE_DIR(): string {
    return join(home(), 'cache');
  },
  get JOURNAL_DIR(): string {
    return join(home(), 'journal');
  },
  get PATTERNS_DIR(): string {
    return join(home(), 'patterns');
  },
  get REPORTS_DIR(): string {
    return join(home(), 'reports');
  },
  get PORTFOLIO_FILE(): string {
    return join(home(), 'portfolio.json');
  },
  get THESES_FILE(): string {
    return join(home(), 'theses.json');
  },
  get SHADOW_FILE(): string {
    return join(home(), 'shadow.json');
  },
  get CONSENSUS_FILE(): string {
    return join(home(), 'consensus.json');
  },
  get KEYS_FILE(): string {
    return join(home(), 'keys.json');
  },
  get WATCHLIST_FILE(): string {
    return join(home(), 'watchlist.json');
  },
  get PROFILE_FILE(): string {
    return join(home(), 'profile.json');
  },
  get EQUITY_FILE(): string {
    return join(home(), 'equity.json');
  },
  /** Local Desk discovery record. Mode 0600: it contains a launch capability. */
  get DESK_FILE(): string {
    return join(home(), 'desk.json');
  },
} as const;
