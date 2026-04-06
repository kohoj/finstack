# finstack Architecture

> An operating system for investment thinking — one person + AI = a hedge fund's research department.

## Design Philosophy

finstack is built on a **dual-layer architecture**: a lightweight **data layer** (compiled binary) and a powerful **cognitive layer** (Claude Code skills).

### Why This Split?

**Data operations are deterministic.** Fetching a quote, parsing SEC filings, caching responses — these are solved problems. They need speed, reliability, and offline-first behavior. A compiled binary delivers this with zero startup time and predictable resource usage.

**Cognition is emergent.** Adversarial reasoning, chain-reaction tracing, pattern recognition across 100+ journal entries — these require the full power of a frontier LLM with 1M context. The skills orchestrate Claude Code's reasoning capabilities, not by calling narrow functions, but by shaping how it thinks.

This separation means:
- The engine can be rebuilt in 2 seconds (Bun compile)
- Skills can be modified while Claude Code is running (hot reload)
- Data fetching never blocks AI reasoning
- The system degrades gracefully (no API key? Use stale cache or web search)

### The Cognitive Loop

finstack is not a collection of tools. It is a closed-loop system:

```
Sense → Research → Judge → Act → Cascade → Track → Reflect
  ↑                                                      │
  └──────────────── cognitive feedback ─────────────────┘
```

- **Sense**: Filter the world down to N signals that matter to YOU
- **Research**: Produce memorandums, not data dumps, with full source tracing
- **Judge**: Bull vs Bear adversarial exchange, verdict with conditional confidence
- **Act**: Position sizing, stop-loss, time horizon — cross-checked against your patterns
- **Cascade**: Trace chain reactions across N causal paths in parallel
- **Track**: Real vs shadow portfolio → cognitive alpha → behavioral cost in dollars
- **Reflect**: Extract patterns from decisions → update profile → shape future invocations

The loop is **gravity, not a rail**. Enter at any point. Exit at any point. But every action feeds back into the system's understanding of you.

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

Tier 0 + Tier 1 covers 90% of needs. Skills **never fail** when Tier 2 is unavailable — they adapt using fallback chains.

## System Architecture

### Engine Binary

**Location**: `engine/dist/finstack`  
**Source**: `engine/src/` (TypeScript compiled with Bun)  
**Purpose**: Deterministic data operations — fetch, parse, cache, validate

The engine is a **standalone executable** built via `bun build --compile`. Zero dependencies at runtime. The CLI dispatches to 15 commands:

```typescript
// engine/src/cli.ts
const commands = {
  quote, financials, scan, regime, portfolio, keys, macro,
  filing, history, earnings, alpha, thesis, risk, watchlist, alerts
};
```

Each command follows the **fallback chain pattern**:

1. Check fresh cache (TTL-based)
2. Try primary data source (Yahoo, FRED, EDGAR)
3. Try secondary source (Polygon, Alpha Vantage) if key configured
4. Return stale cache with `_stale: true` flag
5. Throw structured error with suggestion

**Example**: `quote.ts` tries Yahoo → Polygon → stale cache before failing.

**Why compiled?** Startup time matters. `finstack quote AAPL` runs in ~100ms including network. An interpreted runtime would add 200-500ms overhead. When `/sense` scans 10 tickers in parallel, that's 2-5 seconds saved.

### Skills

**Location**: `{sense,research,judge,act,reflect,cascade,track}/SKILL.md`  
**Purpose**: Orchestrate Claude Code's reasoning capabilities

Each skill is a **prompt template** with three sections:

1. **YAML frontmatter**: name, description, allowed-tools
2. **Bash preamble**: Environment setup — locate engine binary, check version, rebuild if needed
3. **Instruction body**: Step-by-step reasoning protocol

**The preamble pattern** (from `sense/SKILL.md`):

```bash
_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
_SK="${_ROOT:+$_ROOT/.claude/skills/finstack}"
[ -z "$_SK" ] || [ ! -d "$_SK" ] && _SK=~/.claude/skills/finstack

# Auto-rebuild if source is newer than binary
F="$_SK/engine/dist/finstack"
if [ -x "$F" ] && [ -d "$_SK/engine/src" ]; then
  _NEWEST=$(find "$_SK/engine/src" "$_SK/package.json" -newer "$F" 2>/dev/null | head -1)
  if [ -n "$_NEWEST" ]; then
    (cd "$_SK" && bun run build 2>/dev/null)
  fi
fi

[ -x "$F" ] && echo "ENGINE: $F" || echo "ENGINE_MISSING"
```

This ensures:
- Skills work whether invoked from the finstack repo or any other directory
- The engine auto-rebuilds when source files change (developer experience)
- Skills degrade gracefully if the binary is missing (web search fallback)

**Why SKILL.md?** Claude Code loads these as **context-injected prompts**. They don't just tell Claude what to do — they shape HOW it reasons. `/judge` doesn't call a "judgment API" — it orchestrates a multi-turn adversarial exchange where Bull builds the case, Bear attacks the weakest assumption with historical evidence, and a final synthesis delivers a verdict with conditional confidence.

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

The engine never "knows" what a thesis is or what `/sense` is trying to do. It provides primitives. Skills compose them into cognitive workflows.

## Data Flow

### Invocation Flow: `/sense` Example

```
User types: /sense
    ↓
Claude Code loads: sense/SKILL.md
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

### Remote Version Check

**Implementation**: `bin/finstack-update-check`  
**Trigger**: Skill preamble (every invocation) OR SessionStart hook (team mode)

```bash
_UPD=$("$_SK/bin/finstack-update-check" 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD"
```

**What it does**:
1. Check if `config.yaml:update_check` is enabled
2. Read `~/.finstack/.last-version-check` (cache, 24-hour TTL)
3. If stale: fetch remote VERSION from GitHub
4. Compare with local `~/.finstack/.installed-version`
5. If remote > local: print update message
6. Write new `.last-version-check` timestamp

**Why cache?** Avoid hitting GitHub on every skill invocation. 24-hour TTL balances freshness vs network overhead.

### Team Mode

**Purpose**: Shared finstack installation across a team  
**Setup**: `./setup --team`

Enables:
- `auto_upgrade: true` in config.yaml
- `update_check: true`
- Registers Claude Code SessionStart hook

**Hook**: `bin/finstack-session-update`

```bash
# Runs on every Claude Code session start
# Checks remote version → git pull → bun install → rebuild
```

**Why SessionStart?** Ensures the team always runs the latest version without manual `git pull`. The hook runs BEFORE Claude Code becomes interactive, so rebuilds don't interrupt workflows.

## Testing Strategy

### Current State (v0.2.0)

**Unit tests**: `engine/src/**/*.test.ts`  
**Coverage**: Data layer (yahoo.ts, cache.ts, keys.ts) + core commands (quote, portfolio, thesis)  
**Runner**: `bun test`

**Example**: `cache.test.ts`

```typescript
test('getCached returns null if TTL expired', () => {
  setCache('test-key', { value: 123 });
  // Mock Date.now() to +10 minutes
  expect(getCached('test-key', 'quote')).toBe(null);
});
```

**Why Bun test?** Zero config. TypeScript native. Fast (runs all tests in ~50ms).

### Planned (Phase 2+)

**Integration tests**: Test skill → engine → API flow end-to-end

```bash
# Planned: tests/integration/sense.test.ts
# 1. Mock API responses
# 2. Invoke /sense skill
# 3. Assert journal file created
# 4. Assert git commit made
```

**E2E skill tests**: Test full skill invocations with Claude Code harness

```bash
# Planned: tests/e2e/judge.test.ts
# 1. Feed /judge AAPL to Claude Code
# 2. Capture full conversation
# 3. Assert thesis created in theses.json
# 4. Assert adversarial exchange structure
```

**Challenge**: E2E tests require mocking Claude Code itself OR running against live API (expensive, slow). Integration tests (skill preamble → engine commands → mocked APIs) provide 80% coverage at 1/10th the cost.

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

1. **Create skill directory**: `mkdir myskill`

2. **Write SKILL.md**: `myskill/SKILL.md`

```markdown
---
name: myskill
description: What this skill does
allowed-tools:
  - Bash
  - Read
  - Write
---

# /myskill — Purpose

[Preamble: locate engine, set $F]

## Step 1: ...
## Step 2: ...
```

3. **Symlink**: `ln -s finstack/myskill ~/.claude/skills/myskill`

4. **Invoke**: `/myskill` in Claude Code

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
