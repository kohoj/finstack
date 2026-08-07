# Security Policy

## Reporting a Vulnerability

Report security issues privately through
[GitHub Security Advisories](https://github.com/kohoj/finstack/security/advisories/new).
Please do not open a public issue for a vulnerability.

You can expect an acknowledgement within 72 hours and an assessment within a
week. If the report is valid, you will be credited in the fix commit and the
changelog unless you prefer otherwise.

## Protecting Your Own Data

finstack stores API keys and a complete record of your investment decisions in
`~/.finstack/`. Two things are worth knowing:

**`~/.finstack/` is a git repository, and it is not meant to be public.** The
setup script runs `git init` there so your decision history is versioned and
diffable. It never adds a remote. If you add one, you are publishing your
positions, your reasoning, and your behavioral patterns.

**`keys.json` holds credentials in plaintext**, protected by `0o600` file
permissions. finstack does not encrypt them. On a shared or backed-up machine,
treat that file the way you would treat `~/.aws/credentials`.

To move your data between machines, copy the directory directly rather than
pushing it anywhere:

```bash
tar czf finstack-backup.tar.gz -C ~ .finstack
```

## What finstack Does With Your Data

- **Nothing leaves your machine except market data requests.** Tickers are sent
  to Yahoo Finance, SEC EDGAR, FRED, and any Tier 2 provider you have
  configured. Your positions, share counts, and reasoning are not.
- **API keys are sent only to the provider that issued them.**
- **Cached responses contain no credentials.** Data sources return public market
  data; commands allowlist the fields they extract, so an unexpected field in a
  response does not reach disk.
- **Error output is sanitized.** `FinstackError` payloads carry a message, a
  source name, a reason, and a suggestion — never stack traces, environment
  variables, or raw API responses.

These properties are asserted in `engine/test/adversarial.test.ts` and
`engine/test/security.test.ts`, including against a data source that
deliberately echoes a configured key back in its response body.

## Threat Model

finstack is a local CLI. It has no server, no listening port, and no
multi-user mode. The realistic attack surface is:

| Vector | Mitigation |
|--------|-----------|
| Malicious ticker reaching a URL or filename | Allowlist pattern `^[A-Z0-9.-]{1,10}$`, requiring at least one alphanumeric character |
| Hostile or compromised data source | Field allowlisting on extraction; responses are never written verbatim |
| Corrupt or truncated state file | `readJSONSafe()` falls back rather than throwing |
| Concurrent writes losing data | File-level mutex around every read-modify-write cycle |
| Credentials in logs or cache | Sanitized error payloads; cache holds only extracted fields |

Out of scope: a compromised local machine, a malicious Codex plugin
installed by the user, and the correctness of the market data itself.

## Not a Security Issue

**finstack's investment output.** The system produces analysis, not advice.
A wrong verdict is a bug in reasoning, not a vulnerability — please open a
regular issue.

**Rate limits or blocks from data providers.** Report as a regular issue so the
fallback chain can be improved.
