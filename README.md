# finstack

**An operating system for investment thinking.**

One person + AI = a hedge fund's entire research department.

finstack is a skill pack for [Claude Code](https://claude.ai/code) that turns
your terminal into an institutional-grade investment research workflow. Not a
data terminal — a thinking partner that argues, traces chain reactions, remembers
your blind spots, and gets smarter with every decision you make.

## The Loop

```
/sense → /research → /judge → /act → /reflect
  ↑                                       │
  └──────── cognitive feedback ───────────┘
                    ↕
              /track (audit layer)
```

- **`/sense`** — Morning briefing. Scans for signals, filters noise, surfaces only what matters to your portfolio.
- **`/research`** — Deep dive. Produces research memorandums, not data dumps. Every claim traceable to source.
- **`/judge`** — Adversarial judgment. Bull builds the case, Bear attacks the weakest assumption with historical evidence. Delivers a verdict with conditional confidence — not fake scores.
- **`/act`** — Action plan. Position sizing, stop-loss, take-profit, time horizon. Cross-checked against your risk profile and behavioral patterns.
- **`/reflect`** — Meta-cognition. Reviews past decisions, separates luck from skill, extracts behavioral patterns that shape all future invocations.
- **`/track`** — Quantified mirror. Real vs shadow portfolio, thesis lifecycle, cognitive alpha score, behavioral cost in dollars.

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
N chains. This is where AI genuinely surpasses human cognition — not in depth,
but in systematic breadth.

### Cognitive Alpha Engine

finstack maintains a shadow portfolio — a "perfectly disciplined you" that
follows every /act plan exactly. Stop-losses fire on time. Take-profits
execute at target. Time horizons are honored.

`/track alpha` compares your real portfolio against the shadow and SPY:

```
             Return    vs SPY
  SPY         +8.2%      —
  Shadow      +19.4%    +11.2%  ← your analytical edge
  Real        +14.2%    +6.0%   ← what you captured

  Your analysis is worth +$22,400/quarter.
  Your execution gave back $10,400.
```

Every dollar of behavioral cost is traced to its source: early exits,
ignored stops, incomplete staged entries. You see exactly what your
investment personality is costing you.

### Thesis Falsification

Every `/judge` verdict auto-registers a thesis with falsifiable conditions.
`/sense` monitors for threats. The thesis lifecycle:

```
alive → threatened → critical → dead
     → reinforced (condition passed)
```

Machine detects threats. Human decides death. Dead theses get an obituary
review 90 days later — did you kill it too early, or was the call right?

## Install

Requires [Bun](https://bun.sh) and [Claude Code](https://claude.ai/code).

```bash
git clone https://github.com/kohoj/finstack.git
cd finstack
./setup
```

That's it. Seven skills are now available in Claude Code:

```
/sense     /research     /judge
/act       /reflect      /cascade
/track
```

### Quick Start

```bash
# Open Claude Code in any directory
claude

# Morning briefing — what signals matter to your portfolio today?
/sense

# Deep dive on a ticker
/research NVDA

# Should I buy? Bull vs Bear adversarial judgment
/judge NVDA

# Turn the verdict into a concrete action plan
/act NVDA

# Track a macro event's chain reaction across your holdings
/cascade TSMC cuts capital expenditure

# How am I doing? Real vs shadow portfolio comparison
/track

# Reflect on past decisions — separate luck from skill
/reflect
```

### Optional: Unlock Tier 2 Data

Free API keys for deeper analysis (register in 30 seconds each):

```bash
# FRED — macro indicators (rates, CPI, GDP, VIX)
# Register: https://fred.stlouisfed.org/docs/api/api_key.html
finstack keys set fred YOUR_KEY

# Alpha Vantage — earnings calendar + surprise history
# Register: https://www.alphavantage.co/support/#api-key
finstack keys set alphavantage YOUR_KEY

# Polygon — historical OHLCV, splits, dividends
# Register: https://polygon.io/dashboard/signup
finstack keys set polygon YOUR_KEY
```

Without these keys, finstack works fine — Tier 0 + Tier 1 covers 90%.
With these keys, `/research`, `/sense`, and `/track` get richer data.

## How It Works

finstack is a **skill pack** (prompt templates that orchestrate Claude Code)
backed by a **lightweight engine binary** (`$F`) for data fetching and caching.

```
finstack/
├── sense/SKILL.md       # Signal scanning
├── research/SKILL.md    # Deep research
├── judge/SKILL.md       # Adversarial judgment
├── act/SKILL.md         # Action planning
├── reflect/SKILL.md     # Meta-cognition
├── cascade/SKILL.md     # Chain reaction tracing
├── track/SKILL.md       # Quantified mirror (audit layer)
├── engine/              # Data engine (compiled Bun binary)
│   └── src/
│       ├── cli.ts
│       ├── commands/    # 12 commands (quote, financials, scan, macro,
│       │                #   filing, history, earnings, alpha, thesis,
│       │                #   regime, portfolio, keys)
│       └── data/        # API clients (Yahoo, FRED, EDGAR, Alpha Vantage, Polygon)
└── setup                # One-command install
```

The engine handles data fetching and caching across 5 data sources.
Everything else — reasoning, adversarial argumentation, pattern recognition,
cascade tracing — is Claude Code doing what it does best, orchestrated by
the skill templates.

## Cognitive Memory

finstack maintains a cognitive model of YOU in `~/.finstack/`:

```
~/.finstack/
├── journal/          # Every /judge and /act decision, tracked by git
├── patterns/         # Behavioral patterns (exits tech early, ignores stops)
├── portfolio.json    # Your current holdings + transaction history
├── shadow.json       # Shadow portfolio (disciplined you)
├── theses.json       # Active thesis register + falsification conditions
├── consensus.json    # Market assumptions you're tracking + stress levels
├── keys.json         # API keys for Tier 2 data sources (0600 permissions)
├── profile.json      # Risk tolerance, style, blind spots (inferred, not surveyed)
└── cache/            # TTL-based data cache (auto-managed)
```

`git log ~/.finstack/journal/` is your investment decision history.
`git diff` shows how your cognition evolved. Auditable, reversible, free.

The user who uses finstack for a year has a cognitive model no one else
can replicate. The skills are the interface; the memory is the moat.

## Data Sources

Works out of the box with zero API keys:

| Tier | Source | Data | Key Required |
|------|--------|------|:---:|
| 0 | WebSearch + WebFetch | News, analysis, any public page | No |
| 1 | Yahoo Finance | Quotes, financials, trending | No |
| 1 | SEC EDGAR | 10-K, 10-Q, 8-K filings | No |
| 1 | FRED | Rates, CPI, GDP, unemployment, VIX | Free |
| 2 | Alpha Vantage | Earnings calendar, surprise history | Free |
| 2 | Polygon | Historical OHLCV, splits, dividends | Free |

Tier 1 covers 90% of needs. Tier 2 adds depth for power users.
Configure keys: `finstack keys set <provider> <key>`

## Philosophy

finstack believes:

1. **Adversarial rigor over adversarial theater** — attack specific assumptions, not list generic concerns
2. **Honest uncertainty** — confidence is a map, not a number
3. **Breathe, never break the chain** — calm surface, auditable depth
4. **The closed loop** — every action feeds reflection, every reflection sharpens perception
5. **Cognitive honesty** — your patterns are guardrails, not judgments

Read [ETHOS.md](ETHOS.md) for the full philosophy.

## Built on

- [Claude Code](https://claude.ai/code) — agent orchestration, 1M context, multi-model routing
- [gstack](https://github.com/anthropics/gstack) — architectural inspiration and browser engine

## License

MIT
