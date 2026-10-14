# Plugin packaging contract

finstack uses the Codex compatibility manifest at
`.codex-plugin/plugin.json`. The distribution catalog is maintained in
[`kohoj/agent-plugins`](https://github.com/kohoj/agent-plugins); its entry fetches
this repository's `main` branch.

## Loading and startup

- `skills` points to `./skills/`, which contains the nine model-invoked skills.
- `mcpServers` points to `./.mcp.json`.
- The `finstack-data` command is `./bin/finstack-runtime`, with `cwd: "."`.
  Codex resolves this cwd against the installed plugin root before spawning
  the command, independently of the session's working directory. This native
  manifest format does not expand `${PLUGIN_ROOT}` or `${PLUGIN_DATA}` tokens;
  those belong to the separate Agent Plugins MCP schema.
- The launcher requires Bun 1.3.14+ on `PATH`. It compiles the installed
  TypeScript sources to `engine/dist/finstack` when the binary is missing or
  stale, then replaces itself with the MCP server. Compilation logs go to
  stderr; stdout contains only protocol messages.
- If the execution environment supplies `PLUGIN_DATA`, the launcher sets
  `FINSTACK_HOME` to that directory, matching the skill preambles. Otherwise,
  an existing `FINSTACK_HOME` is honored, or the engine uses `~/.finstack`.
  Skill preambles keep their compiled engine under the data directory's `bin/`.
- The 86400-second MCP tool timeout preserves the bounded Desk decision bridge.
- The package has no Codex lifecycle hooks. Engine compilation is owned by
  the launcher and skill preambles, so installation does not require hook trust
  or unsupported `onInstall`/`onUpgrade` events.

The MCP launcher currently needs a writable plugin cache for compilation.
Native Windows startup is not supported by this Bash launcher; use a supported
Unix environment.

## Verification

Run `bun run test:gate`. Its distribution regression test copies only source
files, starts the MCP server from another workspace with spaces in the paths,
and checks initialization, tool discovery, a tool call, and warm startup.

For host acceptance, install the candidate in Codex, check `/mcp` for a
connected `finstack-data` server, and inspect `/warnings` for plugin parse or
startup failures. These checks establish local compatibility; they do not
constitute approval by the public plugin directory.

Packaging follows the
[official Codex plugin documentation](https://developers.openai.com/plugins/build/plugins).
