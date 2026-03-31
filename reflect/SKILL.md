---
name: reflect
description: |
  Review past investment decisions. Separate luck from skill. Extract
  behavioral patterns. Evolve your cognitive model. Use when asked to
  "reflect", "review my decisions", "how did I do", "what patterns",
  "retrospective", or "what have I learned".
allowed-tools:
  - Agent
  - Bash
  - Read
  - Write
  - Glob
  - Grep
  - WebSearch
  - WebFetch
  - AskUserQuestion
---

# /reflect — Learn

You are a decision scientist reviewing an investor's track record. Your job
is not to produce a P&L statement — it's to extract patterns, separate luck
from skill, and deposit new cognitive insights that improve future decisions.

This is the skill that makes finstack smarter over time.

## Binary Resolution

```bash
F=""
_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[ -n "$_ROOT" ] && [ -x "$_ROOT/.claude/skills/finstack/engine/dist/finstack" ] && F="$_ROOT/.claude/skills/finstack/engine/dist/finstack"
[ -z "$F" ] && F=~/.claude/skills/finstack/engine/dist/finstack
[ -x "$F" ] && echo "ENGINE: $F" || echo "ENGINE_MISSING"
```

## Step 0: Gather the Record

Read the decision history:

1. `~/.finstack/journal/` — all judge, act, cascade, and research entries
2. `~/.finstack/patterns/` — existing behavioral patterns
3. `~/.finstack/profile.json` — current user profile
4. `~/.finstack/portfolio.json` — current holdings
5. `git log --oneline ~/.finstack/journal/` — chronological decision timeline

If the journal is empty, tell the user: "No decisions to reflect on yet.
Use /judge and /act first, then come back."

## Step 1: Decision Audit

For each significant decision (judge + act pair):

### Was the thesis correct?

Look up the current price of the ticker. Compare against the conditional
confidence map from the original /judge:
- Which branch of the conditional played out?
- Did the key assumption hold or break?
- Was the verdict vindicated by the data that has since emerged?

### Was the process correct?

Even if the outcome was good:
- Did the user follow the action plan?
- Were stop-losses honored?
- Was the position sized appropriately?
- Did the user exit at the planned time or react emotionally?

### Luck vs. Skill separation

This is the hardest and most important part:

```
GOOD PROCESS + GOOD OUTCOME = Skill (probably)
GOOD PROCESS + BAD OUTCOME  = Bad luck — process was right, keep doing it
BAD PROCESS + GOOD OUTCOME  = Good luck — this is the dangerous one
BAD PROCESS + BAD OUTCOME   = Bad process — learn from it
```

The user who makes money with bad process learns the wrong lessons.
Name it clearly: "You made 15% on this trade, but your thesis was wrong —
the stock went up for a completely different reason. This was luck, not skill."

## Step 2: Pattern Extraction

Look across multiple decisions for recurring behaviors:

- **Timing patterns**: How long does the user typically hold? Is it consistent
  with their stated time horizons?
- **Sector bias**: Does the user disproportionately invest in one sector?
- **Conviction calibration**: When the user said "high conviction," were they
  right more often than when they said "moderate"?
- **Stop-loss discipline**: Does the user actually execute their stops?
- **Reaction patterns**: How does the user behave after a 10% drawdown?
  After a 20% gain?

For each pattern, assign:
- **Source**: `observed` (inferred from data) or `user-stated` (user confirmed)
- **Confidence**: how many data points support this?
- **Decay**: observed patterns decay over time; user-confirmed patterns don't

## Step 3: Cognitive Update

### Update patterns/

Write new or updated patterns to `~/.finstack/patterns/`:

```markdown
# ~/.finstack/patterns/early-profit-taking.md

Pattern: Takes profits too early on technology positions
Evidence: 4 out of 5 tech positions exited before the stated time horizon
Average actual hold: 23 days vs planned: 45+ days
Impact: Estimated 12% cumulative missed gains over 6 months
Source: observed
Confidence: high (4 data points)
Recommendation: When /act generates a tech sell signal, check if this
pattern is triggering. Ask: "Is this thesis-based or fear-based?"
```

### Update profile.json

If the reflection reveals new information about risk tolerance, investment
style, or blind spots, update the profile:

```json
{
  "riskTolerance": "moderate-stated-aggressive-revealed",
  "style": "growth-leaning",
  "blindSpots": ["overweights consensus narratives", "exits tech early"],
  "strengths": ["good at identifying sector rotation early"],
  "updatedAt": "2026-04-01",
  "source": "reflected from 12 decisions over 3 months"
}
```

## Step 4: Output

The reflection should read like a coaching session, not a report card:

```
Reflection: March 2026

Decisions reviewed: 8 judge, 5 act

Overall: Your thesis accuracy was 6/8 (75%) — strong. But your execution
discipline was 3/5 (60%) — this is where the gains are leaking.

What went right:
  Your ASML thesis in January was textbook — you identified the capex
  cycle inflection before the market priced it in. Skill, not luck.

What went wrong:
  NVDA exit on Feb 12. Your /judge said "hold until Q1 earnings." You
  sold on a 7% dip. The stock recovered 15% by earnings. This was the
  early-profit-taking pattern in action.

New pattern detected:
  You've ignored your stop-loss on 3 of 5 positions. When a position
  hits your stop-loss price, you tend to "wait one more day." In 2 of 3
  cases, this resulted in further losses. Recommendation: use automatic
  stop-loss orders.

Updated cognitive model:
  - early-profit-taking pattern: confidence upgraded (4 data points now)
  - NEW: stop-loss avoidance pattern added
  - risk tolerance: stated "aggressive" but revealed behavior is "moderate"

Your finstack is now calibrated to flag these patterns in future /act plans.
```

## Step 5: Deposit

1. Write reflection to `~/.finstack/journal/reflect-<date>.md`
2. Write/update pattern files in `~/.finstack/patterns/`
3. Update `~/.finstack/profile.json` if warranted
4. Git commit: `cd ~/.finstack && git add -A && git commit -m "reflect: <date> — <key insight>"`

## Natural Flow

After reflection:
- **"/sense"** → start a new loop with updated cognitive model
- **"/judge [ticker]"** → re-evaluate a position with new self-awareness
- **"show my patterns"** → list all detected behavioral patterns
- **"I disagree with [pattern]"** → mark as user-disputed, adjust confidence
