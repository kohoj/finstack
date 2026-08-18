/**
 * MCP server — a full JSON-RPC session over stdio.
 *
 * The bridge's contract is that a tool call runs the exact CLI command a human
 * would, in a child process, and returns its stdout as tool content. That
 * cannot be unit-tested without a live process, because the whole point is the
 * two globals it isolates — stdout as the protocol channel, stdin as the
 * transport. So this drives the real server: spawn it, speak JSON-RPC, and
 * assert initialize / tools/list / tools/call — including the stdin `document`
 * bridge that `thesis add` depends on.
 *
 * Runs in dev mode (`bun run src/cli.ts mcp-server`) so it needs no prior build
 * and exercises the dev-mode launcher prefix (execPath + script path).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(import.meta.dir, '..', '..', 'src', 'cli.ts');

interface RpcResponse {
  id?: number;
  result?: any;
  error?: any;
}

/**
 * A live MCP server child, driven line by line. Each request is written to the
 * child's stdin; responses are read from stdout and matched by id.
 */
class Session {
  private proc: Bun.Subprocess<'pipe', 'pipe', 'ignore'>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buffer = '';
  private pending: RpcResponse[] = [];

  constructor(home: string) {
    this.proc = Bun.spawn(['bun', 'run', CLI, 'mcp-server'], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'ignore',
      env: { ...process.env, FINSTACK_HOME: home, FINSTACK_NO_BACKOFF: '1' },
    });
    this.reader = this.proc.stdout.getReader();
  }

  async request(msg: Record<string, unknown>): Promise<RpcResponse> {
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
    this.proc.stdin.flush();
    const id = msg.id as number;
    return this.readUntil(id);
  }

  notify(msg: Record<string, unknown>): void {
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
    this.proc.stdin.flush();
  }

  private async readUntil(id: number): Promise<RpcResponse> {
    while (true) {
      const hit = this.pending.findIndex(m => m.id === id);
      if (hit !== -1) return this.pending.splice(hit, 1)[0];

      const { value, done } = await this.reader.read();
      if (done) throw new Error('server closed stdout before responding');
      this.buffer += Buffer.from(value).toString('utf-8');

      for (let nl = this.buffer.indexOf('\n'); nl !== -1; nl = this.buffer.indexOf('\n')) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) this.pending.push(JSON.parse(line));
      }
    }
  }

  async close(): Promise<void> {
    this.proc.stdin.end();
    await this.proc.exited;
  }
}

let home: string;
let session: Session;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'finstack-mcp-int-'));
  session = new Session(home);
  const init = await session.request({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {} },
  });
  expect(init.result.serverInfo.name).toBe('finstack-data');
  expect(init.result.protocolVersion).toBe('2025-06-18');
  session.notify({ jsonrpc: '2.0', method: 'notifications/initialized' });
});

afterAll(async () => {
  await session.close();
  rmSync(home, { recursive: true, force: true });
});

describe('tools/list', () => {
  it('lists every command as a tool and omits the transport itself', async () => {
    const res = await session.request({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = res.result.tools.map((t: any) => t.name);
    expect(names).toContain('quote');
    expect(names).toContain('thesis');
    expect(names).not.toContain('mcp-server');
    expect(names.length).toBe(24);
  });
});

describe('tools/call', () => {
  it('runs a command and returns its stdout as text content', async () => {
    // portfolio init writes a fresh, network-free state file — a deterministic
    // command to prove the child actually ran and its stdout came back.
    const res = await session.request({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'portfolio', arguments: { args: ['init'] } },
    });
    expect(res.result.isError).toBe(false);
    const text = res.result.content[0].text;
    expect(text.length).toBeGreaterThan(0);
    // Valid JSON is the command's contract.
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('bridges a JSON document to a command that reads stdin', async () => {
    const doc = {
      ticker: 'NVDA',
      thesis: 'Datacenter demand persists through the cycle.',
      verdict: 'Bullish while gross margin holds.',
      conditions: [
        {
          description: 'Gross margin stays above 70%',
          type: 'earnings',
          metric: 'grossMargin',
          operator: '>',
          threshold: 0.7,
          resolveBy: '2026-12-31',
        },
      ],
    };
    const add = await session.request({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'thesis', arguments: { args: ['add'], document: doc } },
    });
    expect(add.result.isError).toBe(false);
    const created = JSON.parse(add.result.content[0].text);
    expect(created.ticker).toBe('NVDA');
    expect(created.id).toBeTruthy();

    // And it persisted: list it back through the same session.
    const list = await session.request({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'thesis', arguments: { args: ['list'] } },
    });
    const theses = JSON.parse(list.result.content[0].text);
    expect(theses.some((t: any) => t.id === created.id)).toBe(true);
  });

  it('reports a command failure as an errored tool result, not a torn-down loop', async () => {
    const res = await session.request({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'quote', arguments: { args: ['NOT A TICKER!!'] } },
    });
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('Invalid ticker');

    // The loop survives: a following call still works.
    const after = await session.request({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'portfolio', arguments: { args: ['show'] } },
    });
    expect(after.result.isError).toBe(false);
  });

  it('returns a JSON-RPC error for an unknown tool', async () => {
    const res = await session.request({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'nonexistent', arguments: {} },
    });
    expect(res.error).toBeTruthy();
    expect(res.error.code).toBe(-32602);
  });
});

describe('protocol edges', () => {
  it('answers ping and errors an unknown method', async () => {
    const ping = await session.request({ jsonrpc: '2.0', id: 9, method: 'ping' });
    expect(ping.result).toEqual({});

    const unknown = await session.request({ jsonrpc: '2.0', id: 10, method: 'no/such/method' });
    expect(unknown.error.code).toBe(-32601);
  });
});
