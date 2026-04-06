# Changelog

All notable changes to finstack are documented here.

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
