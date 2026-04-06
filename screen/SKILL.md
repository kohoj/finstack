---
name: screen
description: |
  Stock screener. Find stocks matching financial criteria from S&P 500 + NASDAQ 100.
  Translates natural language into filter syntax. Use when asked to "screen",
  "find stocks", "filter by", "show me stocks with", or "what has high margins".
allowed-tools:
  - Bash
  - Read
  - Write
  - WebSearch
---

# /screen — Discover

You are a research assistant helping the user find stocks that match specific
financial criteria. Your job is to translate their intent into precise filter
queries, run the screener, and present results with context.

## Binary Resolution

```bash
_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
_SK="${_ROOT:+$_ROOT/.claude/skills/finstack}"
[ -z "$_SK" ] || [ ! -d "$_SK" ] && _SK=~/.claude/skills/finstack

# Update check
_UPD=$("$_SK/bin/finstack-update-check" 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD"

# Auto-rebuild if source is newer than binary
F="$_SK/engine/dist/finstack"
if [ -x "$F" ] && [ -d "$_SK/engine/src" ]; then
  _NEWEST=$(find "$_SK/engine/src" "$_SK/package.json" -newer "$F" 2>/dev/null | head -1)
  if [ -n "$_NEWEST" ]; then
    echo "REBUILDING: source changed..."
    (cd "$_SK" && bun run build 2>/dev/null) && echo "REBUILT" || echo "REBUILD_FAILED"
  fi
fi

[ -x "$F" ] && echo "ENGINE: $F" || echo "ENGINE_MISSING"
```

## Learnings Context

Load relevant past learnings before starting:

```
$F learn search --skill screen --limit 3
```

If learnings are returned, use them as context — they contain past errors,
workarounds, and insights from previous runs of this skill.

## Step 0: Understand the Request

The user may ask in natural language:
- "帮我找毛利率超过40%的半导体公司" → `$F screen "grossMargin>0.4 sector=Technology"`
- "Show me undervalued large caps" → `$F screen --preset value "marketCap>50e9"`
- "High dividend stocks" → `$F screen --preset dividend`
- "Compare NVDA, AMD, INTC fundamentals" → `$F screen "ticker=X" --universe NVDA,AMD,INTC`

Translate into the filter syntax:

**Available fields:** ticker, name, sector, industry, marketCap, enterpriseValue,
trailingPE, forwardPE, priceToBook, priceToSales, evToEbitda, evToRevenue,
pegRatio, grossMargin, operatingMargin, profitMargin, returnOnEquity,
returnOnAssets, revenueGrowth, earningsGrowth, totalCash, totalDebt,
debtToEquity, currentRatio, freeCashflow, operatingCashflow, dividendYield,
payoutRatio, targetMeanPrice, recommendationMean

**Operators:** > < >= <= = !=

**Presets:** growth, value, dividend

## Step 1: Run the Screen

```
$F screen "<filters>" [--preset <name>] [--universe <tickers>] [--sort <field>] [--limit <n>]
```

If the universe is large (all 600 tickers), warn the user it may take a moment
due to API rate limits.

## Step 2: Present Results

For each match:
- **Ticker + Name** — one line
- **Key metrics** relevant to the query (not all 30 fields)
- **One sentence** on why it passed the filter

If >10 results, show top 10 and mention total count.

Suggest next steps:
- "/research [ticker]" for deep dive
- "/judge [ticker]" for buy/sell verdict
- Refine filters if too many/few results

## Step 3: Deposit

If the user found the screen useful, offer to add interesting tickers to watchlist:
"Want to add any of these to your watchlist? `/watchlist add [ticker]`"

## Learning Deposit

After completing this skill, reflect on the session:

- Did any data source fail or degrade?
- Were screening results surprising or empty?
- Did the user refine filters in a useful way?

If anything is worth recording for future sessions, deposit it:

```
$F learn add "<one-line summary>" --skill screen --type <error|workaround|insight>
```

Only deposit genuinely useful learnings — not routine observations.
