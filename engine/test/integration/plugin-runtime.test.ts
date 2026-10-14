/** Exercise the distributed MCP entry from a workspace outside the plugin. */
import { afterAll, beforeAll, expect, it } from 'bun:test';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
let sandbox: string;
let pluginRoot: string;
let workspace: string;
let dataRoot: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'finstack-plugin-'));
  pluginRoot = join(sandbox, 'plugin with spaces');
  workspace = join(sandbox, 'unrelated workspace');
  dataRoot = join(sandbox, 'plugin data');
  mkdirSync(workspace, { recursive: true });
  mkdirSync(join(pluginRoot, 'bin'), { recursive: true });
  cpSync(join(ROOT, 'engine', 'src'), join(pluginRoot, 'engine', 'src'), { recursive: true });
  for (const file of ['.mcp.json', 'package.json', 'bin/finstack-runtime']) {
    cpSync(join(ROOT, file), join(pluginRoot, file));
  }
});

afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

async function launch(): Promise<any[]> {
  const server = JSON.parse(readFileSync(join(pluginRoot, '.mcp.json'), 'utf-8')).mcpServers[
    'finstack-data'
  ];
  const expand = (value: string) =>
    value
      .replaceAll(`\${PLUGIN_ROOT}`, () => pluginRoot)
      .replaceAll(`\${PLUGIN_DATA}`, () => dataRoot);
  const env = Object.fromEntries(
    Object.entries(server.env as Record<string, string>).map(([key, value]) => [
      key,
      expand(value),
    ]),
  );
  const proc = Bun.spawn([expand(server.command), ...server.args], {
    cwd: workspace,
    env: { ...process.env, ...env },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const messages = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {} },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'portfolio', arguments: { args: ['show'] } },
    },
  ];
  proc.stdin.write(`${messages.map(message => JSON.stringify(message)).join('\n')}\n`);
  proc.stdin.end();
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`Packaged MCP exited ${code}: ${stderr}`);
  return stdout
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
}

it('boots a source-only plugin from another cwd and reuses the built engine', async () => {
  const engine = join(pluginRoot, 'engine', 'dist', 'finstack');
  expect(existsSync(engine)).toBe(false);

  const responses = await launch();
  expect(responses.find(response => response.id === 1).result.serverInfo).toEqual({
    name: 'finstack-data',
    version: readFileSync(join(ROOT, 'VERSION'), 'utf-8').trim(),
  });
  const tools = responses.find(response => response.id === 2).result.tools;
  expect(tools.map((tool: any) => tool.name)).toContain('portfolio');
  const call = responses.find(response => response.id === 3).result;
  expect(call.isError).toBe(false);
  expect(JSON.parse(call.content[0].text).positions).toEqual([]);
  expect(existsSync(engine)).toBe(true);

  const builtAt = statSync(engine).mtimeMs;
  expect((await launch()).find(response => response.id === 3).result.isError).toBe(false);
  expect(statSync(engine).mtimeMs).toBe(builtAt);
}, 20_000);
