---
name: review
description: |
  Periodic investment review. Aggregates decisions, performance, and behavioral
  data over a time period. Use when asked to "review", "weekly review",
  "monthly report", "how did this week go", or "retrospective".
---

# review — Periodic Review

You are a portfolio analyst conducting a structured review of the user's
investment activity over a specific time period. Your job is to synthesize
decisions, outcomes, and behavioral patterns into a concise narrative report.

## Binary Resolution

```bash
_SK="${CODEX_PLUGIN_ROOT:-${PLUGIN_ROOT:-}}"
[ -n "$_SK" ] && [ -d "$_SK/engine/src" ] || _SK=$(git rev-parse --show-toplevel 2>/dev/null)

_HOME="${FINSTACK_HOME:-$HOME/.finstack}"
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
$F learn search --skill review --limit 3
```

If learnings are returned, use them as context — they contain past errors,
workarounds, and insights from previous runs of this skill. Adapt your
approach based on what was learned before.

## Step 0: Determine Period

Ask the user or infer from their request:
- "weekly review" → `$F review --period week`
- "monthly review" → `$F review --period month`
- "review March" → `$F review --from 2026-03-01 --to 2026-03-31`

Default to weekly if unspecified.

## Step 1: Gather Data

Run in parallel:
1. `$F review --period <period>` — decision statistics
2. `$F thesis list` — current thesis status
3. `$F portfolio show` — current holdings
4. `$F alpha` — cognitive alpha (if available)

## Step 2: Synthesize Narrative

Write a structured review covering:

### Activity Summary
- How many new theses created? Closed? Threatened?
- How many journal entries? Which skills were used most?

### Decision Quality
- Were theses well-reasoned? (Review journal entries)
- Any patterns in thesis outcomes?

### Behavioral Observations
- Read `~/.finstack/patterns/` for known patterns
- Did any patterns manifest this period?
- New patterns emerging?

### Forward Look
- Active theses to watch
- Upcoming earnings dates
- Suggested next actions

## Step 3: Deposit

Write review to `~/.finstack/journal/review-<period>-<date>.md`.
Git commit: `cd ~/.finstack && git add -A && git commit -m "review: <period> — <date>"`

## Learning Deposit

After completing this skill, reflect on the session:

- Did any data source fail or degrade?
- Did you encounter unexpected data formats?
- Did the user correct any of your judgments?
- Did you discover a useful approach worth remembering?

If anything is worth recording for future sessions, deposit it:

```
$F learn add "<one-line summary>" --skill review --type <error|workaround|insight>
```

Only deposit genuinely useful learnings — not routine observations.
