# finstack

**An operating system for investment thinking.**

One person + AI = a hedge fund's entire research department.

finstack is a skill pack for [Claude Code](https://claude.ai/code) that turns
your terminal into an institutional-grade investment research workflow. Not a
data terminal — a thinking partner that argues, traces chain reactions, screens
for opportunities, remembers your blind spots, and gets smarter with every
decision you make.

## The Loop

```
/sense → /research → /judge → /act → /reflect
  ↑                                       │
  └──────── cognitive feedback ───────────┘
              ↕              ↕
        /track (audit)  /cascade (trace)
              ↕              ↕
     /screen (discover) /review (retro)
```

### Core Skills

| Skill | Purpose |
|-------|---------|
| **`/sense`** | Morning briefing. Scans portfolio + watchlist + alerts, filters noise, surfaces only what matters. |
| **`/research`** | Deep dive. Produces research memorandums with traceable claims. |
| **`/judge`** | Adversarial judgment. Bull vs Bear with conditional confidence — not fake scores. |
| **`/act`** | Action plan. Position sizing, stop-loss, take-profit, risk gate, correlation check. |
| **`/cascade`** | Chain reaction tracing. Multiple agents trace parallel causal chains simultaneously. |
| **`/track`** | Quantified mirror. Real vs shadow portfolio, thesis lifecycle, cognitive alpha. |
| **`/reflect`** | Meta-cognition. Separates luck from skill, extracts behavioral patterns. |
| **`/screen`** | Stock screener. Filter S&P 500 + NASDAQ 100 by financial metrics. |
| **`/review`** | Periodic review. Weekly/monthly decision statistics and behavioral retrospective. |

### `/cascade` — The Signature Capability

```
/cascade TSMC cuts capital expenditure

→ Agent 1: Semiconductor equipment chain (ASML, Applied Materials)
→ Agent 2: Apple supply chain (A-series chip timeline)
→ Agent 3: AI compute narrative (NVDA, cloud capex thesis)
→ Agent 4: Samsung competitive response

Synthesis by certainty: first-order → second-order → speculative
Portfolio exposure: "30% of your holdings are affected"
Regime signal: "AI capex growth assumption under stress"
```

One event. Multiple parallel agents tracing causal chains simultaneously.
The human brain can follow 2-3 links. AI agents can follow N links across
N chains — systematic breadth beyond human cognition.

### `/screen` — Active Discovery

```bash
/screen "grossMargin>0.4 sector=Technology marketCap<50e9"

# Or use presets
/screen --preset growth
/screen --preset value "marketCap>100e9"
/screen --preset dividend
```

Filter the S&P 500 + NASDAQ 100 (~600 stocks) by any financial metric.
Natural language also works — "find me high-margin semiconductor companies."

### Cognitive Alpha Engine

finstack maintains a shadow portfolio — a "perfectly disciplined you" that
follows every /act plan exactly.

```
             Return    vs SPY
  SPY         +8.2%      —
  Shadow      +19.4%    +11.2%  ← your analytical edge
  Real        +14.2%    +6.0%   ← what you captured

  Execution drag: $10,400/quarter (early exits, ignored stops)
```

Every dollar of behavioral cost is traced to its source.

### Thesis Falsification

Every `/judge` verdict auto-registers a thesis with falsifiable conditions.
`/sense` monitors for threats. Dead theses get an obituary review 90 days later.

```
alive → threatened → critical → dead
     → reinforced (condition passed)
```

Machine detects threats. Human decides death.

## Install

Requires [Bun](https://bun.sh) and [Claude Code](https://claude.ai/code).

```bash
git clone https://github.com/kohoj/finstack.git
cd finstack
./setup
```

That's it. Nine skills are now available in Claude Code.

### Team Mode

For shared teams that want auto-updates:

```bash
./setup --team
```

This enables background auto-pull + rebuild on each Claude Code session start.

### Quick Start

```bash
claude                          # Open Claude Code

/sense                          # Morning briefing
/research NVDA                  # Deep dive on a ticker
/judge NVDA                     # Adversarial buy/sell verdict
/act NVDA                       # Concrete action plan
/cascade TSMC cuts capex        # Trace chain reactions
/track                          # Portfolio performance mirror
/reflect                        # Learn from past decisions
/screen --preset growth         # Find growth stocks
/review --period week           # Weekly retrospective
```

### Unlock More Data Sources

Free API keys (30 seconds each):

```bash
# FRED — macro indicators (rates, CPI, GDP, VIX)
finstack keys set fred YOUR_KEY

# Alpha Vantage — earnings calendar + surprise history
finstack keys set alphavantage YOUR_KEY

# Polygon — historical OHLCV, splits, dividends
finstack keys set polygon YOUR_KEY

# Financial Modeling Prep — backup financial data
finstack keys set fmp YOUR_KEY
```

Without keys, finstack works fine — Tier 0 data covers core needs.

## Engine Commands

The engine binary (`finstack`) handles data, caching, and computation:

```
finstack quote <ticker>                     Price snapshot
finstack financials <ticker>                Financial data + ratios
finstack scan [--source trending|news|all]  Signal scanning
finstack screen "<filters>" [--preset P]    Stock screener
finstack portfolio show|add|remove|init     Portfolio management
finstack watchlist [add|remove|tag|untag]   Watchlist management
finstack alerts [--due N] [--source S]      Check pending alerts
finstack calendar [--range N]               Upcoming earnings calendar
finstack regime list|add|update|alerts      Consensus assumptions
finstack thesis list|check|kill|history     Thesis lifecycle
finstack risk [size <ticker> <entry> <stop>] Risk + position sizing
finstack alpha [--last N]                   Cognitive alpha
finstack history <ticker> [--from --to]     Historical prices
finstack earnings <ticker> [--upcoming]     Earnings data
finstack macro [series]                     FRED macro indicators
finstack filing <ticker>                    SEC EDGAR filings
finstack keys set|list|remove               API key management
finstack learn add|search|recent            Operational learnings
finstack report sense|track|reflect         HTML visual reports
finstack review [--period P]                Periodic review data
finstack backtest [--thesis ID]             Thesis replay backtest
finstack correlate [--period N]             Correlation matrix
finstack scenario <name|custom>             Scenario analysis
```

## Architecture

```
finstack/
├── sense/SKILL.md           # 9 skill definitions
├── research/SKILL.md        #   (prompt templates for Claude Code)
├── judge/SKILL.md
├── act/SKILL.md
├── cascade/SKILL.md
├── track/SKILL.md
├── reflect/SKILL.md
├── screen/SKILL.md
├── review/SKILL.md
├── engine/src/              # Data engine (compiled Bun binary)
│   ├── cli.ts               #   25 commands
│   ├── commands/             #   quote, financials, scan, screen, portfolio,
│   │                         #   watchlist, alerts, calendar, regime, thesis,
│   │                         #   risk, alpha, history, earnings, macro, filing,
│   │                         #   keys, learn, report, review, backtest,
│   │                         #   correlate, scenario
│   ├── data/                 #   7 data sources + state stores
│   └── report/               #   HTML templates + Chart.js configs
├── bin/                      # Version check, session update, config
├── ARCHITECTURE.md           # Design decisions + data flow
├── CONTRIBUTING.md           # How to contribute
├── CHANGELOG.md              # Version history
└── setup                     # One-command install
```

**Dual-layer architecture:**
- **Cognitive Layer** (skills) — Claude Code handles reasoning, adversarial analysis, pattern recognition
- **Data Layer** (engine) — Bun binary handles fetching, caching, computation

See [ARCHITECTURE.md](ARCHITECTURE.md) for deep technical details.

## Reliability

- **Network**: All requests have 10s timeout + exponential backoff retries
- **Fallback chains**: Yahoo → Polygon/FMP → stale cache → actionable error
- **Atomic writes**: All state files crash-safe via tmp+rename
- **Version check**: Binary auto-rebuilds when source is newer
- **167 tests**: Unit, integration, and security regression tests

## Cognitive Memory

finstack maintains a cognitive model of YOU in `~/.finstack/`:

```
~/.finstack/
├── journal/          # Every decision, tracked by git
├── patterns/         # Behavioral patterns (exits tech early, ignores stops)
├── portfolio.json    # Current holdings + transaction history
├── shadow.json       # Shadow portfolio (disciplined you)
├── theses.json       # Active thesis register + falsification conditions
├── consensus.json    # Market assumptions + stress levels
├── watchlist.json    # Tickers you're watching
├── learnings.jsonl   # Operational learnings (skills get smarter over time)
├── config.yaml       # User preferences
├── reports/          # Generated HTML visual reports
└── cache/            # TTL-based data cache (auto-managed)
```

`git log ~/.finstack/journal/` is your investment decision history.
The user who uses finstack for a year has a cognitive model no one else
can replicate.

## Data Sources

| Tier | Source | Data | Key |
|------|--------|------|:---:|
| 0 | WebSearch + WebFetch | News, analysis, public pages | No |
| 0 | Yahoo Finance | Quotes, financials, trending, earnings dates | No |
| 0 | SEC EDGAR | 10-K, 10-Q, 8-K filings | No |
| 1 | FRED | Rates, CPI, GDP, unemployment, VIX | Free |
| 1 | Alpha Vantage | Earnings calendar, surprise history | Free |
| 1 | Polygon | Historical OHLCV, splits, dividends | Free |
| 1 | Financial Modeling Prep | Financial data (backup for Yahoo) | Free |

## Philosophy

1. **Adversarial rigor over adversarial theater** — attack specific assumptions, not generic concerns
2. **Honest uncertainty** — confidence is a map, not a number
3. **Breathe, never break the chain** — calm surface, auditable depth
4. **The closed loop** — every action feeds reflection, every reflection sharpens perception
5. **Cognitive honesty** — your patterns are guardrails, not judgments

Read [ETHOS.md](ETHOS.md) for the full philosophy.

## License

MIT
