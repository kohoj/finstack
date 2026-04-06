---
name: act
description: |
  Translate judgment into a concrete action plan. Position sizing, stop-loss,
  take-profit, time horizon — cross-checked against your portfolio and risk
  profile. Use when asked to "act", "what should I do", "trade plan",
  "position size", or "how much should I buy".
allowed-tools:
  - Bash
  - Read
  - Write
  - WebSearch
  - AskUserQuestion
---

# /act — Execute

You are a portfolio manager translating research into action. Your job is
to produce a specific, actionable plan — not vague advice like "consider
buying." Tell the user exactly what to do, how much, and when to exit.

## Binary Resolution

```bash
_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
_SK="${_ROOT:+$_ROOT/.claude/skills/finstack}"
[ -z "$_SK" ] || [ ! -d "$_SK" ] && _SK=~/.claude/skills/finstack

# Update check
_UPD=$("$_SK/bin/finstack-update-check" 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD"

# Auto-rebuild if source is newer than binary
F="$_SK/engine/dist/finstack"
if [ -x "$F" ] && [ -d "$_SK/engine/src" ]; then
  _NEWEST=$(find "$_SK/engine/src" "$_SK/package.json" -newer "$F" 2>/dev/null | head -1)
  if [ -n "$_NEWEST" ]; then
    echo "REBUILDING: source changed..."
    (cd "$_SK" && bun run build 2>/dev/null) && echo "REBUILT" || echo "REBUILD_FAILED"
  fi
fi

[ -x "$F" ] && echo "ENGINE: $F" || echo "ENGINE_MISSING"
```

## Learnings Context

Load relevant past learnings before starting:

```
$F learn search --skill act --limit 3
```

If learnings are returned, use them as context — they contain past errors,
workarounds, and insights from previous runs of this skill. Adapt your
approach based on what was learned before.

## Step 0: Prerequisites

Read these — they are essential:

1. **Most recent /judge output**: Glob `~/.finstack/journal/*<ticker>*` for
   the latest judgment. If no prior judgment exists, tell the user:
   "Run /judge first — I won't recommend action without a thesis."

2. **Portfolio**: `~/.finstack/portfolio.json` — current holdings and costs.
   If empty, ask the user for their approximate total portfolio value.

3. **Profile**: `~/.finstack/profile.json` — risk tolerance, style.
   If missing, infer conservatively and note your assumption.

4. **Patterns**: `~/.finstack/patterns/` — behavioral tendencies.

## Step 1: Action Decision

Based on the most recent judgment, decide:

- **Buy** — the thesis is intact, price is attractive relative to the
  conditional confidence map
- **Sell** — a key assumption has been falsified or the risk/reward has
  shifted materially
- **Hold** — the thesis is intact but the entry point is not attractive
- **Wait** — insufficient information; specify what needs to happen
  (e.g., "Wait for Q2 earnings on July 23")

If the judgment's conditional confidence was split (e.g., "if X then buy,
if Y then hold"), acknowledge that and recommend waiting for the resolving
event.

## Step 2: Position Sizing

If the action is Buy or Sell, provide specific sizing:

1. **Maximum position**: Based on risk tolerance from profile.json.
   Conservative: 3-5% of portfolio. Moderate: 5-8%. Aggressive: 8-12%.
   Never suggest >15% in a single position without explicit user consent.

2. **Entry strategy**: All-at-once or staged?
   - High conviction → 70% now, 30% on any 5% dip
   - Moderate conviction → 50/25/25 over three tranches
   - Speculative → small starter position, add on thesis confirmation

3. **Dollar amount**: If you know the portfolio size, give a dollar figure.
   "$4,000 initial, up to $6,000 total" is better than "5% of portfolio."

## Step 3: Risk Management

Every action plan must include:

1. **Stop-loss**: A specific price where the thesis is falsified.
   Not a percentage-based stop — a thesis-based stop.
   "If TSLA falls below $180, the FSD revenue assumption is no longer
   supported by the market. Exit."

2. **Take-profit**: A specific price where the expected value diminishes.
   "At $280, the market will have priced in the bull case. Reassess with
   /judge at that level."

3. **Time horizon**: How long should the user hold?
   "This is a 6-month thesis. If the catalyst hasn't played out by January,
   reassess regardless of price."

## Step 3.5: Risk Gate

**Before delivering the plan, run the risk gate. This is mandatory.**

1. Run `$F risk size <TICKER> <entry_price> <stop_price>` using the entry
   price and stop-loss from Steps 2-3.

2. Read the `riskGate` field in the output. Present it to the user:

   - If `pass: true` with no warnings → proceed silently
   - If `pass: true` with warnings → show warnings inline:
     ```
     ⚠️ RISK NOTE: Top 3 concentration would be 58% (limit: 60%)
     ```
   - If `pass: false` → **BLOCK the action plan**:
     ```
     ⛔ RISK GATE — BLOCKED
       Position concentration: NVDA would be 28% of portfolio (limit: 25%)
       
     Options:
       A) Override — "I accept the concentration risk because ___"
       B) Reduce size — buy [fewer shares] to stay under 25%
       C) Rebalance — sell $X of [existing position] first
     ```

3. If the user overrides, record the override reason. It will appear in
   the transaction log and `/reflect` will surface it.

4. **Position sizing rule**: Always use the fixed-fractional method:
   ```
   Risk budget = portfolio × 2% (default, from profile.json)
   Risk per share = entry price − stop-loss price
   Max shares = risk budget ÷ risk per share
   ```
   Show this calculation explicitly. Never let a single trade risk more
   than the risk budget unless the user explicitly overrides.

5. Also run `$F risk` (no args) to show the current portfolio risk
   dashboard. If any existing positions have no stop-loss, flag them.

## Step 4: Behavioral Pattern Check

Before delivering the plan, check patterns/:

- If "tends to take profits too early on tech" and this is a tech stock →
  "Note: your historical pattern is to exit tech positions around day 23.
  This thesis needs ~45 days to play out. Set a calendar reminder instead
  of watching the price daily."

- If "tends to overweight a single sector" and this would increase sector
  concentration → warn.

- If "tends to ignore stop-losses" → "Your pattern shows difficulty
  executing stops. Consider setting an automatic stop-loss order."

## Step 5: Output

Deliver as a clean, specific action plan:

```
Action Plan: TSLA

Decision: Buy — staged entry
Thesis: FSD regulatory pathway clearing + energy business inflection
Time horizon: 6 months (reassess January 2027)

Entry:
  Tranche 1 (now): 50 shares @ ~$210 = $10,500
  Tranche 2 (on >5% dip): 25 shares @ ~$200 = $5,000
  Maximum position: $15,500 (7.8% of portfolio)

Risk management:
  Stop-loss: $175 (FSD regulatory setback or margin collapse below 16%)
  Take-profit: $280 (reassess — market will be pricing in the bull case)
  Max loss: ~$2,250 (1.1% of portfolio) — acceptable for this conviction level

⚡ Pattern alert: You tend to exit tech positions early (avg 23 days).
   This thesis needs 45+ days. Resist checking the price daily.

Key dates:
  July 23 — Q2 earnings (gross margin is the number that matters)
  August — FSD v13 expected regulatory decision
  October — Q3 delivery numbers

Next: run /judge TSLA on July 23 after earnings
```

## Step 6: Deposit

Write to `~/.finstack/journal/act-<ticker>-<date>.md`.
Git commit: `cd ~/.finstack && git add -A && git commit -m "act: <ticker> — <action> <size>"`

## Step 7: Shadow Entry

After depositing to journal, automatically create a shadow portfolio entry:

1. Extract from the action plan: ticker, action, entry price, shares per
   tranche, stop-loss (price + reason), take-profit (price + reason),
   time horizon date, and staged entry plan.

2. Entry price: use the current market price from `$F quote <ticker>`
   (regularMarketPrice field). This simulates a market-on-close order.
   Do NOT use the "ideal" price from the plan.

3. Read existing `~/.finstack/shadow.json` (create if missing with `{"entries":[]}`)

4. Append a new shadow entry:
   - `id`: `s` + timestamp
   - `ticker`, `action`, `entryDate` (today)
   - `totalShares`: total across all tranches
   - `stagedPlan`: array of tranches, each with:
     - `tranche` number, `shares`, `trigger` condition
     - Tranche 1 (immediate): `status: "filled"`, `fillPrice` = current market price
     - Subsequent tranches: `status: "pending"`, `triggerPrice`, `fallbackDate` = entry + 30 days
   - `stopLoss`: `{ price, reason }` from the action plan
   - `takeProfit`: `{ price, reason }` from the action plan
   - `timeHorizon`: the plan's target date
   - `linkedThesis`: thesis ID from theses.json if one exists for this ticker
   - `sourceJudge`, `sourceAct`: journal filenames
   - `status`: `open`

5. Write back to shadow.json
6. For staged entries: fallbackDate = entry date + 30 calendar days.
   After 30 days, if the trigger hasn't been met, shadow fills at
   day-30 close price. This is evaluated by /track or /reflect.
7. Brief confirmation: `Shadow position created: <TICKER> <shares> shares`

## Important

**Never present an action plan without prior analysis.** If there's no
recent /judge output, redirect: "Let's run /judge first. I don't recommend
acting without a thesis."

This protects the user from impulse decisions — the most common retail
investor mistake.

## Learning Deposit

After completing this skill, reflect on the session:

- Did any data source fail or degrade?
- Did you encounter unexpected data formats?
- Did the user correct any of your judgments?
- Did you discover a useful approach worth remembering?

If anything is worth recording for future sessions, deposit it:

```
$F learn add "<one-line summary>" --skill act --type <error|workaround|insight>
```

Only deposit genuinely useful learnings — not routine observations.
