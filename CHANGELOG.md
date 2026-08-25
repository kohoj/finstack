# Changelog

All notable changes to finstack are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.1] — 2026-08-26

### Security

**API keys leaked into error messages.** Provider URLs carry the key inline
(`?api_key=…`, `?token=…`), and timeout/HTTP-failure errors echoed the full URL
through command-layer `e.message` passthrough into logs and terminal output.
Secret-bearing query parameters are now redacted at the single choke point where
every provider URL becomes error text (`net.ts § redactUrl`).

**Shell injection in report open.** `report` opened the generated HTML with
`exec("open \"${path}\"")`; `REPORTS_DIR` derives from `FINSTACK_HOME`, so a home
path containing shell metacharacters was interpreted rather than opened. Now uses
`execFile` with the path as an argv entry — no shell parses it.

### Added

**MCP server.** The plugin registered an MCP server (`finstack mcp-server`) in
`.mcp.json`, but the command did not exist — invoking it errored `Unknown
command`. It is now implemented: a zero-dependency stdio JSON-RPC 2.0 server
that exposes every one of the 24 commands as a tool. Each `tools/call`
re-invokes the same binary as a child process so a tool runs the exact CLI code
path a human would, with the two stdin-composing commands (`thesis add`,
`shadow add`) accepting their JSON document as a `document` tool input rather
than on the transport stdin. See ARCHITECTURE.md § MCP Server.

**Mark-to-market equity curve and drawdown breaker.** `risk snapshot <value>`
records a dated equity point to `equity.json`, ratcheting a high-water mark
independent of the snapshots. `computeDrawdown` reports the peak-to-current
decline the risk gate reads.

**Custom share count in the risk gate.** `risk size <ticker> <entry> <stop>
[--shares N]` sizes against an explicit share count instead of only the
risk-budget-derived quantity.

**Configurable risk budget.** `profile.json` had a reader but no writer, so
`riskBudgetPct` was pinned to its default of 2 forever — a stable-looking config
that was really a hard-coded constant driving position sizing, the drawdown
breaker threshold, and `maxLossPerTrade`. `risk profile [--risk-budget N]` now
views and sets it (validated to (0, 100], written under a lock), and a new
`data/profile.ts` module owns both ends of the file.

### Fixed

**Plugin logo used the horizontal wordmark.** The manifest pointed `logo` at a
1600×480 documentation banner, which Codex cropped and scaled poorly in square
plugin surfaces. Both `logo` and `composerIcon` now use the intended 512×512
brand mark; the horizontal asset is named `wordmark.png` to make its role
unambiguous.

**Backtest and alpha used placeholder prices.** `backtest` computed returns
against a stubbed closing price and `alpha`'s benchmark aggregate was never
wired in. Both now fetch real historical closes from Yahoo's chart endpoint
(`period1`/`period2` window, walking back over weekends and holidays), and
`alpha` reports a SPY-relative benchmark from `calculateAggregate` over the
deployed capital.

**Thesis obituary was scheduled from creation, not death.** `killThesis` set the
90-day post-mortem review date relative to `createdAt`, so an old thesis killed
today landed in the queue already overdue. It is now 90 days from the kill.

**`loadEquity` corrupted its fallback across calls.** `readJSONSafe` returns its
fallback by reference and `recordEquity` mutates the loaded history in place, so
a shared empty constant accumulated snapshots across calls within a process.
Each load now starts from a fresh object.

**Duplicate `PEAK` in the ticker universe.** The symbol appeared twice; the
misplaced copy (out of sort order) is removed.

### Changed

**Docs freshness guard extended.** `check:docs` now fails when a state file drawn
in a `~/.finstack/` layout block is read by no code (caught `config.yaml`), and
when the MCP server's reported version diverges from `VERSION`.

## [0.7.0] — 2026-08-07

The correctness release. It closes the gap between what finstack claimed to do
and what it did — ten silent failure modes fixed, tests from 179 to 552, and
documentation drift now fails CI.

The one substantive addition serves the same goal: the two state files written
from LLM-composed JSON are now validated at the boundary, so a malformed thesis
or an impossible entry plan is rejected instead of quietly corrupting what
depends on it.

### Fixed

**Silent data loss under concurrent writes.** State mutations were
read-modify-write with no lock, so two processes interleaving both read the
same base and one update disappeared. Skills run engine commands in parallel
and a second session can be open at any time, so this was reachable in normal
use. Measured: 20 parallel `portfolio add` calls recorded 17 transactions;
15 parallel `regime add` calls recorded 12. Every mutation now runs inside a
file lock covering the whole cycle.

**`withFileLock` re-ran its callback on failure.** `mkdir` and the callback
shared one `try`, so an exception from the callback was indistinguishable from
lock contention — the loop retried, calling the callback once per attempt until
the deadline. Measured 13 invocations for a callback that throws immediately.
For a mutation with side effects, that meant 13 applications before the error
surfaced.

**`alpha` dropped positions recorded in the same millisecond.** Buys were
paired to sells with `buy.date < sell.date`, and timestamps are
millisecond-resolution ISO strings. A tight loop of trades lost 2 of 3 cycles
from the report. Pairing now uses position in the append-only transaction log.

**`alpha` ignored `FINSTACK_HOME`.** It built its own path from `homedir()`,
so the documented override silently did not apply to it. `session.ts` had the
same pattern.

**Path traversal via ticker.** The ticker pattern `^[A-Z0-9.-]{1,10}$` accepts
`..`, `.`, and `-`, because dot and hyphen are needed for real symbols like
BRK.B and BF-B. Tickers become cache filenames, so `..` escaped the cache
directory. Now requires at least one alphanumeric character.

**`history` skipped its own fallback.** The Polygon branch had no `try/catch`,
so a Polygon failure propagated the raw network error and never reached the
stale-cache step — a failure was reported while usable data sat on disk.

**`scan` reported total failure as success.** When every source failed it
cached and returned an empty signal list with exit 0, which `/sense` cannot
distinguish from a quiet market.

**`macro` returned an empty result with no key.** `fetchMultiple` swallows
failures via `allSettled`, so a keyless run printed `{"series": []}` and exited
0 instead of saying a key was needed.

**Unvalidated numeric and date input.** `parseFloat('12abc')` returns 12, so
malformed input became a plausible-looking number. `history --from 2026-02-31`
was accepted and rolled forward to March 3, querying a range the user never
asked for. `portfolio remove --price abc` wrote `NaN` into the transaction log,
corrupting every downstream alpha calculation.

**`act` and `review` used Glob without declaring it.** The step instructing a
Glob over the journal would not have run.

### Changed

**Every command reports errors the same way.** 8 of 23 commands used
`FinstackError`; the rest used `console.error` plus `process.exit(1)`, and 8
used both. Skills could not rely on the `suggestion` field being present, so
the documented degradation paths had nothing to key off. All 23 now throw;
`process.exit` appears only in `cli.ts`.

**Error messages say what to do.** Where the valid set is small and knowable,
the message lists it — an unknown scenario names all six presets, an unknown
provider names all four.

**Paths resolve per access.** `paths.ts` exported constants resolved at module
load, so `FINSTACK_HOME` only worked if set before the module graph loaded.
Now a namespace of getters.

**Validation is centralized.** 15 ad-hoc `toUpperCase()` calls and 18
unguarded `parseFloat`/`parseInt` sites collapsed into
`engine/src/validation.ts`.

### Added

**Skill-authored state is validated before it is written.** `theses.json` and
`shadow.json` are the only files finstack writes from LLM-composed JSON, and
nothing checked them. The failures were silent: an earnings condition missing
its threshold became `threshold: 0` — "revenue above zero", a condition that
can never falsify, making the thesis unkillable. A misspelled
`falsificationtest` was dropped on write. A staged plan whose tranches did not
sum to the position produced a shadow entry of fictional size, corrupting every
alpha figure derived from it.

Four new commands, all reading the composed document on stdin because the
content is prose, not parameters:

```
finstack thesis add                          # validated thesis registration
finstack thesis threaten <id> --condition ...  # /sense records a threat
finstack thesis transition <id> <status> ...   # explicit status change
finstack shadow add | close | show             # staged plan lifecycle
```

Validation enforces invariants a JSON Schema cannot express — tranche shares
summing to the position, a long's stop below its take-profit, a filled tranche
carrying a fill price — and rejects unknown fields with an edit-distance
suggestion rather than dropping them. Every problem is reported at once, so a
model correcting its output does not need one round trip per field.

`/judge`, `/act`, and `/sense` now route through these instead of writing JSON
directly. The 24-to-34-line prose schemas those skills carried are gone; the
space went to explaining why the format matters.

**Documentation drift fails CI.** `check:docs` grew from 2 checks to 35. It now
verifies command and skill counts stated in prose, `setup` registration,
`allowed-tools` against actual usage, preamble consistency, and shared
scaffolding. Every check exists because that exact thing had drifted.

**Tests: 179 to 552.** Every command has a test file. The fallback chain — the
reliability mechanism ARCHITECTURE.md leads with — had zero coverage and now
has each transition asserted per command. Adds integration suites for the
portfolio, thesis, and shadow-alpha lifecycles, 42 adversarial tests covering
injection, traversal, SSRF, hostile API responses, and corrupt state, and an
E2E case per skill asserting its structural contract.

**Lint, typecheck, and pre-commit hooks.** Biome with rules tuned to the
codebase. `tsconfig` now includes `test/` and `scripts/`, which had never been
type-checked and contained 8 real type errors. `./setup` installs a pre-commit
hook running the same four gates as CI.

**CI on macOS.** `Bun.sleepSync` and the `open`/`xdg-open` shell-out are
platform-sensitive and were only tested on Linux.

### Documentation

**ARCHITECTURE.md described v0.2.0.** The cognitive loop was drawn as a
seven-stage chain; tracing the actual skill references, only four of those
seven edges exist. The real shape is a hub — six of nine skills point at
`/judge`. Redrawn, with `screen` and `review` placed outside the loop.

**The shadow portfolio loop is now documented.** Three diagrams in this repo
show the skill graph; none showed
`act → shadow.json → track → reflect → patterns/ → act`, which is the only path
by which the system changes its own future behavior.

**The fallback chain is described per command.** It was stated as universal;
three commands implement all five steps. The rest stop earlier for reasons now
recorded — `filing` has no stale fallback because serving an outdated list of
legal disclosures without saying so is worse than reporting EDGAR is down.

## [0.6.0] — 2026-04-07

The "one-person research department" release. finstack goes from a prototype
with good ideas to a reliable, daily-use investment operating system.

### What's New

**Discover opportunities, don't just analyze known ones.**
- `/screen` — filter S&P 500 + NASDAQ 100 by any financial metric. Presets for growth, value, and dividend strategies. Natural language works too.
- `finstack calendar` — see upcoming earnings dates for your entire portfolio and watchlist in one view.
- `finstack watchlist` — track tickers you're watching but haven't bought. Tags, alerts, thesis linking.

**Think bigger about risk.**
- `finstack scenario` — "what if rates rise 100bp?" or "what if the market drops 20%?" Six presets plus custom factor support. Sector-level estimates, not guesswork.
- `finstack correlate` — Pearson correlation matrix across your holdings. Warns when positions are too correlated (>0.8).
- `finstack backtest` — replay closed theses against actual prices. Were your conditions right? Did you follow the plan?

**See your data.**
- `finstack report` — generates standalone HTML reports with Chart.js charts and dark-mode Tailwind styling. Portfolio allocation pies, thesis status bars, performance timelines. Opens in your browser.

**Review and learn.**
- `/review` — weekly or monthly retrospective. Aggregates decisions, thesis outcomes, and behavioral patterns into a narrative.
- Operational learnings — every skill now loads past learnings at startup and deposits new ones at the end. finstack gets smarter with each session.

**Daily workflow.**
- `/sense` now integrates watchlist, alerts, and earnings calendar into the morning briefing.
- `/act` checks portfolio correlation before recommending a position.
- `/cascade` suggests scenario analysis after tracing chain reactions.
- `/reflect` pulls backtest results and correlation data into the review.

### Under the Hood

**Reliability.** Every HTTP request has a 10-second timeout and exponential backoff retry. Every JSON state file uses atomic writes (tmp + rename). Data source fallback chains: Yahoo → Polygon/FMP → stale cache → actionable error message. You'll never see a silent failure.

**Engineering discipline.** 179 unit and security tests. GitHub Actions CI. Documentation freshness checks (`bun run check:docs`). Three-tier test strategy: `bun test` (fast), `test:gate` (+ docs), `test:e2e` (full skill tests via Claude API). ARCHITECTURE.md, CONTRIBUTING.md, and this changelog.

**Version management.** Engine binary auto-rebuilds when source code is newer. Remote version checks (cached, non-blocking). Team mode (`./setup --team`) for background auto-updates.

**Input validation.** Ticker format enforcement, path traversal prevention, file-level mutex for concurrent writes. Dogfooded and hardened across 11 rounds of edge-case testing.

### Data Sources

| Tier | Source | Key Required |
|------|--------|:---:|
| 0 | Yahoo Finance, SEC EDGAR, WebSearch | No |
| 1 | FRED, Alpha Vantage, Polygon, FMP | Free |

### Numbers

- 9 skills, 25 engine commands, 7 data sources
- 179 tests, 0 failures
- 4,400 lines of TypeScript, 2,200 lines of tests
- Works with zero configuration. Deeper analysis unlocked by free API keys.

---

## [0.2.0] — 2026-04-07

### Added
- Cognitive Alpha Engine (shadow portfolio + alpha calculation)
- Thesis Falsification (lifecycle management with conditions)
- `/track` audit layer
- Risk gate with concentration limits and position sizing
- Portfolio risk dashboard

## [0.1.0] — Initial Release

### Added
- 7 core skills: /sense, /research, /judge, /act, /cascade, /track, /reflect
- Engine data layer: Yahoo Finance, FRED, SEC EDGAR, Alpha Vantage, Polygon
- Shadow portfolio mechanism
- TTL-based cache system
