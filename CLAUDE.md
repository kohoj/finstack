# finstack — AI Investment Research Operating System

## What This Is

finstack is a Claude Code skill pack for investment research. When users ask
investment-related questions, route them to the appropriate skill automatically.

## Skill Routing

| User intent | Skill | Example triggers |
|-------------|-------|-----------------|
| Morning briefing, market scan | `/sense` | "what's happening", "any signals", "morning briefing", "scan" |
| Deep company research | `/research` | "research NVDA", "deep dive", "analyze", "tell me about" |
| Buy/sell decision | `/judge` | "should I buy", "evaluate", "what do you think about" |
| Action plan, position sizing | `/act` | "what should I do", "trade plan", "how much to buy" |
| Chain reaction, event impact | `/cascade` | "what does X mean for", "trace the impact", "domino effect" |
| Performance tracking | `/track` | "how am I doing", "show alpha", "thesis status" |
| Decision review | `/reflect` | "review my decisions", "what patterns", "retrospective" |
| Find stocks by criteria | `/screen` | "find stocks", "screen for", "high margin companies" |
| Weekly/monthly review | `/review` | "weekly review", "monthly report", "how did this week go" |

## Engine Binary

The `finstack` engine binary provides data commands. Skills reference it as `$F`.

```bash
# Resolve the binary
_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
_SK="${_ROOT:+$_ROOT/.claude/skills/finstack}"
[ -z "$_SK" ] || [ ! -d "$_SK" ] && _SK=~/.claude/skills/finstack
F="$_SK/engine/dist/finstack"
```

## Key Commands for Quick Answers

When users ask simple data questions (not needing a full skill workflow):

- "What's NVDA trading at?" → `$F quote NVDA`
- "Show my portfolio" → `$F portfolio show`
- "What's on my watchlist?" → `$F watchlist`
- "Any alerts?" → `$F alerts`
- "Upcoming earnings?" → `$F calendar`
- "What if market crashes 20%?" → `$F scenario spy-20pct`
- "How correlated are my holdings?" → `$F correlate`
- "Backtest my closed theses" → `$F backtest`

## Data Directory

All user data lives in `~/.finstack/` (or `$FINSTACK_HOME`). Journal entries
are git-tracked. Never modify these files outside of `$F` commands.

## Important Behaviors

1. **Never fabricate financial data.** Always use `$F` commands or WebSearch.
2. **Conditional confidence over scores.** "If X then buy" not "Confidence: 7/10".
3. **Check behavioral patterns.** Read `~/.finstack/patterns/` before giving advice.
4. **Deposit learnings.** After each skill, record useful insights via `$F learn add`.
5. **Suggest next steps.** After /judge, suggest /act. After /act, suggest /track.
