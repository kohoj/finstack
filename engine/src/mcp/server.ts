// engine/src/mcp/server.ts
//
// A minimal, zero-dependency MCP (Model Context Protocol) stdio server that
// exposes every finstack command as a tool.
//
// `.mcp.json` registers this process as `finstack mcp-server`. The plugin host
// speaks JSON-RPC 2.0 over the process's stdin/stdout, one message per line
// (the MCP stdio framing — newline-delimited, no Content-Length headers).
//
// Design: a subprocess bridge, not in-process dispatch. Each tool call
// re-invokes the same finstack binary as a child process, feeding CLI args and
// (for the two composing commands) a JSON document on the child's stdin, then
// captures the child's stdout. Two seams force this:
//
//   1. Every command writes its result to the global `console.log`. In this
//      process, stdout IS the JSON-RPC channel — a command printing there would
//      corrupt the protocol stream.
//   2. `thesis add` / `shadow add` read their document from the global
//      process.stdin. In this process, stdin IS the JSON-RPC transport.
//
// Re-invoking as a child isolates both globals cleanly and runs the exact CLI
// code path, so a tool can never diverge from the command a human would run.

import { FinstackError } from '../errors';

// The plugin host displays this. It is asserted equal to the repository VERSION
// by scripts/check-docs.ts so it cannot silently drift.
export const SERVER_VERSION = '0.7.2';

// The protocol revision to fall back to when a client does not name one.
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

// Commands whose `add` subcommand reads a JSON document from stdin. For these,
// the tool accepts a `document` object that the bridge pipes to the child.
const STDIN_COMMANDS = new Set(['thesis', 'shadow']);

/**
 * One-line tool descriptions, keyed by command name. Every registered command
 * must have one (enforced at startup) so no undescribed tool ever ships, and
 * every key must be a real command so the map cannot name a phantom.
 */
const DESCRIPTIONS: Record<string, string> = {
  quote: 'Price snapshot with key metrics. Usage: finstack quote <ticker>',
  financials: 'Financial data and ratios. Usage: finstack financials <ticker>',
  scan: 'Multi-source signal scanning. Usage: finstack scan [--source trending|news|all]',
  regime: 'Consensus assumption register. Usage: finstack regime list|add|update|alerts',
  portfolio: 'Portfolio management. Usage: finstack portfolio show|add|remove|init',
  keys: 'API key management. Usage: finstack keys set|list|remove',
  macro: 'FRED macro indicators. Usage: finstack macro [series]',
  filing: 'SEC EDGAR filings. Usage: finstack filing <ticker>',
  history: 'Historical price data. Usage: finstack history <ticker> [--from --to]',
  earnings: 'Earnings history + upcoming date. Usage: finstack earnings <ticker> [--upcoming]',
  alpha: 'Cognitive alpha calculation. Usage: finstack alpha [--last N]',
  thesis:
    'Thesis lifecycle. Usage: finstack thesis add|list|check|threaten|kill — pass the thesis JSON as `document` when the first arg is "add".',
  risk: 'Portfolio risk + position sizing. Usage: finstack risk [size <ticker> <entry> <stop> [--shares N]] | snapshot <value> | profile [--risk-budget N]',
  watchlist: 'Watchlist management. Usage: finstack watchlist [add|remove|tag|untag]',
  alerts: 'Check pending alerts. Usage: finstack alerts [--due N] [--source S]',
  calendar: 'Upcoming earnings calendar. Usage: finstack calendar [--range N]',
  screen: 'Stock screener with filter syntax. Usage: finstack screen "<filters>" [--preset P]',
  learn: 'Operational learnings management. Usage: finstack learn add|search|recent',
  report: 'Generate HTML visual reports. Usage: finstack report sense|track|reflect [--no-open]',
  review: 'Periodic investment review. Usage: finstack review [--period P] [--from F --to T]',
  backtest: 'Thesis replay backtest. Usage: finstack backtest [--thesis ID] [--period N]',
  correlate: 'Portfolio correlation matrix. Usage: finstack correlate [--period N]',
  scenario: 'Scenario analysis. Usage: finstack scenario <name|custom>',
  shadow:
    'Shadow portfolio. Usage: finstack shadow add|close|show — pass the shadow entry JSON as `document` when the first arg is "add".',
};

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

function buildTool(name: string): Tool {
  const properties: Record<string, unknown> = {
    args: {
      type: 'array',
      items: { type: 'string' },
      description: 'Positional arguments and flags, exactly as passed on the finstack CLI.',
    },
  };
  if (STDIN_COMMANDS.has(name)) {
    properties.document = {
      type: 'object',
      description: 'JSON document piped to the command on stdin (used by the `add` subcommand).',
    };
  }
  return {
    name,
    description: DESCRIPTIONS[name] as string,
    inputSchema: { type: 'object', properties, required: [] },
  };
}

/**
 * The OS-level argv prefix that re-invokes this same program with a command.
 *
 * Compiled single-file binary: process.execPath is the binary itself, and its
 * argv[1] is a virtual `/$bunfs/` path — so the prefix is just the binary, and
 * spawning it with `[command, ...args]` lands `command` at argv[2].
 *
 * Dev (`bun run engine/src/cli.ts`): execPath is the bun runtime and argv[1] is
 * the script path, so both are needed to reconstruct the launcher.
 */
function launcherPrefix(): string[] {
  const compiled = process.argv[1]?.includes('/$bunfs/') ?? false;
  return compiled ? [process.execPath] : [process.execPath, process.argv[1] as string];
}

interface CommandRun {
  ok: boolean;
  text: string;
}

async function runCommand(
  prefix: string[],
  command: string,
  args: string[],
  document?: string,
): Promise<CommandRun> {
  const proc = Bun.spawn([...prefix, command, ...args], {
    stdin: document !== undefined ? new TextEncoder().encode(document) : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  // Commands print their JSON result to stdout and exit 0; on failure they print
  // a structured FinstackError JSON to stderr and exit 1. Surface whichever
  // carries the payload, and let isError reflect the exit code.
  if (code === 0) return { ok: true, text: out.trim() || err.trim() };
  return { ok: false, text: err.trim() || out.trim() || `Command exited with code ${code}` };
}

// ── JSON-RPC plumbing ────────────────────────────────────────────────────────

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function send(msg: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function reply(id: string | number, result: Record<string, unknown>): void {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id: string | number | null, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleMessage(line: string, prefix: string[], tools: Tool[]): Promise<void> {
  let msg: JsonRpcMessage;
  try {
    msg = JSON.parse(line);
  } catch {
    replyError(null, -32700, 'Parse error');
    return;
  }

  const { method, params } = msg;
  const isRequest = 'id' in msg && msg.id !== null && msg.id !== undefined;
  const id = msg.id as string | number;

  switch (method) {
    case 'initialize': {
      const requested = (params?.protocolVersion as string) || DEFAULT_PROTOCOL_VERSION;
      reply(id, {
        protocolVersion: requested,
        capabilities: { tools: {} },
        serverInfo: { name: 'finstack-data', version: SERVER_VERSION },
      });
      return;
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      // Notifications carry no id and expect no response.
      return;
    case 'ping':
      if (isRequest) reply(id, {});
      return;
    case 'tools/list':
      if (isRequest) reply(id, { tools });
      return;
    case 'tools/call': {
      if (!isRequest) return;
      await handleToolCall(id, params, prefix, tools);
      return;
    }
    default:
      // Unknown requests must be answered; unknown notifications are ignored.
      if (isRequest) replyError(id, -32601, `Method not found: ${method}`);
      return;
  }
}

async function handleToolCall(
  id: string | number,
  params: Record<string, unknown> | undefined,
  prefix: string[],
  tools: Tool[],
): Promise<void> {
  const name = params?.name as string;
  const tool = tools.find(t => t.name === name);
  if (!tool) {
    replyError(id, -32602, `Unknown tool: ${name}`);
    return;
  }

  const rawArgs = (params?.arguments as Record<string, unknown> | undefined) ?? {};
  const args = Array.isArray(rawArgs.args) ? rawArgs.args.map(String) : [];
  const document = rawArgs.document !== undefined ? JSON.stringify(rawArgs.document) : undefined;

  // A spawn failure is a fault in this request alone; report it to the caller
  // and keep the server loop alive rather than tearing down every session.
  try {
    const { ok, text } = await runCommand(prefix, name, args, document);
    reply(id, { content: [{ type: 'text', text }], isError: !ok });
  } catch (e) {
    reply(id, {
      content: [{ type: 'text', text: (e as Error).message }],
      isError: true,
    });
  }
}

/**
 * Validate the tool/description registry against the live command set, then run
 * the stdio JSON-RPC loop until stdin closes.
 *
 * `commandNames` is injected by the CLI (Object.keys of its command table) so
 * the exposed tools are exactly the registered commands — no second list to
 * drift. A missing or phantom description fails fast at startup.
 */
export async function runMcpServer(commandNames: string[]): Promise<void> {
  for (const name of commandNames) {
    if (!(name in DESCRIPTIONS)) {
      throw new FinstackError(
        `MCP tool description missing for command: ${name}`,
        undefined,
        'Every registered command must be described in engine/src/mcp/server.ts',
        `Add a DESCRIPTIONS entry for "${name}"`,
      );
    }
  }
  for (const name of Object.keys(DESCRIPTIONS)) {
    if (!commandNames.includes(name)) {
      throw new FinstackError(
        `MCP description names a non-existent command: ${name}`,
        undefined,
        'DESCRIPTIONS must not reference commands that are not registered',
        `Remove the DESCRIPTIONS entry for "${name}"`,
      );
    }
  }

  const tools = commandNames.map(buildTool);
  const prefix = launcherPrefix();

  let buffer = '';
  for await (const chunk of process.stdin) {
    buffer += Buffer.from(chunk as Uint8Array).toString('utf-8');
    for (let nl = buffer.indexOf('\n'); nl !== -1; nl = buffer.indexOf('\n')) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) await handleMessage(line, prefix, tools);
    }
  }
}

// Exposed for tests: the pure pieces that do not need a live stdio loop.
export const _internal = { buildTool, DESCRIPTIONS, STDIN_COMMANDS, launcherPrefix };
