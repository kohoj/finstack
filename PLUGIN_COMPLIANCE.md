# Plugin packaging contract

finstack uses the Codex compatibility manifest at
`.codex-plugin/plugin.json`. The distribution catalog is maintained in
[`kohoj/agent-plugins`](https://github.com/kohoj/agent-plugins); its entry fetches
this repository's `main` branch.

## Loading and startup

- `skills` points to `./skills/`, which contains the nine model-invoked skills.
- `mcpServers` points to `./.mcp.json`.
- The `finstack-data` executable is `${PLUGIN_ROOT}/bin/finstack-runtime`.
  Codex expands the plugin root before spawning it, independently of the
  session's working directory.
- The launcher requires Bun 1.3.14+ on `PATH`. It compiles the installed
  TypeScript sources to `engine/dist/finstack` when the binary is missing or
  stale, then replaces itself with the MCP server. Compilation logs go to
  stderr; stdout contains only protocol messages.
- The MCP environment sets `FINSTACK_HOME` to `${PLUGIN_DATA}`, the host's
  writable plugin data directory. Skill preambles also prefer `PLUGIN_DATA`
  and keep their compiled engine under that directory's `bin/`.
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
