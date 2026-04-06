// engine/src/paths.ts
import { join } from 'path';
import { homedir } from 'os';

export const FINSTACK_HOME = process.env.FINSTACK_HOME || join(homedir(), '.finstack');

export const CACHE_DIR = join(FINSTACK_HOME, 'cache');
export const JOURNAL_DIR = join(FINSTACK_HOME, 'journal');
export const PATTERNS_DIR = join(FINSTACK_HOME, 'patterns');
export const REPORTS_DIR = join(FINSTACK_HOME, 'reports');

export const PORTFOLIO_FILE = join(FINSTACK_HOME, 'portfolio.json');
export const THESES_FILE = join(FINSTACK_HOME, 'theses.json');
export const SHADOW_FILE = join(FINSTACK_HOME, 'shadow.json');
export const CONSENSUS_FILE = join(FINSTACK_HOME, 'consensus.json');
export const KEYS_FILE = join(FINSTACK_HOME, 'keys.json');
export const WATCHLIST_FILE = join(FINSTACK_HOME, 'watchlist.json');
export const PROFILE_FILE = join(FINSTACK_HOME, 'profile.json');
