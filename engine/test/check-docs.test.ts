import { describe, it, expect } from 'bun:test';
import { extractCLICommands, extractHelpCommands } from '../../scripts/check-docs';

const SAMPLE_CLI = `
const commands: Record<string, (args: string[]) => Promise<void>> = {
  quote,
  financials,
  scan,
  watchlist,
  alerts,
};

console.log(\`Commands:
  quote <ticker>                         Price snapshot
  financials <ticker>                    Financial data
  scan [--source trending]               Signal scanning
  watchlist [add|remove]                 Watchlist management
  alerts [--due N]                       Check alerts

Data: ~/.finstack/
\`);
`;

describe('extractCLICommands', () => {
  it('extracts registered commands', () => {
    const cmds = extractCLICommands(SAMPLE_CLI);
    expect(cmds).toContain('quote');
    expect(cmds).toContain('financials');
    expect(cmds).toContain('scan');
    expect(cmds).toContain('watchlist');
    expect(cmds).toContain('alerts');
  });
});

describe('extractHelpCommands', () => {
  it('extracts help text commands', () => {
    const cmds = extractHelpCommands(SAMPLE_CLI);
    expect(cmds).toContain('quote');
    expect(cmds).toContain('financials');
    expect(cmds).toContain('scan');
    expect(cmds).toContain('watchlist');
    expect(cmds).toContain('alerts');
  });
});
