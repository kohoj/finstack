# finstack Architecture

> An operating system for investment thinking — one person + AI = a hedge fund's research department.

## Design Philosophy

finstack is built on a **dual-layer architecture**: a lightweight **data layer** (compiled binary) and a powerful **cognitive layer** (Codex skills).

### Why This Split?

**Data operations are deterministic.** Fetching a quote, parsing SEC filings, caching responses — these are solved problems. They need speed, reliability, and offline-first behavior. A compiled binary delivers this with zero startup time and predictable resource usage.

**Cognition is emergent.** Adversarial reasoning, chain-reaction tracing, pattern recognition across 100+ journal entries — these require the full power of a frontier LLM with 1M context. The skills orchestrate the model's reasoning, not by calling narrow functions, but by shaping how it thinks.

This separation means:
- The engine can be rebuilt in 2 seconds (Bun compile)
- Skills are plain Markdown, editable without a rebuild
- Data fetching never blocks AI reasoning
- The system degrades gracefully (no API key? Use stale cache or web search)

### The Cognitive Loop

finstack is not a collection of tools. Its skills refer to each other, and the
shape they form is a hub with a feedback loop, not a chain:

```
  screen ──┐                    ┌──► act ──┐
           ├──► research ──┐    │          │
           │               ▼    │          │
  sense ───┴──────────► JUDGE ──┤          │
           │               ▲    │          │
           └──► cascade ───┘    └──► cascade
                                          │
  track ──► reflect ──► sense             │
     ▲                                    │
     └────────────────────────────────────┘
```

**judge is the hub.** Six of the nine skills point at it: sense, research,
cascade, track, reflect, and screen all end by suggesting `/judge`. It is where
a signal becomes a decision, so everything upstream funnels into it and
everything downstream flows out of it.

- **sense** — filter the world down to the few signals that matter to you
- **research** — produce a memorandum with traceable claims, not a data dump
- **judge** — Bull vs Bear adversarial exchange, ending in conditional confidence
- **act** — position sizing, stops, horizon, cross-checked against your patterns
- **cascade** — trace chain reactions across several causal paths in parallel
- **track** — real vs shadow portfolio, cognitive alpha, behavioral cost
- **reflect** — separate luck from skill, extract patterns, update the profile
- **screen** — find candidates you do not already know about
- **review** — periodic retrospective over a time window

Two skills sit outside the loop by design:

**screen is the funnel.** Everything else asks "what is happening to what I
already hold or watch." screen asks "what else exists that meets these
criteria." It writes nothing to `~/.finstack/` — it is a search, not a decision.

**review is a read-only report.** It aggregates a week or a month and changes
nothing. That is what distinguishes it from reflect, which writes `patterns/`
and `profile.json` and therefore changes how later skills behave.

The loop is **gravity, not a rail**. Enter at any point, leave at any point.

### The Shadow Portfolio Loop

The skill graph above is what the user navigates. Underneath it runs a second
loop that nothing in the interface names, and it is the mechanism that makes
the system improve rather than merely record:

```
  act        writes a staged plan to shadow.json
   │         ("what a disciplined version of you would do")
   ▼
  track      compares real trades against that plan
   │         → analytical alpha  (was the thinking good?)
   │         → execution drag    (was the doing good?)
   ▼
  reflect    attributes the gap to a named behavioral pattern
   │         and writes patterns/<name>.md
   ▼
  act        reads patterns/ and warns before the user repeats it
   │
   └──────────────────────────► (loop closes)
```

This is the only path by which finstack modifies its own future behavior. A
pattern file written by reflect contains a `Recommendation:` field, and that
text is loaded into act's context on the next invocation — so the system's
output becomes the system's input.

It is also what lets finstack say something no portfolio tracker can:

> Your analysis is good — 70% thesis accuracy is above average. Your problem
> is not what you think. It's what you do after you think.

That sentence requires separating decision quality from execution quality, and
that requires a counterfactual portfolio to compare against. Everything else in
the architecture exists to keep that comparison honest.

### Data Tiering

finstack works **out of the box** with zero API keys, then unlocks progressively deeper data:

| Tier | Source | Data | Key Required |
|------|--------|------|:---:|
| 0 | WebSearch + WebFetch | News, analysis, any public page | No |
| 1 | Yahoo Finance | Quotes, financials, trending | No |
| 1 | SEC EDGAR | 10-K, 10-Q, 8-K filings | No |
| 1 | FRED | Macro indicators | Free key |
| 2 | Alpha Vantage | Earnings calendar + surprise | Free key |
| 2 | Polygon | Historical OHLCV, splits, dividends | Free key |
| 2 | FMP | Financial ratios | Free key |

Tier 0 + Tier 1 covers most needs. Commands degrade rather than fail when a
Tier 2 source is unavailable — see the fallback table below for exactly how far
each one degrades.

## System Architecture

### Engine Binary

**Location**: `engine/dist/finstack`  
**Source**: `engine/src/` (TypeScript compiled with Bun)  
**Purpose**: Deterministic data operations — fetch, parse, cache, validate

The engine is a **standalone executable** built via `bun build --compile`. Zero dependencies at runtime. The CLI dispatches to 24 commands:

```typescript
// engine/src/cli.ts
const commands = {
  // Data retrieval — external sources, cached
  quote, financials, history, earnings, filing, macro, scan, calendar,
  // State management — local JSON
  portfolio, watchlist, thesis, shadow, regime, keys, learn,
  // Analysis — computed from state and market data
  risk, alpha, correlate, scenario, backtest, screen,
  // Reporting
  alerts, report, review,
};
```

Network-backed commands degrade through a **fallback chain**:

1. Check fresh cache (TTL-based)
2. Try primary data source (Yahoo, FRED, EDGAR, Alpha Vantage)
3. Try secondary source (Polygon, FMP) if a key is configured
4. Return stale cache with `_stale: true` and `_cacheAge`
5. Throw `FinstackError` with source, reason, and a suggestion

Not every command implements every step, and the difference is deliberate:

| Command | Fresh cache | Secondary | Stale fallback | Structured error |
|---------|:---:|:---:|:---:|:---:|
| `quote` | ✓ | Polygon | ✓ | ✓ |
| `financials` | ✓ | FMP | ✓ | ✓ |
| `history` | ✓ | Polygon | ✓ | ✓ |
| `earnings` | ✓ | — | ✓ | ✓ |
| `macro` | ✓ | — | ✓ | ✓ |
| `scan` | ✓ | — | ✓ | ✓ |
| `screen` | ✓ | — | — | ✓ |
| `filing` | ✓ | — | — | — |
| `calendar` | ✓ | — | — | — |
| `correlate` | ✓ | — | — | — |

**Why some commands have no secondary source.** Only three data types are
available from two providers. Earnings history exists only on Alpha Vantage,
filings only on EDGAR, macro series only on FRED. A secondary cannot be added
where no second source exists.

**Why `filing` has no stale fallback.** Filings are legal disclosures. Serving
a six-hour-old list without saying so risks the user concluding a company has
not filed something when it has. Reporting that EDGAR is unreachable is the
safer failure.

**Why `calendar` and `correlate` have neither.** Both fan out over many tickers
and tolerate partial results — a calendar missing one company is still useful.
They aggregate per-ticker caches rather than maintaining one of their own.

**Verification.** These rows are covered by tests, one per transition, in
`engine/test/commands/`. The table is not a description of intent; it is a
description of what is asserted.

**Why compiled?** Startup time matters. `finstack quote AAPL` runs in ~100ms including network. An interpreted runtime would add 200-500ms overhead. When `/sense` scans 10 tickers in parallel, that's 2-5 seconds saved.

### Skills

**Location**: `{sense,research,judge,act,cascade,track,reflect,screen,review}/SKILL.md`  
**Purpose**: Orchestrate the model's reasoning

Each skill is a **prompt template** with three sections:

1. **YAML frontmatter**: name, description, allowed-tools
2. **Bash preamble**: Environment setup — locate engine binary, check version, rebuild if needed
3. **Instruction body**: Step-by-step reasoning protocol

**The preamble pattern**, identical across all nine skills (asserted by
`check:docs`) — abridged here to the parts that carry a decision:

```bash
# The host sets CODEX_PLUGIN_ROOT for an installed plugin; the git fallback
# covers working directly in a clone.
_SK="${CODEX_PLUGIN_ROOT:-${PLUGIN_ROOT:-}}"
[ -n "$_SK" ] && [ -d "$_SK/engine/src" ] || _SK=$(git rev-parse --show-toplevel 2>/dev/null)

F="${FINSTACK_HOME:-$HOME/.finstack}/bin/finstack"

# ... if the binary is missing or older than the source, install Bun if
# needed and compile. Then:
[ -x "$F" ] && echo "ENGINE: $F" || echo "ENGINE_MISSING"
```

Three decisions are embedded here.

**The binary lives outside the plugin directory.** Installed plugins land in
`~/.codex/plugins/cache/$MARKETPLACE/$PLUGIN/$VERSION/` — that path contains
the version, so an upgrade would orphan anything written into it, and a
read-only cache would fail the write outright. `~/.finstack/bin/` survives
upgrades and is somewhere the user already owns.

**It builds on first use rather than shipping precompiled.** Three platform
binaries would add ~220MB to every `marketplace add`. Compiling takes about
two seconds, once, and produces a binary matched to the actual machine.

**It installs Bun itself if missing.** Bun's installer needs no sudo and
writes only to `~/.bun`. Telling the user to go install a toolchain before
they can ask their first question is a worse trade than doing it for them.

The result: skills work from an installed plugin or a clone, the engine
rebuilds when source changes, and `ENGINE_MISSING` is a text signal the model
reads to decide whether to degrade to web search.

**Why SKILL.md?** The host loads these as **context-injected prompts**. They do not just say what to do — they shape how the model reasons. `judge` does not call a "judgment API" — it orchestrates a multi-turn adversarial exchange where Bull builds the case, Bear attacks the weakest assumption with historical evidence, and a final synthesis delivers a verdict with conditional confidence.

### Storage Schema

**Location**: `~/.finstack/`  
**Philosophy**: Git-tracked cognitive memory

Every state file is JSON (human-readable, `git diff`-able, auditable). The directory is a git repository initialized during setup.

```
~/.finstack/
├── .git/                  # Full decision history
├── portfolio.json         # Current holdings + transaction log
├── shadow.json            # Shadow portfolio (disciplined-you simulator)
├── theses.json           # Thesis register + falsification conditions
├── consensus.json        # Market assumptions + stress tracking
├── watchlist.json        # Tickers being monitored
├── keys.json             # API keys (0o600 permissions)
├── profile.json          # Risk tolerance, style, blind spots
├── config.yaml           # System config (auto_upgrade, update_check)
├── cache/                # TTL-based API response cache
├── journal/              # Decision logs (sense-2026-04-07.md, etc.)
├── patterns/             # Behavioral patterns (exits-tech-early.md)
├── reports/              # Generated research memos
└── sessions/             # Multi-turn skill session logs
```

**Key design choices:**

**Git tracking**: `git log journal/` is your investment decision history. `git diff consensus.json` shows how your market assumptions evolved. Auditable, reversible, and free version control.

**Atomic writes**: All JSON writes use `atomicWriteJSON()` — write to temp file, rename. Never risk corrupt state from partial writes.

**Concurrency**: Atomic writes prevent a *torn* file. They do not prevent a
*lost* one. Every state mutation is a read-modify-write cycle, and two processes
interleaving both read the same base and both write — so one update disappears.
This is reachable in normal use: skills run engine commands in parallel, and a
second Codex session can be open at any time.

Measured before the fix, 20 parallel `portfolio add` calls recorded 17 of 20
transactions. 15 parallel `regime add` calls recorded 12.

Every mutation now runs inside `withFileLock()` — a mkdir-based mutex, atomic on
POSIX — wrapping the *whole* cycle:

```typescript
function mutate<T>(fn: (p: Portfolio) => T): T {
  return withFileLock(PORTFOLIO_FILE, () => {
    const p = load();      // read
    const result = fn(p);  // modify
    save(p);               // write
    return result;
  });
}
```

Locking only the write would do nothing: the race is between the read and the
write.

| File | Locked | Why |
|------|:---:|-----|
| `portfolio.json` | ✓ | Concurrent add/remove lost transactions |
| `theses.json` | ✓ | /sense adds threats while /judge appends theses |
| `shadow.json` | ✓ | /act appends while `portfolio remove` closes |
| `consensus.json` | ✓ | /sense updates while the user edits by hand |
| `watchlist.json` | ✓ | Multiple sessions |
| `keys.json` | ✓ | Rare, but the failure is silent |
| `cache/*.json` | — | A lost cache write is a cache miss |
| `sessions/*.json` | — | One file per ppid, never shared |

On timeout the lock is broken and the operation proceeds anyway. A stale lock
from a killed process must not wedge the CLI permanently, and losing one update
is better than refusing to run.

**Permission enforcement**: `keys.json` is written with `0o600` (user-read-only). The cache directory is world-readable (contains no secrets).

**Separation of concerns**:
- `portfolio.json` = ground truth (what you actually own)
- `shadow.json` = what you WOULD own if you followed every `/act` plan perfectly
- `theses.json` = falsifiable hypotheses with machine-monitored conditions
- `consensus.json` = market assumptions with stress tracking (regime change detection)

### The Relationship Between Skills and Engine

**Skills are the brain. Engine is the sensory system.**

Skills invoke the engine via shell commands:

```bash
$F quote AAPL              # Get price snapshot
$F financials AAPL         # Get financial ratios
$F scan --source all       # Multi-source signal scan
$F regime update 3 6 "TSMC capex cut"  # Update consensus assumption
$F portfolio add AAPL 100 150  # Record transaction
$F thesis kill abc123 "Margin thesis invalidated"
```

The engine returns **structured JSON** (never unstructured text). Skills parse this and reason over it.

**Example flow** (`/sense` → portfolio exposure check):

1. Skill runs: `$F portfolio show`
2. Engine reads `~/.finstack/portfolio.json`, returns JSON
3. Skill parses positions, extracts tickers
4. Skill runs: `$F quote TSLA` for each ticker in parallel
5. Engine checks cache → Yahoo Finance → returns quote JSON
6. Skill correlates news signals against held tickers
7. Skill writes `journal/sense-2026-04-07.md` with findings
8. Skill commits: `cd ~/.finstack && git commit -m "sense: 2026-04-07 — 3 signals"`

The engine never "knows" what a thesis *means* or what `/sense` is trying to
achieve. It provides primitives; skills compose them into cognitive workflows.

The one place that split needed care is state whose content is reasoning — a
thesis with falsifiable conditions, a staged entry plan with a rationale on
every stop. Those cannot come from CLI flags. They are composed by the skill
and piped in:

```bash
echo '<json>' | $F thesis add
echo '<json>' | $F shadow add
```

The engine validates before writing (`engine/src/schema.ts`), enforcing
invariants a JSON Schema cannot express: tranche shares summing to the
position, a long's stop below its take-profit, a filled tranche carrying a
fill price. Unknown fields are rejected with an edit-distance suggestion,
because a silently dropped typo produces a condition that looks valid and can
never fail.

## Data Flow

### Invocation Flow: `/sense` Example

```
User types: /sense
    ↓
Codex loads: skills/sense/SKILL.md
    ↓
Preamble executes (bash):
  - Locate engine binary at _SK/engine/dist/finstack
  - Auto-rebuild if source newer than binary
  - Set $F = path to binary
    ↓
Instruction body:
  Step 0: Read portfolio.json, consensus.json, watchlist
  Step 1: Run $F scan --source all in parallel with WebSearch
    ↓
    Engine (scan command):
      - Check cache/scan.json (TTL: 15 min)
      - If stale: fetchTrending() from Yahoo Finance
      - If Yahoo fails: return cached with _stale flag
      - Write cache, return JSON
    ↓
  Step 1.5: Read theses.json, check for threats
  Step 2: Filter and rank signals (AI reasoning)
  Step 3: Format as briefing (AI synthesis)
  Step 4: Check consensus.json for regime warnings
  Step 5: Write journal/sense-2026-04-07.md
  Step 5: Git commit in ~/.finstack
    ↓
Output to user: Clean briefing with 🔴🟡🟢 urgency tags
```

**Key observations:**

- **Parallel data fetching**: Skills run multiple `$F` commands in parallel via Bash job control
- **Graceful degradation**: If engine missing, skills fall back to WebSearch
- **State accumulation**: Every invocation reads from AND writes to cognitive memory
- **Git lineage**: Full audit trail via git commits in `~/.finstack/`

### Cache Strategy

**Location**: `~/.finstack/cache/`  
**Implementation**: `engine/src/cache.ts`

Every cached file has this structure:

```json
{
  "ticker": "AAPL",
  "price": 178.32,
  "change": 2.45,
  "_cachedAt": 1712503842000,
  "_v": 2
}
```

**TTL by data type** (`cache.ts:9-18`):

```typescript
const TTL: Record<string, number> = {
  quote: 5 * 60 * 1000,           // 5 minutes
  financials: 60 * 60 * 1000,     // 1 hour
  scan: 15 * 60 * 1000,           // 15 minutes
  macro: 60 * 60 * 1000,          // 1 hour
  filing: 6 * 60 * 60 * 1000,     // 6 hours
  earnings: 6 * 60 * 60 * 1000,   // 6 hours
  history: 60 * 60 * 1000,        // 1 hour
  'history-old': 24 * 60 * 60 * 1000,  // 24 hours (>1 year old data)
};
```

**Cache invalidation**: TTL-based, checked on read. No background workers. Expired cache is treated as "stale but usable" — commands return it with `_stale: true` if live fetch fails.

**Why version field?** Cache schema changes between versions. `_v` mismatch → ignore cache, re-fetch. Prevents corrupt data from old versions.

**Security**: Cache files contain NO API keys. Error logs contain NO API keys. Only sanitized ticker symbols and response data.

## Network Reliability

### Retry Logic

**Implementation**: `engine/src/net.ts`

```typescript
fetchWithRetry(url, opts, {
  retries: 2,
  backoffMs: [1000, 3000],  // 1s, then 3s
  timeoutMs: 10_000
})
```

**Retry decision tree**:

- **4xx errors**: NO retry (client error, not transient)
- **5xx errors**: RETRY up to limit (server error, likely transient)
- **Network errors**: RETRY (timeout, connection refused, DNS failure)
- **Timeout**: RETRY (slow network)

**Why exponential backoff?** `[1000, 3000]` means: fail → wait 1s → retry → fail → wait 3s → retry → fail → throw. This avoids hammering a struggling API.

### Fallback Chains

Every command implements source priority. Example from `quote.ts:24-64`:

```
1. Check fresh cache (< 5 min old)
   ↓ MISS
2. Try Yahoo Finance (free, no key)
   ↓ FAIL
3. Try Polygon (if API key configured)
   ↓ FAIL
4. Return stale cache with _stale flag
   ↓ MISS
5. Throw structured error with suggestion
```

**Data source priority tables**:

| Data Type | Primary | Secondary | Tertiary |
|-----------|---------|-----------|----------|
| Quote | Yahoo | Polygon | Stale cache |
| Financials | Yahoo | Stale cache | — |
| Macro | FRED | Stale cache | — |
| Filings | SEC EDGAR | Stale cache | — |
| Earnings | Alpha Vantage | Stale cache | — |
| History | Yahoo | Polygon | Stale cache |

**Why Yahoo as primary?** No API key required. Rate limits are generous (~2000 req/hour with cookie/crumb rotation). Works globally.

### Special Case: Yahoo Finance Cookie/Crumb Rotation

Yahoo Finance requires a consent cookie + crumb token for some endpoints. `data/yahoo.ts:15-47` implements:

1. Fetch consent from `fc.yahoo.com`
2. Extract cookies from Set-Cookie headers
3. Request crumb from `/v1/test/getcrumb` with cookies
4. Cache crumb + cookies for 30 minutes
5. Rotate user-agent on each request (avoid fingerprinting)

If crumb fetch fails (401/403), clear cache and retry once. This pattern handles Yahoo's anti-scraping measures without breaking.

## Security Model

### API Key Storage

**File**: `~/.finstack/keys.json`  
**Permissions**: `0o600` (user read/write only)  
**Implementation**: `engine/src/data/keys.ts`

```typescript
export function setKey(provider: string, key: string, file = KEYS_FILE): void {
  const data = load(file);
  data[provider as Provider] = key;
  save(data, file);  // Calls atomicWriteJSON with mode 0o600
}
```

**Why 0o600?** Group/other cannot read. Prevents accidental exposure via `ls -la` or other users on shared systems.

**Key masking**: `finstack keys list` returns `abc***` (first 3 chars visible). Full keys never logged.

### Ticker Validation

**Implementation**: Commands use `toUpperCase()` and URL encoding

```typescript
const ticker = args[0]?.toUpperCase();
// ...
fetchChart(`/v8/finance/chart/${encodeURIComponent(ticker)}?...`)
```

**Why this matters**: Prevents path traversal attacks. Without `encodeURIComponent()`, a malicious ticker like `../../etc/passwd` could escape the API path.

### Error Sanitization

**Implementation**: `engine/src/errors.ts`

```typescript
export function formatErrorJSON(err: Error): string {
  if (err instanceof FinstackError) {
    const obj: Record<string, unknown> = { error: err.message };
    if (err.source) obj.source = err.source;
    if (err.reason) obj.reason = err.reason;
    if (err.suggestion) obj.suggestion = err.suggestion;
    // NEVER include stack traces or raw API responses
    return JSON.stringify(obj);
  }
  return JSON.stringify({ error: err.message });
}
```

**What's excluded**:
- Stack traces (could leak file paths)
- Raw API responses (could contain keys in headers)
- Environment variables

**What's included**:
- Sanitized error message
- Data source name (`yahoo`, `fred`, `polygon`)
- User-facing suggestion (`Configure API key: finstack keys set polygon YOUR_KEY`)

### No Secrets in Cache

Cache files contain ONLY public data:

```json
{
  "ticker": "AAPL",
  "price": 178.32,
  "_cachedAt": 1712503842000,
  "_v": 2
}
```

No API keys, no cookies, no authentication tokens. This means:
- Cache can be shared (team mode via git)
- Cache can be inspected safely
- Accidental `git add ~/.finstack/cache` won't leak secrets

## Version & Update System

### Binary Auto-Rebuild

**When**: Every skill invocation (via preamble)  
**How**: Check if any file in `engine/src/` is newer than `engine/dist/finstack`

```bash
F="$_SK/engine/dist/finstack"
if [ -x "$F" ] && [ -d "$_SK/engine/src" ]; then
  _NEWEST=$(find "$_SK/engine/src" "$_SK/package.json" -newer "$F" 2>/dev/null | head -1)
  if [ -n "$_NEWEST" ]; then
    (cd "$_SK" && bun run build 2>/dev/null)
  fi
fi
```

**Developer experience**: Modify `engine/src/commands/quote.ts` → save → invoke `/sense` → engine auto-rebuilds → new code runs. No manual build step.

### Updates

Codex owns this now:

```bash
codex plugin marketplace upgrade
```

finstack previously carried its own version-check script and a SessionStart
hook that pulled and rebuilt on every session. Both were deleted with the move
to a plugin — reimplementing what the host already does means two update paths
that can disagree, and the loser is whichever one the user forgets about.

The engine still rebuilds itself when its source is newer than the binary, so
upgrading the plugin is enough; the next skill invocation picks up the change.

## Testing Strategy

Four layers, each answering a different question.

| Layer | Location | Question it answers |
|-------|----------|---------------------|
| Unit | `engine/test/{cache,fs,net,errors,validation}.test.ts` | Does this function behave? |
| Command | `engine/test/commands/` | Does this command handle its inputs, sources, and failures? |
| Integration | `engine/test/integration/` | Do commands compose correctly across a sequence? |
| Adversarial | `engine/test/adversarial.test.ts` | What happens under hostile input? |
| E2E | `test/skill-e2e/` | Does the skill actually run end to end? |

**Runner**: `bun test`. Zero config, TypeScript native, full suite in ~8s.

### What the command layer covers

Every command has a test file. For the ten network-backed commands, each step
of the fallback chain is asserted separately — a fresh cache hit issues zero
requests, a primary failure reaches the secondary, a total outage degrades to
stale data flagged with `_stale`, and only an empty cache produces an error.

Network is mocked by replacing `globalThis.fetch` with a matcher-driven stub
(`engine/test/helpers.ts`). An unmatched URL throws rather than returning a
default, so a test cannot accidentally pass by hitting a path nobody modelled.

`FINSTACK_NO_BACKOFF=1` zeroes retry delays without changing retry counts. The
code path under test is identical; it just does not sleep. Without it, each
simulated outage costs four seconds of real waiting.

### What the integration layer covers

Three sequences that no single command owns:

- **portfolio-lifecycle** — buy, average down, sell, and the invariant that the
  transaction log stays a complete audit trail
- **thesis-lifecycle** — register, threaten, escalate, kill, obituary; the state
  machine spans four skills
- **shadow-alpha** — the real-vs-shadow join that produces cognitive alpha

### Test isolation

Tests run in-process against a temp `FINSTACK_HOME`. This works because
`paths.ts` exposes getters rather than constants, so the directory is resolved
per access.

That property was added because of this failure: with module-load constants,
whichever test file imported `paths.ts` first froze the value for the entire
process. Seven test files passed individually and produced thirty failures when
run together, all writing into one directory.

### E2E

`test/skill-e2e/` drives real skills through `codex exec` against fixture data.
Gated behind `EVALS=1` because it costs API calls:

```bash
EVALS=1 bun test test/skill-e2e/
```

The assertion targets are structural rather than semantic — that the expected
engine commands were invoked, that a journal entry was written, that the output
carries the skill's characteristic markers. Asserting on LLM prose would be
flaky without testing anything the prose is supposed to guarantee.

**Run it by hand after changing a SKILL.md**, which is the only time it can
tell you anything. It is deliberately not in CI: a skill is a prompt, so the
suite has to start real Codex sessions, and running that on a schedule
spends API budget re-verifying files that have not changed. Four harness tests
do run in the normal suite — they check the runner itself without spending
anything.

## Extending finstack

### Adding a New Command

1. **Create command file**: `engine/src/commands/mycommand.ts`

```typescript
export async function mycommand(args: string[]) {
  const input = args[0];
  if (!input) {
    console.error(JSON.stringify({ error: 'Usage: finstack mycommand <input>' }));
    process.exit(1);
  }
  
  // Fetch data, use cache, handle errors
  const result = { ... };
  console.log(JSON.stringify(result, null, 2));
}
```

2. **Register in CLI**: `engine/src/cli.ts`

```typescript
import { mycommand } from './commands/mycommand';

const commands: Record<string, (args: string[]) => Promise<void>> = {
  // ...
  mycommand,
};
```

3. **Rebuild**: `bun run build`

4. **Use in skills**: `$F mycommand <input>`

### Adding a New Skill

1. **Create the directory**: `mkdir -p skills/myskill`

2. **Write SKILL.md**:

```markdown
---
name: myskill
description: |
  What this skill does, in a sentence or two.
  Use when asked to "...", "...", or "...".
---

# myskill — Purpose

## Binary Resolution

[Copy the preamble verbatim from any existing skill]

## Learnings Context
## Step 1: ...
## Step 2: ...
## Learning Deposit
```

3. **Register it** in the `SKILLS` array in `scripts/check-docs.ts`

4. **Restart Codex** to pick it up

The `description` is the entire trigger mechanism. Skills are model-invoked —
there is no slash command — so it must name the phrasings a user would actually
reach for. `check:docs` verifies the preamble matches the other nine and that
the Learnings sections carry their guidance, both of which have silently
drifted before.

### Adding a New Data Source

1. **Create data client**: `engine/src/data/newsource.ts`

```typescript
import { fetchWithRetry } from '../net';

export async function fetchFromNewSource(query: string) {
  const res = await fetchWithRetry(`https://api.newsource.com/${query}`, {
    headers: { 'Authorization': `Bearer ${getKey('newsource')}` }
  });
  return res.json();
}
```

2. **Add key type**: `engine/src/data/keys.ts`

```typescript
type Provider = 'fred' | 'alphavantage' | 'polygon' | 'fmp' | 'newsource';
```

3. **Use in command**: Integrate into fallback chain

4. **Document**: Update README data sources table

## Why These Choices?

### Why Bun?

- **Fast**: Startup in ~10ms (Node.js: ~50ms)
- **Compile to binary**: Zero runtime dependencies
- **TypeScript native**: No build config needed
- **Built-in test runner**: No Jest/Mocha setup

### Why Git for Cognitive Memory?

- **Auditable**: `git log` = decision history
- **Reversible**: Undo bad decisions via `git revert`
- **Diffable**: See how your thinking evolved
- **Free**: No database setup, no migrations
- **Portable**: `tar ~/.finstack` = your entire investment brain

### Why JSON Instead of a Database?

- **Human-readable**: `cat portfolio.json` shows your positions
- **Git-friendly**: Diffs are meaningful
- **Zero setup**: No migrations, schemas, connection pools
- **Portable**: Works on any machine with a filesystem
- **Inspectable**: Debug state without query tools

Trade-off: No complex queries. But finstack's state is simple enough that linear scans over JSON arrays (< 1000 items) are sub-millisecond.

### Why Skill Preambles Instead of a Daemon?

**Preambles run on every invocation**. This seems inefficient — why not run a background service?

**Reasons**:
1. **Simplicity**: No daemon management, no port conflicts, no "is it running?" debugging
2. **Isolation**: Each skill invocation is independent — crash can't break future invocations
3. **Developer experience**: Rebuild on file change happens automatically
4. **Portability**: Works on any Unix system without install scripts

The overhead (~50ms for binary check + rebuild check) is negligible compared to LLM reasoning time (5-30 seconds).

### Why Compiled Binary Instead of Scripts?

**Speed**: `bun run src/cli.ts quote AAPL` → ~200ms startup  
**Compiled**: `./dist/finstack quote AAPL` → ~10ms startup

When `/sense` scans 10 tickers in parallel, that's 1.9 seconds saved. Over 100 invocations/week, that's 3+ minutes of saved waiting.

**Deployment**: Copy one binary vs `node_modules/` (100+ MB).

**Trade-off**: Rebuild required on code change. But the preamble handles this automatically.

---

**This architecture enables one person to think at institutional quality without institutional overhead.**

The engine provides speed and reliability. The skills provide cognitive leverage. The git-tracked memory provides continuity. Together, they form a system that gets smarter with every decision you make.

Not a data terminal. A thinking partner.
