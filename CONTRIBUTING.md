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
bun test                    # Unit, command, integration, adversarial (fast, free)
bun run test:gate           # The full gate: lint + typecheck + test + docs
bun run test:e2e            # Skill E2E via Claude API (EVALS=1, costs money)
```

`bun run test:gate` is what CI runs and what the pre-commit hook runs. If it
passes locally, CI will pass.

`test:e2e` is not in CI and not in the gate. Run it by hand when you change a
SKILL.md — that is the only time it can tell you anything, since a skill is a
prompt and the suite has to start real Claude Code sessions to exercise one.

## Before You Open a PR

```bash
bun run test:gate
```

That's it. The hook installed by `./setup` runs this automatically; bypass a
single commit with `git commit --no-verify` if you need to.

## Architecture Constraints

Some things look like omissions and are not. Please read before "fixing" them.

**`thesis add` and `shadow add` read stdin, not flags.** A thesis is the
output of an adversarial exchange; a shadow entry is a staged plan with a
rationale attached to every stop and target. That content cannot be squeezed
through argv without either truncating it or turning the skill into a
shell-quoting exercise.

So the split is: skills compose the document, the engine validates and writes
it. Please do not "improve" these into flag-based commands — the earlier
version had no engine command at all and the skills wrote the JSON directly,
which is how a thesis with no threshold (reading as "revenue above zero", a
condition that can never falsify) reached disk unnoticed.

Validation lives in `engine/src/schema.ts` and enforces business invariants a
JSON Schema cannot: tranche shares summing to the position, a long's stop
sitting below its take-profit, a filled tranche carrying a fill price. Unknown
fields are rejected rather than ignored, because a silently dropped typo is
worse than a loud failure.

**`screen` writes no state.** It is a search, not a decision. Making it
"consistent" with the other skills by having it write a journal entry would
record a query as though it were a judgment.

**Not every command has a secondary data source.** Only three data types are
available from two providers. Earnings history exists only on Alpha Vantage,
filings only on EDGAR, macro series only on FRED.

**`filing` has no stale-cache fallback.** Filings are legal disclosures.
Serving a six-hour-old list without saying so risks the user concluding a
company has not filed something when it has.

**Paths are getters, not constants.** `paths.PORTFOLIO_FILE` resolves
`FINSTACK_HOME` on every access. Assigning it to a module-level constant
re-freezes it and breaks both the documented override and test isolation.

## Project Structure

```
engine/src/
├── cli.ts                  # Command router and entry point
├── paths.ts                # Path getters (resolve FINSTACK_HOME per access)
├── errors.ts               # FinstackError with actionable diagnostics
├── validation.ts           # Shared input validation
├── schema.ts               # Validation for skill-authored state
├── stdin.ts                # JSON-on-stdin reader
├── net.ts                  # Network reliability (timeout + retry)
├── fs.ts                   # Atomic writes, safe reads, file locking
├── cache.ts                # TTL cache with version stamps
├── commands/               # CLI command implementations (24)
├── data/                   # Data sources and state stores (13)
└── report/                 # HTML report templates

engine/test/
├── commands/               # One file per command
├── data/                   # One file per data module
├── integration/            # Cross-command sequences
├── adversarial.test.ts     # Hostile input
├── helpers.ts              # Test home, fetch mocking, fixtures
└── *.test.ts               # Infrastructure units

test/skill-e2e/             # Real skill invocations (EVALS=1)
scripts/check-docs.ts       # Documentation freshness checks
```

## Adding a New Engine Command

1. Create `engine/src/commands/{name}.ts`
2. Export `export async function name(args: string[]) { ... }`
3. Register in `engine/src/cli.ts` — the imports, the `commands` object, and
   the help text. `check:docs` fails if the last one is missed.
4. Add `engine/test/commands/{name}.test.ts`
5. If it hits the network, cover the fallback chain — see
   `engine/test/commands/quote.test.ts` for the pattern

## Adding a New Skill

1. Create `{skill-name}/SKILL.md` with YAML frontmatter
2. Copy the Binary Resolution preamble verbatim from any existing skill —
   `check:docs` asserts all nine are identical
3. Include Learnings Context and Learning Deposit sections
4. Add the name to the `SKILLS` array in `setup` and to `SKILLS` in
   `scripts/check-docs.ts`
5. Declare every tool the skill uses in `allowed-tools` — an undeclared tool is
   unavailable at runtime, so the step silently does not happen
6. Run `./setup` to register

## Adding a New Data Source

1. Create `engine/src/data/{source}.ts`
2. All HTTP goes through `fetchWithRetry()` from `engine/src/net.ts`
3. Add it to the relevant command's fallback chain
4. Add `engine/test/data/{source}.test.ts`
5. If it needs a key, add the provider to `PROVIDERS` in
   `engine/src/data/keys.ts`

## Code Standards

- State writes go through `withFileLock()` wrapping the **whole**
  read-modify-write cycle. Locking only the write does nothing — the race is
  between the read and the write.
- Persistent writes use `atomicWriteJSON()` from `engine/src/fs.ts`
- Paths come from `engine/src/paths.ts`. Never build them from `homedir()`.
- Errors are `FinstackError` with a `suggestion` field. `process.exit` belongs
  only in `cli.ts`.
- Input validation goes in `engine/src/validation.ts`. Use `Number()`, not
  `parseFloat` — `parseFloat('12abc')` returns 12.
- API keys never appear in error messages, logs, or cache files

## Testing

- `bun:test` with temporary directories for isolation
- `useTestHome()` from `engine/test/helpers.ts` points the engine at a temp
  directory and disables retry backoff
- Mock the network with `mockFetch()` — an unmatched URL throws rather than
  returning a default, so a test cannot pass by hitting a path nobody modelled
- Name test files to match source: `commands/foo.ts` →
  `test/commands/foo.test.ts`

### What makes a good test here

Assert the transition, not just the happy path. For a network command that
means: a fresh cache hit issues zero requests, a primary failure reaches the
secondary, a total outage degrades to stale data, and only an empty cache
produces an error. Each of those is a separate promise the code makes.

When you fix a bug, write the test that fails first. Several fixes in this
project came from a test that reproduced the defect before anything changed —
that is the only way to know the fix works.

