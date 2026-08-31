/**
 * MCP server — tool registry and framing.
 *
 * The subprocess bridge itself needs a live binary (covered by the integration
 * test). What is pure and worth pinning here: the tool set is exactly the
 * registered commands, every command has a description, the stdin-composing
 * commands expose a `document` input and the rest do not, and the startup
 * validation fails fast on any drift between the command table and the
 * description map — the one place this server could silently ship a broken or
 * undescribed tool.
 */
import { describe, expect, it } from 'bun:test';
import { _internal, runMcpServer, SERVER_VERSION } from '../../src/mcp/server';

const { buildAwaitDecisionTool, buildDeskOpenTool, buildTool, DESCRIPTIONS, STDIN_COMMANDS } =
  _internal;

// The command table cli.ts injects. Kept here as a literal so a divergence
// between this and the real registry surfaces as a failing description check.
const COMMANDS = [
  'quote',
  'financials',
  'scan',
  'regime',
  'portfolio',
  'keys',
  'macro',
  'filing',
  'history',
  'earnings',
  'alpha',
  'thesis',
  'risk',
  'watchlist',
  'alerts',
  'calendar',
  'screen',
  'learn',
  'report',
  'review',
  'backtest',
  'correlate',
  'scenario',
  'shadow',
  'desk',
];

describe('tool construction', () => {
  it('gives every command a description and an args array input', () => {
    for (const name of COMMANDS) {
      const tool = buildTool(name);
      expect(tool.name).toBe(name);
      expect(tool.description.length).toBeGreaterThan(0);
      const props = (tool.inputSchema as any).properties;
      expect(props.args.type).toBe('array');
      expect(props.args.items.type).toBe('string');
    }
  });

  it('exposes a document input only for the stdin-composing commands', () => {
    for (const name of COMMANDS) {
      const props = (buildTool(name).inputSchema as any).properties;
      const hasDocument = 'document' in props;
      expect(hasDocument).toBe(STDIN_COMMANDS.has(name));
    }
    // These commands compose a JSON document on stdin.
    expect([...STDIN_COMMANDS].sort()).toEqual(['portfolio', 'shadow', 'thesis']);
  });

  it('names no description without a matching command', () => {
    for (const name of Object.keys(DESCRIPTIONS)) {
      expect(COMMANDS).toContain(name);
    }
  });
});

describe('interactive Desk bridge', () => {
  it('exposes a dedicated Desk-opening tool for hosts with a visible panel action', () => {
    expect(buildDeskOpenTool().name).toBe('desk_open');
  });

  it('exposes one explicit, bounded human-decision tool', () => {
    const tool = buildAwaitDecisionTool();
    expect(tool.name).toBe('await_decision');
    expect((tool.inputSchema as any).required).toEqual(['description']);
  });
});

describe('startup validation', () => {
  it('rejects a command with no description', async () => {
    // A live stdin loop never starts because validation throws first.
    await expect(runMcpServer([...COMMANDS, 'newcmd'])).rejects.toThrow(
      /description missing for command: newcmd/,
    );
  });

  it('rejects a description that names a non-existent command', async () => {
    const missingThesis = COMMANDS.filter(c => c !== 'thesis');
    await expect(runMcpServer(missingThesis)).rejects.toThrow(
      /names a non-existent command: thesis/,
    );
  });
});

describe('version', () => {
  it('is pinned to the repository version', () => {
    // check-docs asserts this equals VERSION; the shape is asserted here.
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
