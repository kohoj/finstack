# Contributing to finstack

## Development Setup

```bash
git clone https://github.com/kohoj/finstack.git
cd finstack
bun install
bun run build
./setup
```

## Running Tests

```bash
bun test                    # Unit + integration tests (fast, free)
```

## Project Structure

```
engine/src/
├── cli.ts                  # Command router and entry point
├── paths.ts                # Central path constants (FINSTACK_HOME)
├── errors.ts               # FinstackError with actionable diagnostics
├── net.ts                  # Network reliability (timeout + retry)
├── fs.ts                   # Atomic JSON writes + safe reads
├── cache.ts                # TTL cache with version stamps
├── commands/               # CLI command implementations
│   ├── quote.ts            # Price snapshot with fallback chain
│   ├── financials.ts       # Financial data with fallback chain
│   ├── scan.ts             # Multi-source signal scanning
│   ├── screen.ts           # Stock screener with filter syntax
│   ├── portfolio.ts        # Portfolio CRUD
│   ├── watchlist.ts        # Watchlist CRUD + tagging
│   ├── alerts.ts           # Alert aggregation
│   ├── calendar.ts         # Earnings calendar
│   ├── regime.ts           # Consensus assumptions
│   ├── thesis.ts           # Thesis lifecycle
│   ├── risk.ts             # Risk + position sizing
│   ├── alpha.ts            # Cognitive alpha
│   ├── history.ts          # Historical prices
│   ├── earnings.ts         # Earnings data
│   ├── macro.ts            # FRED macro indicators
│   ├── filing.ts           # SEC EDGAR filings
│   ├── keys.ts             # API key management
│   ├── learn.ts            # Operational learnings
│   ├── report.ts           # HTML report generation
│   └── correlate.ts        # Correlation matrix
├── data/                   # Data source integrations
│   ├── yahoo.ts            # Yahoo Finance (Tier 0)
│   ├── fred.ts             # Federal Reserve (Tier 1)
│   ├── edgar.ts            # SEC EDGAR (Tier 0)
│   ├── alphavantage.ts     # Alpha Vantage (Tier 1)
│   ├── polygon.ts          # Polygon.io (Tier 1)
│   ├── fmp.ts              # Financial Modeling Prep (Tier 1)
│   ├── keys.ts             # API key storage
│   ├── thesis.ts           # Thesis store
│   ├── shadow.ts           # Shadow portfolio store
│   ├── watchlist.ts        # Watchlist store
│   ├── learnings.ts        # Learnings JSONL store
│   ├── universe.ts         # S&P 500 + NASDAQ 100 ticker lists
│   └── presets.ts          # Screening presets
└── report/                 # HTML report templates
    ├── templates.ts        # Page layout generator
    └── charts.ts           # Chart.js config generators
```

## Adding a New Engine Command

1. Create `engine/src/commands/{name}.ts`
2. Export an async function: `export async function name(args: string[]) { ... }`
3. Register in `engine/src/cli.ts` (import + add to commands object + update help text)
4. Add test: `engine/test/commands/{name}.test.ts`
5. Update `README.md` command list

## Adding a New Skill

1. Create `{skill-name}/SKILL.md` with YAML frontmatter
2. Include the standard Binary Resolution preamble (copy from any existing skill)
3. Add Learnings Context and Learning Deposit sections
4. Add skill name to the `SKILLS` array in `setup`
5. Run `./setup` to register

## Adding a New Data Source

1. Create `engine/src/data/{source}.ts`
2. All HTTP requests must use `fetchWithRetry()` from `engine/src/net.ts`
3. Add to the relevant command's fallback chain
4. Add test: `engine/test/data/{source}.test.ts`

## Code Standards

- All persistent writes use `atomicWriteJSON()` from `engine/src/fs.ts`
- All paths derive from `engine/src/paths.ts` constants
- Errors use `FinstackError` with a `suggestion` field
- API keys never appear in error messages, logs, or cache files
- Ticker input must be validated (only A-Z, 0-9, '.', '-', max 10 chars)
- All data sources go through `fetchWithRetry()` for timeout + retry

## Testing

- Tests use `bun:test` with temporary directories for isolation
- Use `readJSONSafe()` fallback patterns instead of checking file existence
- Mock `fetch` by replacing `globalThis.fetch` (restore in `finally` block)
- Name test files to match source: `commands/foo.ts` → `test/commands/foo.test.ts`
