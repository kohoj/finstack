# Roadmap

What is being worked on and why. Dates are omitted deliberately — this is a
side project, and a date I miss is worse than no date.

## Now

**v0.7.0 shipped the correctness work** — unified error handling, locked state
writes, centralized validation, schema validation at the skill boundary, and
552 tests where there were 179. See [CHANGELOG.md](CHANGELOG.md).

Next up is whatever the first outside user hits. There is no substitute for
that, and no amount of internal testing produces it.

## Next

**Thesis condition auto-resolution.** Earnings conditions carry a metric, an
operator, a threshold, and a resolve-by date — everything needed to check them
against reported results automatically. Today `/sense` surfaces them for human
judgment. Machine-resolving the unambiguous ones would leave humans deciding
only what actually requires judgment.

**Cross-source disagreement detection.** When Yahoo and Polygon report
materially different figures for the same metric, that disagreement is itself a
signal — usually of a restatement, a split, or a data error. The fallback chain
currently takes the first source that answers and moves on.

## Under Consideration

**International markets.** The ticker pattern already accepts `7203.T`, and
Yahoo serves non-US exchanges. What is missing is currency handling in the
portfolio and risk math, which is not a small change.

**Position-level tax lots.** The portfolio tracks a single averaged cost basis.
Real tax-lot accounting would make after-tax return meaningful, at the cost of
significant complexity in the transaction log.

**A `patterns/` review command.** `/reflect` writes behavioral patterns and
`/act` reads them, but there is no way to list, edit, or dispute them outside a
skill invocation.

## Explicitly Not Planned

**Automated trading.** finstack produces analysis. Executing on it is the
user's decision, and building the bridge would change what the tool is for.

**Real-time streaming.** The cache TTLs (5 minutes for quotes) reflect the
intended use — deliberate research, not monitoring a tape. Sub-minute data
would invite a different and worse relationship with the market.

**A hosted version.** The data lives in `~/.finstack/` because it is yours.
A server would mean someone else holding your positions and your reasoning.

**Backtesting a strategy.** `finstack backtest` replays *your recorded theses*
against what actually happened. It is a record of your judgment, not a
strategy simulator, and turning it into one would encourage curve-fitting.

## Toward 1.0

1.0 means the system is safe for someone else's money-adjacent decisions:

- [x] Every command has tests
- [x] Uniform, actionable error handling
- [x] Concurrent state writes are safe
- [x] Documentation drift fails CI
- [x] Every skill has an E2E test
- [x] Skill-authored state is schema-validated
- [ ] A published release with prebuilt binaries
- [ ] Someone other than the author has run it for a full quarter

The last one is the real bar. Everything else is verifiable in CI; that one is
not.
