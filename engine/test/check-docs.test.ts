/**
 * Tests for the documentation checker.
 *
 * The checker is what keeps the docs honest, so it needs to be trustworthy in
 * both directions: it must catch the drift it claims to catch, and it must not
 * cry wolf. A checker that reports false failures gets disabled, and then
 * nothing is checked at all.
 *
 * Each case is built from a fixture rather than the real repo, so these stay
 * meaningful as the real files change.
 */
import { describe, expect, it } from 'bun:test';
import {
  extractCLICommands,
  extractCommandCountClaims,
  extractHelpCommands,
  extractPreamble,
  extractSkillCountClaims,
  extractSkillEngineRefs,
  extractSkillReferences,
  runChecks,
  SKILLS,
} from '../../scripts/check-docs';

const SAMPLE_CLI = `
const commands: Record<string, (args: string[]) => Promise<void>> = {
  quote,
  financials,
  scan,
  review: reviewCmd,
};

console.log(\`Commands:
  quote <ticker>                         Price snapshot
  financials <ticker>                    Financial data
  scan [--source trending]               Signal scanning
  review [--period P]                    Periodic review

Data: ~/.finstack/
\`);
`;

describe('extractCLICommands', () => {
  it('extracts plain registrations', () => {
    expect(extractCLICommands(SAMPLE_CLI)).toContain('quote');
  });

  it('extracts aliased registrations', () => {
    // `review: reviewCmd` registers the command as `review`.
    expect(extractCLICommands(SAMPLE_CLI)).toContain('review');
    expect(extractCLICommands(SAMPLE_CLI)).not.toContain('reviewCmd');
  });

  it('returns an empty list when the block is missing', () => {
    expect(extractCLICommands('const other = {}')).toEqual([]);
  });
});

describe('extractHelpCommands', () => {
  it('extracts the documented commands', () => {
    const cmds = extractHelpCommands(SAMPLE_CLI);
    expect(cmds).toEqual(['financials', 'quote', 'review', 'scan']);
  });

  it('stops at the Data section', () => {
    expect(extractHelpCommands(SAMPLE_CLI)).not.toContain('Data');
  });
});

describe('extractCommandCountClaims', () => {
  it('finds a bare count', () => {
    expect(extractCommandCountClaims('dispatches to 23 commands:')).toEqual([23]);
  });

  it('finds the "engine commands" phrasing', () => {
    expect(extractCommandCountClaims('9 skills, 25 engine commands, 7 sources')).toEqual([25]);
  });

  it('finds every claim in a document', () => {
    expect(extractCommandCountClaims('15 commands here and 23 commands there')).toEqual([15, 23]);
  });

  it('ignores unrelated numbers', () => {
    expect(extractCommandCountClaims('7 data sources, 179 tests')).toEqual([]);
  });
});

describe('extractSkillCountClaims', () => {
  it('finds a skill count', () => {
    expect(extractSkillCountClaims('Nine skills are available. 9 skills total.')).toEqual([9]);
  });
});

describe('extractPreamble', () => {
  it('extracts executable lines only', () => {
    const md = '```bash\n# a comment\nF="$_SK/bin"\n\necho hi\n```';
    expect(extractPreamble(md)).toBe('F="$_SK/bin"\necho hi');
  });

  it('treats two blocks differing only in comments as identical', () => {
    const a = '```bash\n# comment one\nF="x"\n```';
    const b = '```bash\nF="x"\n```';
    // A comment tweak is cosmetic; only behavior should fail the check.
    expect(extractPreamble(a)).toBe(extractPreamble(b) as string);
  });

  it('detects a real divergence', () => {
    const a = '```bash\nF="x"\n```';
    const b = '```bash\nF="y"\n```';
    expect(extractPreamble(a)).not.toBe(extractPreamble(b) as string);
  });

  it('returns null when there is no bash block', () => {
    expect(extractPreamble('# No code here')).toBeNull();
  });
});

describe('extractSkillEngineRefs', () => {
  it('extracts $F command references', () => {
    const md = 'Run `$F quote NVDA` then `$F portfolio show`.';
    expect(extractSkillEngineRefs(md)).toEqual(['portfolio', 'quote']);
  });

  it('deduplicates', () => {
    expect(extractSkillEngineRefs('$F quote A and $F quote B')).toEqual(['quote']);
  });
});

describe('extractSkillReferences', () => {
  it('extracts references to other skills', () => {
    const md = '---\nname: judge\n---\n\nNext: /act to size the position, or /cascade to trace.';
    expect(extractSkillReferences(md, 'judge')).toEqual(['act', 'cascade']);
  });

  it('excludes self-references', () => {
    const md = '---\nname: judge\n---\n\nRe-run /judge later.';
    expect(extractSkillReferences(md, 'judge')).toEqual([]);
  });

  it('ignores paths that look like skill references', () => {
    const md = '---\nname: sense\n---\n\nWrite to /tmp/output and /usr/local.';
    expect(extractSkillReferences(md, 'sense')).toEqual([]);
  });
});

describe('runChecks', () => {
  // The checker runs against the real repo, so these assert the contract
  // rather than specific counts, which change as checks are added.
  it('reports a result for every check', () => {
    const results = runChecks();
    expect(results.length).toBeGreaterThan(20);
    expect(results.every(r => typeof r.check === 'string' && r.check.length > 0)).toBe(true);
    expect(results.every(r => typeof r.pass === 'boolean')).toBe(true);
  });

  it('passes against the current repo', () => {
    // If this fails, the docs have drifted — fix the docs, not this test.
    const failures = runChecks().filter(r => !r.pass);
    expect(failures.map(f => `${f.check}: ${f.details ?? ''}`)).toEqual([]);
  });

  it('covers every skill', () => {
    const results = runChecks();
    for (const skill of SKILLS) {
      expect(results.some(r => r.check.includes(`/${skill}`))).toBe(true);
    }
  });
});
