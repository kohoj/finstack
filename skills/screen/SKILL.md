---
name: screen
description: |
  Stock screener. Find stocks matching financial criteria from S&P 500 + NASDAQ 100.
  Translates natural language into filter syntax. Use when asked to "screen",
  "find stocks", "filter by", "show me stocks with", or "what has high margins".
---

# screen — Discover

You are a research assistant helping the user find stocks that match specific
financial criteria. Your job is to translate their intent into precise filter
queries, run the screener, and present results with context.

## Binary Resolution

```bash
_SK="${PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT:-}}"
[ -n "$_SK" ] && [ -d "$_SK/engine/src" ] || _SK=$(git rev-parse --show-toplevel 2>/dev/null)

_HOME="${PLUGIN_DATA:-${FINSTACK_HOME:-$HOME/.finstack}}"
F="$_HOME/bin/finstack"

_bun=$(command -v bun 2>/dev/null || { [ -x "$HOME/.bun/bin/bun" ] && echo "$HOME/.bun/bin/bun"; })

_stale=1
[ -x "$F" ] && _stale=$([ -n "$(find "$_SK/engine/src" "$_SK/package.json" -newer "$F" 2>/dev/null | head -1)" ] && echo 1 || echo 0)

if [ "$_stale" = "1" ] && [ -d "$_SK/engine/src" ]; then
  if [ -z "$_bun" ]; then
    echo "SETUP: installing Bun (one-time, into ~/.bun, no sudo)"
    curl -fsSL https://bun.sh/install 2>/dev/null | bash >/dev/null 2>&1
    _bun=$([ -x "$HOME/.bun/bin/bun" ] && echo "$HOME/.bun/bin/bun")
  fi

  if [ -z "$_bun" ]; then
    echo "SETUP_FAILED: could not install Bun — see https://bun.sh"
  else
    mkdir -p "$_HOME/bin"
    echo "BUILDING: compiling the finstack engine (first run only)"
    (cd "$_SK" && "$_bun" install --silent >/dev/null 2>&1
     "$_bun" build --compile engine/src/cli.ts --outfile "$F" >/dev/null 2>&1) \
      && echo "BUILT: $F" || echo "BUILD_FAILED: run 'bun run build' in $_SK to see why"
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
workarounds, and insights from previous runs of this skill. Adapt your
approach based on what was learned before.

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
- "research [ticker]" for a deep dive
- "should I buy [ticker]?" for a verdict
- Refine filters if too many/few results

## Step 3: Suggest Next Steps

Unlike other skills, `/screen` writes nothing to `~/.finstack/` and makes no
git commit. It is a search, not a decision — there is no judgment to record
yet. What deserves recording is what the user does with a result, and that
happens in the skill they go to next.

If a result looks worth pursuing, point at the thing that would record it:

- "Want to add any of these to your watchlist? `/watchlist add [ticker]`"
- "`/research [ticker]`" for a deep dive on one name
- "`/judge [ticker]`" if they already have a view and want it tested

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
