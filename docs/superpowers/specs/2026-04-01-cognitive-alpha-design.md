# finstack v0.2.0 — Cognitive Alpha & Thesis Falsification

**Date**: 2026-04-01
**Status**: Approved
**Focus**: US equities

## Problem Statement

finstack v0.1.0 has four critical gaps identified from institutional investor review:

1. **"Coming soon" debt** — README promises FRED, SEC EDGAR, Alpha Vantage, Polygon, Tushare but only Yahoo Finance is implemented
2. **No moat** — 553 lines of code + prompt templates are trivially replicable
3. **Narrow TAM** — requires CLI + investing + Claude Code intersection
4. **No track record** — no quantitative proof that the system improves decisions

This spec addresses all four. Tushare is removed (US equities focus).

## Solution Overview

Two new systems + data layer expansion:

1. **Cognitive Alpha Engine** — Shadow portfolio that tracks "disciplined you" vs "real you", quantifying behavioral cost in dollars
2. **Thesis Falsification Engine** — Thesis lifecycle management with state machine, natural language falsification tests, and obituary review
3. **Data Layer Expansion** — FRED, SEC EDGAR, Alpha Vantage, Polygon integration
4. **New `/track` skill** — Unified audit layer reading all systems
5. **Existing skill upgrades** — /judge, /act, /sense, /research, /reflect, /cascade all enhanced

### The Aha Moment

> "Your brain is worth +$22,400/quarter. Your hands only captured $12,000. Here's exactly where the $10,400 leaked."

---

## Section 1: Data Layer

### New Data Clients

#### `engine/src/data/fred.ts` — Federal Reserve Economic Data

- Endpoint: `https://api.stlouisfed.org/fred/series/observations`
- Auth: Free API key (register at fred.stlouisfed.org)
- Core series:
  - `DFF` — Federal funds rate
  - `CPIAUCSL` — CPI (inflation)
  - `GDP` — Gross domestic product
  - `UNRATE` — Unemployment rate
  - `T10Y2Y` — 10Y-2Y yield curve spread
  - `VIXCLS` — VIX (volatility index)
- Cache TTL: 1 hour
- Output: `{ series, value, date, unit, previousValue, change }`

#### `engine/src/data/edgar.ts` — SEC EDGAR

- Endpoints:
  - `https://efts.sec.gov/LATEST/search-index?q=<query>&dateRange=custom&startdt=<date>&enddt=<date>&forms=10-K,10-Q,8-K` (full-text search)
  - `https://data.sec.gov/submissions/CIK<cik>.json` (filing list by company)
- Auth: No API key. Requires `User-Agent` header with contact email (SEC policy)
- Ticker → CIK resolution: `https://www.sec.gov/cgi-bin/browse-edgar?company=&CIK=<ticker>&type=&dateb=&owner=include&count=1&search_text=&action=getcompany` or use company_tickers.json
- Cache TTL: 6 hours
- Output: `{ ticker, cik, filings: [{ type, date, url, description }] }`

#### `engine/src/data/alphavantage.ts` — Alpha Vantage

- Endpoint: `https://www.alphavantage.co/query`
- Auth: Free API key (25 calls/day limit)
- Functions used:
  - `EARNINGS` — quarterly earnings history with surprise data
  - `EARNINGS_CALENDAR` — upcoming earnings dates
- Cache TTL: 6 hours (earnings data doesn't change intraday)
- Output for earnings: `{ ticker, quarterly: [{ date, reportedEPS, estimatedEPS, surprise, surprisePct }] }`
- Output for calendar: `{ ticker, nextEarningsDate, fiscalQuarter }`

#### `engine/src/data/polygon.ts` — Polygon.io

- Endpoint: `https://api.polygon.io/v2/aggs/ticker/<ticker>/range/<mult>/<timespan>/<from>/<to>`
- Auth: Free API key (5 calls/min, delayed data)
- Functions used:
  - Historical OHLCV (daily/weekly bars for any date range) — primary use for backtesting
  - Stock splits/dividends: `https://api.polygon.io/v3/reference/dividends` and `/splits`
- Cache TTL: 1 hour for recent data, 24 hours for historical (>30 days old)
- Output: `{ ticker, bars: [{ date, open, high, low, close, volume }], adjusted: true }`

### New Engine Commands

#### `finstack macro [series]`

- No args: snapshot of all core series (DFF, CPIAUCSL, GDP, UNRATE, T10Y2Y, VIXCLS)
- With series ID: detailed history for that series
- Source: FRED
- Requires: FRED API key in keys.json (graceful error if missing)

#### `finstack filing <ticker>`

- Lists most recent 10-K, 10-Q, 8-K filings (last 12 months)
- Returns filing type, date, URL, description
- Source: SEC EDGAR
- Requires: Nothing (free, no key)

#### `finstack history <ticker> --from <date> --to <date>`

- Returns daily OHLCV bars for the specified range
- Source: Yahoo Finance (default), Polygon (fallback/extended history)
- Used by: alpha command (shadow portfolio price lookups), /reflect (decision replay)
- Cache TTL: 1 hour for ranges ending today, 24 hours for fully historical ranges

#### `finstack earnings <ticker>`

- Returns: last 8 quarters of earnings (reported vs estimated, surprise %)
- Returns: next earnings date
- Source: Alpha Vantage
- Used by: thesis check (earnings condition verification), /research

#### `finstack keys set <provider> <key>`

- Stores API key in `~/.finstack/keys.json`
- Providers: `fred`, `alphavantage`, `polygon`
- `finstack keys list` — shows which providers are configured (keys masked)
- `finstack keys remove <provider>` — removes a key

### `~/.finstack/keys.json`

```json
{
  "fred": "abc123",
  "alphavantage": "def456",
  "polygon": "ghi789"
}
```

File permissions should be set to 0600 on creation. Engine checks for key existence before calling Tier 2 APIs and returns a clear error message if missing: `{ "error": "Alpha Vantage API key not configured. Run: finstack keys set alphavantage <your-key>" }`

### Cleanup

- Remove all Tushare references from README.md and any code
- Remove "coming soon" from README.md
- All data sources described in README are implemented

---

## Section 2: Cognitive Alpha Engine

### Shadow Portfolio

#### Data Structure: `~/.finstack/shadow.json`

```json
{
  "entries": [
    {
      "id": "s1712000000",
      "ticker": "NVDA",
      "action": "buy",
      "entryDate": "2026-04-02",
      "totalShares": 12,
      "filledShares": 8,
      "stagedPlan": [
        {
          "tranche": 1,
          "shares": 8,
          "trigger": "immediate",
          "status": "filled",
          "fillPrice": 852.30,
          "fillDate": "2026-04-02"
        },
        {
          "tranche": 2,
          "shares": 4,
          "trigger": "5% dip from entry",
          "triggerPrice": 809.69,
          "fallbackDate": "2026-05-02",
          "status": "pending",
          "fillPrice": null,
          "fillDate": null
        }
      ],
      "stopLoss": {
        "price": 780.00,
        "reason": "FSD regulatory setback or margin collapse below 16%"
      },
      "takeProfit": {
        "price": 1050.00,
        "reason": "Market will have priced in the bull case"
      },
      "timeHorizon": "2026-10-02",
      "linkedThesis": "t1712000000",
      "sourceJudge": "judge-NVDA-2026-04-01.md",
      "sourceAct": "act-NVDA-2026-04-01.md",
      "createdAt": "2026-04-02",
      "status": "open",
      "exitPrice": null,
      "exitDate": null,
      "exitReason": null
    }
  ]
}
```

#### Shadow Execution Rules

These rules are deterministic. Shadow portfolio is a "perfectly disciplined machine" that follows the /act plan exactly.

1. **Entry price**: Day-of close price (from `finstack history`), NOT the idealEntry from /act. Simulates market-on-close order.
2. **Staged entry**: Each tranche has a trigger condition. If the trigger is not met within 30 calendar days, the tranche fills at day-30 close price. Rationale: staged entry means "I want a better price" not "I might not want to buy." 30 days is the patience window.
3. **Stop-loss**: When ticker close price falls below stop-loss price, shadow exits at next-day open (simulates market order on next open). Gap-down risk is reflected — shadow does NOT get the stop-loss price, it gets whatever the market gives.
4. **Take-profit**: Same as stop-loss — exit at next-day open when close exceeds take-profit.
5. **Time horizon**: On the horizon date, shadow exits at that day's close. The thesis had this long to play out; time's up.
6. **Thesis death**: When linked thesis enters `dead` state, shadow exits at next-day open. Thesis-driven stops, not price-driven stops.

#### Deviation Capture

When the user runs `finstack portfolio remove <ticker>` and a shadow entry for that ticker is still open:

The engine outputs a prompt:
```json
{
  "deviation_detected": true,
  "ticker": "NVDA",
  "shadow_status": "open",
  "planned_exit": "2026-10-02",
  "days_remaining": 82,
  "prompt": "You're closing NVDA 82 days before your plan's horizon. Reason?",
  "options": ["thesis-changed", "stop-triggered", "emotional", "need-cash", "other"],
  "usage": "finstack portfolio remove NVDA --reason <reason>"
}
```

The `--reason` flag is added to `portfolio remove`. If omitted when a shadow entry exists, the command still works but records `reason: "unspecified"`. The deviation reason is stored in the shadow entry's `exitReason` field and used by `/reflect` for pattern analysis.

### `finstack alpha` Command

Calculates cognitive alpha by comparing real portfolio performance against shadow portfolio and SPY benchmark.

#### Portfolio Transaction Log

`portfolio.json` must be extended with a `transactions` array to support alpha calculation. Current schema only stores live positions. New schema:

```json
{
  "positions": [...],
  "transactions": [
    {
      "ticker": "NVDA",
      "action": "buy",
      "shares": 8,
      "price": 852.30,
      "date": "2026-04-02",
      "reason": null
    },
    {
      "ticker": "NVDA",
      "action": "sell",
      "shares": 8,
      "price": 910.00,
      "date": "2026-07-03",
      "reason": "emotional"
    }
  ],
  "updatedAt": "..."
}
```

`portfolio add` automatically appends a buy transaction. `portfolio remove` automatically appends a sell transaction (using `$F quote` for current price, or `--price` flag for manual override). This is backward-compatible — existing portfolios without `transactions` simply have no alpha history.

#### Inputs
- `~/.finstack/portfolio.json` — real positions + transaction log
- `~/.finstack/shadow.json` — shadow positions
- `finstack history SPY --from <earliest_decision> --to <today>` — benchmark
- `finstack history <each_ticker>` — current/historical prices for P&L calc

#### Calculation

For each closed position pair (real + shadow):
- Real P&L = (real exit price - real entry price) * real shares
- Shadow P&L = (shadow exit price - shadow entry price) * shadow shares
- Behavioral cost = Real P&L - Shadow P&L (for same ticker)

Aggregate:
- SPY return over the same period = benchmark
- Shadow total return = analytical alpha + benchmark
- Real total return = net alpha + benchmark
- Analytical alpha = Shadow return - SPY return
- Execution drag = Real return - Shadow return
- Net alpha = Analytical alpha + Execution drag

#### Output

```json
{
  "period": {
    "type": "rolling",
    "basis": "last 10 decisions",
    "from": "2026-01-15",
    "to": "2026-03-28"
  },
  "benchmark": {
    "ticker": "SPY",
    "return": 8.2,
    "returnDollars": 16400
  },
  "shadow": {
    "return": 19.4,
    "returnDollars": 38800
  },
  "real": {
    "return": 14.2,
    "returnDollars": 28400
  },
  "analyticalAlpha": {
    "pct": 11.2,
    "dollars": 22400
  },
  "executionDrag": {
    "pct": -5.2,
    "dollars": -10400
  },
  "netAlpha": {
    "pct": 6.0,
    "dollars": 12000
  },
  "behavioralCosts": [
    {
      "pattern": "early-profit-taking",
      "occurrences": 3,
      "totalCost": -4200,
      "details": [
        {
          "ticker": "NVDA",
          "cost": -1800,
          "detail": "Exited day 18, plan said day 45. Missed $35/share upside on 8 shares. Reason: emotional."
        }
      ]
    },
    {
      "pattern": "stop-loss-avoidance",
      "occurrences": 2,
      "totalCost": -2800,
      "details": []
    },
    {
      "pattern": "incomplete-staged-entry",
      "occurrences": 2,
      "totalCost": -3400,
      "details": []
    }
  ],
  "executionFidelity": {
    "followed": 5,
    "total": 10
  },
  "thesisAccuracy": {
    "correct": 7,
    "total": 10
  }
}
```

#### Rolling Window

Alpha is calculated on a rolling basis of the last N decisions (default 10), NOT by calendar period. Rationale: calendar periods are dominated by market environment; decision-rolling windows measure behavioral consistency independent of market regime.

Users can override: `finstack alpha --last 20` or `finstack alpha --from 2026-01-01 --to 2026-03-31`.

---

## Section 3: Thesis Falsification Engine

### Thesis Data Structure: `~/.finstack/theses.json`

```json
{
  "theses": [
    {
      "id": "t1712000000",
      "ticker": "NVDA",
      "thesis": "AI capex cycle continues through 2027",
      "verdict": "lean-buy",
      "conditions": [
        {
          "id": "c1",
          "description": "Q2 EPS beats estimate by >5%",
          "type": "earnings",
          "metric": "earningsSurprisePct",
          "operator": ">",
          "threshold": 5.0,
          "resolveBy": "2026-08-28",
          "note": "Earnings conditions must use metrics available from Alpha Vantage: reportedEPS, estimatedEPS, surprise, surprisePct. Segment-level data (e.g. datacenter revenue) is NOT available programmatically — use event type with falsificationTest + WebSearch instead.",
          "status": "pending",
          "actualValue": null,
          "resolvedAt": null
        },
        {
          "id": "c2",
          "description": "No major cloud provider cuts AI/data center capex by >10%",
          "type": "event",
          "falsificationTest": "Would a reasonable analyst interpret this news as evidence that a top-4 cloud provider (MSFT, GOOGL, AMZN, META) is materially reducing AI infrastructure spending by >10%?",
          "watchTickers": ["MSFT", "GOOGL", "AMZN", "META"],
          "status": "pending",
          "threats": []
        }
      ],
      "status": "alive",
      "statusHistory": [
        { "date": "2026-04-01", "from": null, "to": "alive", "reason": "Registered from /judge" }
      ],
      "createdAt": "2026-04-01",
      "lastChecked": "2026-04-01",
      "obituaryDueDate": null
    }
  ]
}
```

### Thesis State Machine

```
alive → threatened → critical → dead
                  → alive (threat dismissed by /judge re-evaluate)
          
alive → reinforced → alive
          (condition passed, thesis strengthened)

dead → (obituary review after 90 days by /reflect)
```

**State transition rules:**

| Transition | Trigger | Actor |
|---|---|---|
| alive → threatened | `/sense` detects a genuine threat via falsificationTest + Claude judgment | Automatic (alert only) |
| threatened → critical | Multiple threats accumulated OR earnings condition failed | Automatic (alert only) |
| threatened → alive | `/judge` re-evaluates and dismisses the threat | User-initiated |
| critical → dead | `/judge` re-evaluates and confirms thesis is falsified | User-initiated |
| alive → reinforced | Earnings condition passes (actualValue meets threshold) | Automatic via `thesis check` |
| reinforced → alive | After recording the reinforcement evidence | Automatic |
| any → dead | `finstack thesis kill <id> <reason>` | User-initiated |

**Key principle: Machine detects threats, human decides death.** The engine never automatically kills a thesis. It flags, alerts, and tracks — the user runs `/judge` to make the call.

### Event Condition Evaluation

When `/sense` scans news and finds articles mentioning watchTickers for an active thesis:

1. Collect the article title + snippet
2. Send to Claude with the thesis's `falsificationTest` as the evaluation criterion
3. Claude responds with: `{ "isThreat": true/false, "confidence": "high/moderate/low", "reasoning": "one sentence" }`
4. If `isThreat: true` with `confidence: high/moderate`:
   - Add to the condition's `threats` array
   - If thesis is `alive` → transition to `threatened`
   - Output alert in `/sense` results

This uses Claude's NLU capabilities instead of keyword matching. The `falsificationTest` is a natural language question that Claude can evaluate against any news article.

### Engine Commands

#### `finstack thesis list`

```
NVDA  "AI capex continues"      ALIVE        2 conditions pending    since Apr 1
AAPL  "Services > 30% rev"      ALIVE        1 condition pending     since Mar 15
INTC  "Foundry turnaround"      THREATENED   earnings miss Q1        since Feb 20
META  "Ad revenue acceleration" DEAD (Mar 28) manual kill: CPM down   obituary Jun 28
```

#### `finstack thesis check [ticker]`

- If ticker specified: check that ticker's earnings conditions against latest data (`finstack earnings <ticker>`)
- If no ticker: check all theses with earnings conditions whose `resolveBy` date has passed
- Updates condition status: pending → passed/failed
- Updates thesis status if warranted (reinforced or critical)

#### `finstack thesis kill <id> <reason>`

- Sets thesis status to `dead`
- Records reason and date in statusHistory
- Sets `obituaryDueDate` to createdAt + 90 days
- If linked shadow entry exists: shadow exits at next-day open

#### `finstack thesis history`

```json
{
  "summary": {
    "total": 16,
    "alive": 3,
    "dead": 12,
    "threatened": 1
  },
  "causeOfDeath": {
    "earningsMiss": { "count": 5, "pct": 42 },
    "eventFalsified": { "count": 4, "pct": 33 },
    "timeExpired": { "count": 2, "pct": 17 },
    "manualKill": { "count": 1, "pct": 8 }
  },
  "avgLifespanDays": 47,
  "bySector": {
    "Healthcare": { "survived": 4, "total": 5, "rate": 80 },
    "Semiconductors": { "survived": 1, "total": 4, "rate": 25 }
  },
  "prematureKills": 2,
  "obituariesPending": 1
}
```

### Obituary Review

Theses with status `dead` and `obituaryDueDate` in the past are flagged for review.

The obituary review is performed by `/reflect` (not `/track`). The process:

1. Read the dead thesis and its conditions
2. For earnings conditions: fetch current actuals via `finstack earnings <ticker>` — did the conditions that killed the thesis subsequently reverse?
3. For event conditions: WebSearch for recent developments — has the threat that killed the thesis been resolved?
4. **Verdict is based on condition status, NOT price movement.** A thesis is "premature kill" only if the falsification criteria have since un-falsified. Price going up is noted but is NOT the basis for the premature determination.

---

## Section 4: `/track` Skill

### Metadata

```yaml
name: track
description: |
  Quantified mirror. Compares real portfolio against shadow (disciplined you)
  and SPY benchmark. Shows thesis lifecycle, cognitive alpha, behavioral cost
  in dollars. Use when asked to "track", "how am I doing", "show my alpha",
  "thesis status", "performance", or "track record".
allowed-tools:
  - Bash
  - Read
  - Write
  - WebSearch
  - WebFetch
  - Glob
  - Grep
  - AskUserQuestion
```

### Invocation Modes

| Command | Scope |
|---|---|
| `/track` | Global dashboard (compact) |
| `/track NVDA` | Decision replay for one ticker |
| `/track alpha` | Full cognitive alpha breakdown |
| `/track thesis` | Thesis lifecycle status |
| `/track obituary` | Dead thesis review queue |

### `/track` (no args) — Compact Dashboard

Default output follows "Breathe, Never Break the Chain" — 3 numbers + 1 alert:

```
finstack track

Net alpha: +$12,000 (rolling 10 decisions)
  Analysis: +$22,400 | Execution: -$10,400

Thesis: 2 alive, 1 threatened (INTC)
Obituary: 1 due (META)

/track alpha — full breakdown
/track INTC — threatened thesis detail
/track obituary — review META
```

If insufficient data (< 3 completed decision cycles): display what's available and note that track improves with more decisions.

### `/track <ticker>` — Decision Replay

Reconstructs the complete decision chain for one ticker:

1. Read all journal entries matching the ticker (research, judge, act, sense, cascade, reflect)
2. Read shadow entry for the ticker
3. Read thesis for the ticker
4. Fetch current price via `$F quote <ticker>`
5. Reconstruct chronological chain with real vs plan comparison at each step

Output is a narrative timeline (not a table), each entry showing:
- What happened (decision made)
- What the plan said
- What the user actually did
- Deviation (if any) with captured reason
- Shadow position status at that point

Ends with current state: shadow vs real P&L gap, thesis status, and any actionable next step.

### `/track alpha` — Full Cognitive Alpha

Runs `$F alpha` and presents the full breakdown narratively:

- Three-line comparison (SPY / Shadow / Real)
- Analytical alpha in dollars
- Execution drag in dollars with per-pattern breakdown
- Execution fidelity score
- Thesis accuracy score
- Trend over rolling windows (if enough history)

### `/track thesis` — Thesis Status

Runs `$F thesis list` and presents with context:
- Each active thesis with conditions and current status
- Threatened theses highlighted with the specific threat
- Suggested actions (/judge to re-evaluate, /track <ticker> for detail)

### `/track obituary` — Obituary Queue

Lists all dead theses past their obituary due date. For each:
- Original thesis and kill reason
- Current condition status (have they reversed?)
- Verdict: premature kill / justified kill / inconclusive
- Pattern implications

### Architecture: Audit Layer, Not Loop Step

`/track` is NOT part of the cognitive loop. It is a parallel audit layer:

```
/sense → /research → /judge → /act → /reflect
  ↑                                      │
  └──────── cognitive feedback ──────────┘
                    ↕
              /track (audit layer — reads everything, blocks nothing)
```

`/reflect` can pull data from `/track` (via $F alpha, $F thesis commands), but the loop works without `/track`. A user can go sense → judge → act → reflect without ever running /track.

### Deposit

- `/track` (global): writes to `~/.finstack/journal/track-<date>.md`
- `/track <ticker>`: writes to `~/.finstack/journal/track-<ticker>-<date>.md`
- Git commit after deposit

---

## Section 5: Existing Skill Upgrades

### `/judge` — Add Step 6: Thesis Registration

After Step 5 (Deposit), automatically:
1. Extract conditions from the conditional confidence map in the verdict
2. Determine condition types:
   - Specific metrics with thresholds → `earnings` type
   - Event-based conditions → `event` type with natural language `falsificationTest`
3. Write to `~/.finstack/theses.json`
4. Brief confirmation: `Thesis registered: "AI capex continues" — 2 conditions tracked`

### `/act` — Add Step 7: Shadow Entry

After Step 6 (Deposit), automatically:
1. Extract from action plan: ticker, action, entry details, stop-loss, take-profit, time horizon, staged plan
2. Entry price: use current day's close from `$F quote <ticker>` (regularMarketPrice as proxy)
3. Create shadow entry in `~/.finstack/shadow.json`
4. For staged entries: record each tranche with trigger + 30-day fallback date
5. Brief confirmation: `Shadow position created: NVDA 8 shares`

### `/sense` — Add Step 1.5: Thesis Threat Scan + Enhanced Data

**Thesis threat detection:**
1. Read `~/.finstack/theses.json` for all alive/threatened theses
2. For each news item from the scan that mentions a thesis's watchTickers:
   - Send news snippet + thesis's `falsificationTest` to Claude for evaluation
   - If genuine threat: add to threats array, update thesis status, include alert in output

**Enhanced data sources:**
- Add `$F macro` to Step 1 parallel scan — include macro snapshot (rates, CPI, VIX) in the briefing
- Add `$F filing <ticker>` for each portfolio ticker — flag if new SEC filing in last 7 days

### `/research` — Enhanced Data Gathering

In Step 1, add parallel data sources:
- `$F macro` — macro context for the research memo
- `$F filing <ticker>` — latest SEC filings; if new 10-K/10-Q filed recently, WebFetch key sections (Risk Factors, MD&A, segment breakdowns)
- `$F earnings <ticker>` — earnings surprise history for "Key Metrics in Context" section

### `/reflect` — Quantitative Upgrade

**New data sources in Step 0:**
- Run `$F alpha` → cognitive alpha data
- Run `$F thesis history` → thesis accuracy statistics
- Read `~/.finstack/shadow.json` → shadow vs real comparisons
- Check obituary queue → include due obituaries in reflection

**Upgraded output structure:**
1. Hard numbers first (analytical alpha, execution drag, behavioral cost in dollars)
2. Per-pattern breakdown with dollar amounts
3. Deviation reason analysis (from shadow exitReason data)
4. Obituary review for dead theses past due date (using condition status, not price)
5. One specific, actionable coaching recommendation based on the data

### `/cascade` — FRED Integration

In Step 3 (Synthesis):
- For macro-relevant cascades, run `$F macro` to get current rates, yield curve, VIX
- Use real data points instead of assumptions in chain analysis

---

## Section 6: README & Packaging

### README Changes

1. **Data Sources table**: Replace "coming soon" block with implemented table:

| Tier | Source | Data | Key Required |
|------|--------|------|:---:|
| 0 | WebSearch + WebFetch | News, analysis, any public page | No |
| 1 | Yahoo Finance | Quotes, financials, trending | No |
| 1 | SEC EDGAR | 10-K, 10-Q, 8-K filings | No |
| 1 | FRED | Rates, CPI, GDP, unemployment, VIX | Free |
| 2 | Alpha Vantage | Earnings calendar, surprise history | Free |
| 2 | Polygon | Historical OHLCV, splits, dividends | Free |

2. **Loop diagram**: Add /track as audit layer (not in main loop)
3. **Remove**: All Tushare references
4. **Add**: /track skill description
5. **Add**: Cognitive Alpha and Thesis Falsification feature descriptions

### Version

- `package.json` version: `0.1.0` → `0.2.0`

### Setup Script

- Add `/track` to the SKILLS array
- No other changes needed (Tier 2 APIs are optional; keys configured post-install)

### New Files Summary

```
engine/src/
  data/
    fred.ts          # FRED API client
    edgar.ts         # SEC EDGAR API client
    alphavantage.ts  # Alpha Vantage API client
    polygon.ts       # Polygon.io API client
    keys.ts          # API key management
  commands/
    macro.ts         # finstack macro
    filing.ts        # finstack filing
    history.ts       # finstack history
    earnings.ts      # finstack earnings
    alpha.ts         # finstack alpha
    thesis.ts        # finstack thesis
    keys.ts          # finstack keys

track/
  SKILL.md           # /track skill template

~/.finstack/
  shadow.json        # Shadow portfolio (new)
  theses.json        # Active thesis register (new)
  keys.json          # API keys (new)
```

### Modified Files

```
engine/src/
  cli.ts                  # Add new command routing
  cache.ts                # Add new TTLs (edgar: 6h, earnings: 6h, history: 1h/24h)
  commands/portfolio.ts   # Add --reason flag to remove, --price flag to remove, transaction log on add/remove

sense/SKILL.md            # Add thesis threat scan + FRED + EDGAR
research/SKILL.md         # Add FRED + EDGAR + earnings
judge/SKILL.md            # Add thesis registration step
act/SKILL.md              # Add shadow entry step
reflect/SKILL.md          # Quantitative upgrade with alpha data
cascade/SKILL.md          # Add FRED integration

README.md                 # Rewrite data sources, add /track, remove coming soon
package.json              # Version bump
setup                     # Add track to SKILLS array
```
