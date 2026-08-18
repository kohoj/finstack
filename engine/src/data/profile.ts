// engine/src/data/profile.ts
//
// The risk profile: user-owned configuration that parameterizes position
// sizing and the risk gate.
//
// `riskBudgetPct` — the maximum fraction of the portfolio to lose on a single
// trade at its stop — drives `risk size` (shares are back-solved from it), the
// dashboard's per-position over-budget alert (`riskBudgetPct × 2.5`), and the
// reported `maxLossPerTrade`. It was previously read from profile.json with no
// writer anywhere, so it was pinned to the default 2 forever: a stable-looking
// config that was really a hard-coded constant. This module owns both ends of
// that file so the value is genuinely configurable and validated at the write
// boundary.

import { FinstackError } from '../errors';
import { atomicWriteJSON, readJSONSafe, withFileLock } from '../fs';
import { paths } from '../paths';

export interface Profile {
  riskBudgetPct: number; // max % of portfolio risked per trade at stop
  updatedAt: string;
}

const DEFAULT_RISK_BUDGET_PCT = 2;

// A risk budget is a percentage of the portfolio lost per trade, so it must sit
// in (0, 100]: zero means no position is ever sizeable, and above 100 would
// claim a single trade can lose more than the whole account. The bound rejects
// nonsense at the boundary rather than letting it silently produce absurd sizes.
const MAX_RISK_BUDGET_PCT = 100;

const defaultProfile = (): Profile => ({
  riskBudgetPct: DEFAULT_RISK_BUDGET_PCT,
  updatedAt: '',
});

/**
 * Load the profile, falling back to defaults for a missing or partial file.
 *
 * A fresh object per call: readJSONSafe returns its fallback by reference and
 * setRiskBudget mutates the loaded profile in place, so a shared constant would
 * be polluted across calls within a process (the same latent bug fixed in
 * equity.ts).
 */
export function loadProfile(file = paths.PROFILE_FILE): Profile {
  const data = readJSONSafe<Profile>(file, defaultProfile());
  // A stored non-positive or absent budget is treated as unset, not obeyed —
  // the sizing math is meaningless at zero.
  if (typeof data.riskBudgetPct !== 'number' || data.riskBudgetPct <= 0) {
    data.riskBudgetPct = DEFAULT_RISK_BUDGET_PCT;
  }
  return data;
}

/**
 * Set the risk budget and persist it. Validates the range at the boundary and
 * writes under a lock so a concurrent read never sees a torn file. Returns the
 * updated profile.
 */
export function setRiskBudget(pct: number, file = paths.PROFILE_FILE): Profile {
  if (!Number.isFinite(pct) || pct <= 0 || pct > MAX_RISK_BUDGET_PCT) {
    throw new FinstackError(
      `Risk budget must be between 0 and ${MAX_RISK_BUDGET_PCT}`,
      undefined,
      `Received ${pct}`,
      'The risk budget is the % of the portfolio risked per trade, e.g. 2 for 2%',
    );
  }
  return withFileLock(file, () => {
    const profile = loadProfile(file);
    profile.riskBudgetPct = pct;
    profile.updatedAt = new Date().toISOString();
    atomicWriteJSON(file, profile);
    return profile;
  });
}
