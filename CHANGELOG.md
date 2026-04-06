# Changelog

All notable changes to finstack are documented here.

## [0.6.0] - 2026-04-07

### Added
- Thesis replay backtest: condition validation, plan adherence, alpha vs SPY
- Scenario analysis: 6 presets (rate changes, market crashes, recession) + custom factors
- Periodic review command and `/review` skill for weekly/monthly retrospectives
- Multi-session awareness: registration, cleanup, concurrent session detection
- README rewrite reflecting full v0.6.0 feature set

## [0.5.0] - 2026-04-07

### Added
- HTML report engine with Chart.js charts and Tailwind CSS styling (sense/track/reflect)
- Portfolio correlation matrix with Pearson coefficients and high-correlation warnings
- Security regression tests (15 tests: keys, paths, input validation, atomic writes)
- Documentation freshness check script (`bun run check:docs`)
- CONTRIBUTING.md and CHANGELOG.md

## [0.4.0] - 2026-04-07

### Added
- Stock screener (`/screen`): filter S&P 500 + NASDAQ 100 by financial metrics
- Screening presets: growth, value, dividend
- Earnings calendar: aggregate upcoming earnings for portfolio + watchlist
- `earnings --upcoming` flag for single ticker lookup
- Operational learnings system: JSONL storage, skill load/deposit lifecycle
- ARCHITECTURE.md: comprehensive design decisions document
- `/screen` skill for natural language stock screening

## [0.3.0] - 2026-04-07

### Added
- Network reliability layer: timeouts, exponential backoff retries
- Atomic writes: all JSON state files crash-safe via tmp+rename
- Actionable errors: every error includes diagnostic suggestion
- Data source fallback chains: Yahoo → Polygon/FMP → stale cache
- Yahoo Finance hardening: crumb TTL, UA rotation, auto-recovery
- FINSTACK_HOME environment variable for configurable data directory
- Cache versioning: format changes auto-invalidate old entries
- Watchlist management: add/remove/tag/untag with ticker validation
- Alert aggregation: watchlist dates + thesis deadlines
- `/sense` integration with watchlist and alerts
- Financial Modeling Prep (FMP) as Tier 1 data source
- Version detection and auto-rebuild system
- Team mode with SessionStart hook for auto-updates
- Config system (`~/.finstack/config.yaml`)

## [0.2.0] - 2026-04-07

### Added
- Cognitive Alpha Engine (shadow portfolio + alpha calculation)
- Thesis Falsification (lifecycle management with conditions)
- `/track` audit layer
- Risk gate with concentration limits and position sizing
- Portfolio risk dashboard
- Portfolio transaction log with deviation tracking
- `/judge` auto-registers theses on verdict
- `/act` auto-creates shadow portfolio entries
- `/sense` thesis threat detection
- FRED macro data integration
- SEC EDGAR filing integration
- Alpha Vantage earnings data integration
- Polygon historical price data integration

## [0.1.0] - Initial Release

### Added
- 7 core skills: /sense, /research, /judge, /act, /cascade, /track, /reflect
- Engine data layer: Yahoo Finance, FRED, SEC EDGAR, Alpha Vantage, Polygon
- Thesis condition system (earnings + event conditions)
- Shadow portfolio mechanism
- TTL-based cache system
- API key management
- Portfolio CRUD operations
- Quote and financials commands
