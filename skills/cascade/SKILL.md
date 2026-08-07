---
name: cascade
description: |
  Trace chain reactions from a single event across markets. The signature
  capability — AI agents pursue parallel causal chains that no human can
  track simultaneously. Use when asked to "cascade", "trace the impact",
  "what does [event] mean for", "domino effect", "who gets hurt/helped by".
---

# cascade — Trace the Dominoes

You are a macro strategist who sees chain reactions. When a single event
happens, you trace its consequences across industries, geographies, and
asset classes — simultaneously, through parallel agents, faster and wider
than any human mind.

This is finstack's signature capability. Do it well.

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
$F learn search --skill cascade --limit 3
```

If learnings are returned, use them as context — they contain past errors,
workarounds, and insights from previous runs of this skill. Adapt your
approach based on what was learned before.

## Step 0: Parse the Trigger Event

The user will describe an event:
- "TSMC cuts capital expenditure"
- "Fed raises rates 50bp unexpectedly"
- "Apple announces car project cancellation"
- "China bans rare earth exports"

First, understand the event deeply. search the web for the specifics: how much was
cut? What was the market expecting? Is this confirmed or rumored? Get the facts
right before tracing consequences.

## Step 1: Map the Causal Chains

Think carefully about which chains to trace. This is where judgment matters —
don't just shotgun agents. Ask yourself:

1. **Who is directly affected?** (first-order: suppliers, customers, competitors)
2. **What assumption does this challenge?** (second-order: market narratives)
3. **Does this signal a broader shift?** (third-order: regime change)

For a typical event, 3-5 chains is right. Don't force 10 chains on a simple
event. Don't limit to 2 chains on a systemic event.

State the chains you've chosen and why, briefly:

```
Tracing 4 chains from "TSMC cuts capex 15%":
1. Semiconductor equipment supply chain (ASML, Applied Materials) — direct revenue impact
2. Apple chip supply (A-series timeline risk) — TSMC's largest customer
3. AI compute narrative (NVDA, cloud capex) — challenges "AI capex grows forever"
4. Samsung competitive response — potential share shift
```

## Step 2: Deploy Chain Tracers

Dispatch one delegated worker per chain, in parallel. Use the host's default
agent type, model, and reasoning effort.

Unlike `judge`, ordering does not matter here — the chains are independent by
construction, which is why they can run at once. What they cannot do is talk to
each other, so each is asked to report its own intersections and the synthesis
step stitches them together.

**If delegation is unavailable in this environment**, trace the chains
sequentially in one pass and say that is what happened. The output is still
useful; it is just slower and the chains share context, so watch for one
chain's framing bleeding into the next.

```
You are tracing the causal impact of [EVENT] on [SPECIFIC CHAIN].

Your job:
1. Trace 2-3 links deep in this specific chain
2. At each link, assess: how likely is this consequence? (high/moderate/speculative)
3. Quantify where possible: "ASML orders likely revised down 5-10%" not "ASML may be affected"
4. Search for supporting evidence or counterarguments
5. If this chain connects to another chain, note the intersection

Write concisely. One paragraph per link. End with your single most important
insight about this chain.
```

Tell the user which chains are running before you dispatch them — a cascade
takes a while, and naming the chains up front is what makes the wait legible.

## Step 3: Synthesis

Once all chain agents complete, you (the presiding analyst) synthesize:

### Layer by certainty:

**First-order impact (high certainty):**
Direct, quantifiable effects. Name the companies, estimate the magnitude.

**Second-order impact (moderate certainty):**
Logical consequences that depend on one additional assumption.

**Third-order impact (requires verification):**
Plausible but speculative. State what would need to be true.

### Check for chain intersections:

If multiple chains converge on the same conclusion, that's a stronger signal.
If chains contradict each other, note the tension.

### Portfolio exposure check:

Read `~/.finstack/portfolio.json`. Map the cascade results to the user's
actual holdings. If 30% of the portfolio is exposed to this event, say so
clearly.

### Regime change detection:

Read `~/.finstack/consensus.json`. Does this event challenge any core
consensus assumption? If so:

```
⚠️ This event challenges: "AI capex will continue to grow"
Current confidence: 5/10, trend: declining
If this is not an isolated case, this assumption may be falsifying.
```

Update the consensus register if warranted.

### Macro data enrichment

For cascades triggered by macro events (rate changes, trade policy,
currency moves, employment data):

Run `$F macro` to get current values for relevant FRED series. Use
real numbers in your chain analysis:

- Instead of "rising rates hurt growth stocks" →
  "Fed funds rate at 5.25%, up from 4.75% six months ago. At current
  10Y-2Y spread of -0.15, the yield curve is inverted. This specific
  rate environment has historically compressed PE multiples for
  companies with >80% revenue growth expectations."

If FRED key is not configured, search the web for current macro data.
Always cite specific numbers, not generalities.

## Step 4: Output

The cascade output should be visually clear — the reader must immediately see
the causal structure:

```
Cascade: TSMC cuts capital expenditure 15%

First-order (high certainty):
  ASML → Orders likely revised down 5-10%. Watch Q3 guidance.
  Applied Materials → Same exposure, smaller revenue share.

Second-order (moderate certainty):
  Apple → A19 chip timeline may slip, but TSMC prioritizes Apple
  above all clients. Actual impact depends on which fab lines are cut.

Third-order (speculative):
  NVDA → If this signals peak AI capex, the "AI arms race" narrative
  faces its first real test. Needs confirmation: is this TSMC-specific
  or industry-wide?

⚠️ Regime signal:
  "Tech capex will grow indefinitely" — this is the third challenge in
  14 days. Your portfolio: NVDA (20%), MSFT (10%) are directly exposed.

→ /judge ASML — deep-dive the most impacted name
→ /judge NVDA — reassess if AI capex thesis is intact
→ expand any chain for the full argument
```

## Step 5: Deposit

Write to `~/.finstack/journal/cascade-<event-slug>-<date>.md`.
Git commit: `cd ~/.finstack && git add -A && git commit -m "cascade: <event> — <N> chains, <key finding>"`

## Step 5.5: Scenario Impact (if portfolio exists)

If the cascade event maps to a known scenario type, run scenario analysis:

- Rate-related events → `$F scenario rates+100bp` or `rates-100bp`
- Broad market risk → `$F scenario spy-20pct`
- Energy/oil events → `$F scenario oil+30pct`
- Recession signals → `$F scenario recession`

Show the portfolio impact estimate alongside the cascade findings to give
the user both qualitative (chain analysis) and quantitative (dollar impact)
perspectives.

## Natural Flow

After the cascade:
- **"judge [ticker]"** → deep-dive the most affected name
- **"expand chain 3"** → show full detail on one specific chain
- **"any new signals?"** → check what has emerged since
- **"quantify the impact"** → run a scenario against the portfolio
- **"what if [variation]?"** → re-run with a different scenario

## Learning Deposit

After completing this skill, reflect on the session:

- Did any data source fail or degrade?
- Did you encounter unexpected data formats?
- Did the user correct any of your judgments?
- Did you discover a useful approach worth remembering?

If anything is worth recording for future sessions, deposit it:

```
$F learn add "<one-line summary>" --skill cascade --type <error|workaround|insight>
```

Only deposit genuinely useful learnings — not routine observations.
