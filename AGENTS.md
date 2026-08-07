# finstack — AI Investment Research Operating System

## What This Is

finstack is a Codex plugin for investment research. Two layers:

- **Engine** (`engine/`) — a compiled binary handling deterministic work:
  fetching, caching, validating, computing. Emits structured JSON.
- **Skills** (`skills/`) — prompts that orchestrate reasoning. They shell out
  to the engine for data and do the thinking themselves.

Skills are model-invoked. There is nothing for the user to memorize — when
someone asks about their portfolio, the matching skill applies.

## Skill Routing

| User intent | Skill | Example phrasing |
|-------------|-------|------------------|
| Morning briefing, market scan | `sense` | "any signals today", "morning briefing", "what's happening" |
| Deep company research | `research` | "research NVDA", "deep dive", "tell me about" |
| Buy/sell judgment | `judge` | "should I buy", "evaluate", "what do you think about" |
| Action plan, position sizing | `act` | "what should I do", "trade plan", "how much to buy" |
| Chain reaction of an event | `cascade` | "what does X mean for", "trace the impact" |
| Performance tracking | `track` | "how am I doing", "show alpha", "thesis status" |
| Decision review | `reflect` | "review my decisions", "what patterns", "retrospective" |
| Find stocks by criteria | `screen` | "find stocks", "screen for", "high margin companies" |
| Weekly/monthly review | `review` | "weekly review", "how did this week go" |

## Engine Binary

Each SKILL.md opens with a preamble that sets `$F` to the engine path. It
builds on first use — installing Bun if needed — and lands in
`~/.finstack/bin/finstack`.

That location is outside the plugin directory on purpose: the install path
contains the version, so an upgrade would orphan the binary, and a read-only
cache would fail the write.

## Quick Answers

For simple questions, call the engine directly rather than running a full
skill workflow:

- "What's NVDA trading at?" → `$F quote NVDA`
- "Show my portfolio" → `$F portfolio show`
- "Am I too concentrated?" → `$F risk`
- "What if the market drops 20%?" → `$F scenario spy-20pct`
- "How correlated are my holdings?" → `$F correlate`
- "Upcoming earnings?" → `$F calendar`
- "Any alerts?" → `$F alerts`

## Data Directory

State lives in `~/.finstack/` (override with `FINSTACK_HOME`). Every file is
human-readable JSON, and the directory is a git repository — `git log` is the
decision history.

Do not edit these files directly. Use `$F` commands: they take a lock, write
atomically, and validate.

Two files hold composed reasoning and have dedicated commands:

```bash
echo '<json>' | $F thesis add     # $F thesis add --schema prints the shape
echo '<json>' | $F shadow add
```

Both validate before writing. A rejected document names the offending field.

## Behavioral Rules

1. **Never fabricate financial data.** Use `$F` commands or web search.
2. **Conditional confidence over scores.** "If Q2 margin > 70%, then buy" —
   never "7/10". A scored verdict cannot become a monitorable condition, which
   is what `thesis add` needs.
3. **Check behavioral patterns.** Read `~/.finstack/patterns/` before advising.
   That directory is how the system remembers what this user gets wrong.
4. **Deposit learnings.** After each skill:
   `$F learn add "<summary>" --skill <name> --type <error|workaround|insight>`
5. **Allow "nothing".** If no signal is worth reporting, say so. Do not
   manufacture significance.
