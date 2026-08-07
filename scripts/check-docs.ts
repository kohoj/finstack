#!/usr/bin/env bun
/**
 * Documentation freshness checks.
 *
 * Run: bun run check:docs   (exit 0 fresh, exit 1 stale)
 *
 * Docs drift because nothing forces them to keep up. The fix is not to write
 * more carefully — it is to make each drift-prone claim machine-checkable, so
 * CI fails instead of a reader being misled months later.
 *
 * Every check here exists because something had actually drifted:
 *
 *   ARCHITECTURE.md said "15 commands"      (there were 23)
 *   CHANGELOG.md said "25 engine commands"  (there were 23)
 *   ARCHITECTURE.md listed 7 skills         (there were 9)
 *   act/SKILL.md used Glob without declaring it in allowed-tools
 *   sense, research, reflect declared Agent and never spawned one
 *   review/SKILL.md's preamble had silently diverged from the other eight
 *
 * A check is only worth adding if it would have caught a real mistake. Prose
 * that cannot go stale is not checked.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const CLI_FILE = join(ROOT, 'engine', 'src', 'cli.ts');
const SETUP_FILE = join(ROOT, 'setup');

/** Skills, in the canonical order used by setup and the docs. */
export const SKILLS = [
  'sense',
  'research',
  'judge',
  'act',
  'cascade',
  'track',
  'reflect',
  'screen',
  'review',
] as const;

export interface CheckResult {
  check: string;
  pass: boolean;
  details?: string;
}

// ── Extraction ──────────────────────────────────────────────────────────────

export function extractCLICommands(cliSource: string): string[] {
  const commandsMatch = cliSource.match(/const commands[^{]*\{([^}]+)\}/s);
  if (!commandsMatch) return [];

  const block = commandsMatch[1];
  const commands: string[] = [];
  for (const m of block.matchAll(/^\s*(\w+)(?::|\s*,)/gm)) {
    commands.push(m[1]);
  }
  return commands.sort();
}

export function extractHelpCommands(cliSource: string): string[] {
  const helpMatch = cliSource.match(/Commands:\n([\s\S]*?)(?:\n\nData:|$)/);
  if (!helpMatch) return [];

  const commands: string[] = [];
  for (const line of helpMatch[1].split('\n')) {
    const m = line.match(/^\s+(\w+)/);
    if (m) commands.push(m[1]);
  }
  return commands.sort();
}

/** `$F <command>` references inside a SKILL.md. */
export function extractSkillEngineRefs(content: string): string[] {
  const refs = new Set<string>();
  for (const m of content.matchAll(/\$F\s+(\w+)/g)) {
    refs.add(m[1]);
  }
  return [...refs].sort();
}

/** Claims like "23 commands" or "25 engine commands" in prose. */
export function extractCommandCountClaims(doc: string): number[] {
  const counts: number[] = [];
  for (const m of doc.matchAll(/(\d+)\s+(?:engine\s+)?commands/gi)) {
    counts.push(Number(m[1]));
  }
  return counts;
}

/** Claims like "9 skills". */
export function extractSkillCountClaims(doc: string): number[] {
  const counts: number[] = [];
  for (const m of doc.matchAll(/(\d+)\s+skills/gi)) {
    counts.push(Number(m[1]));
  }
  return counts;
}

/** The allowed-tools list from a SKILL.md YAML frontmatter. */
export function extractAllowedTools(content: string): string[] {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return [];

  const block = fm[1].match(/allowed-tools:\s*\n((?:\s*-\s*\w+\s*\n?)+)/);
  if (!block) return [];

  const tools: string[] = [];
  for (const m of block[1].matchAll(/-\s*(\w+)/g)) {
    tools.push(m[1]);
  }
  return tools.sort();
}

/**
 * Tools a skill's body actually needs.
 *
 * Skills are prose, so a tool can be required without ever being named — a
 * step that says "look up the current price" needs WebSearch, and one that
 * reads `~/.finstack/journal/*<ticker>*` needs Glob. Matching only on the
 * literal tool name would report those as unused and push authors to delete a
 * declaration the skill depends on at runtime.
 *
 * So each tool has two kinds of evidence: the explicit name, and the phrasing
 * that implies it. False negatives here are worse than false positives — a
 * missing declaration fails at runtime, while a spare one is harmless.
 */
export function extractUsedTools(content: string): string[] {
  const body = content
    .replace(/^---\n[\s\S]*?\n---/, '')
    // Drop negated instructions before matching. research/SKILL.md says
    // "don't ask the user who the peers are" — evidence that the skill does
    // NOT need AskUserQuestion, which a naive match reads as the opposite.
    .replace(/\b(?:do ?n[o']t|never|rather than|instead of|without)\b[^.\n]*/gi, '');
  const used = new Set<string>();

  const evidence: Record<string, RegExp[]> = {
    // Explicit, or any instruction to read a glob-shaped path.
    Glob: [/\bGlob\b/, /~\/\.finstack\/\w+\/\*/, /\bjournal\/\*/],
    Grep: [/\bGrep\b/, /\bsearch (?:through|across) (?:the )?journal/i],
    // Spawning subagents — named directly or described.
    Agent: [/\bAgent\b/, /\bspawn\b[^.\n]*\bagent/i, /\bdeploy\b[^.\n]*\bagent/i],
    TaskCreate: [/\bTaskCreate\b/],
    TaskUpdate: [/\bTaskUpdate\b/],
    // Any instruction to consult the user counts.
    AskUserQuestion: [/\bAskUserQuestion\b/, /\bask the user\b/i, /\bask them\b/i],
    // Any instruction to consult the web counts.
    WebSearch: [/\bWebSearch\b/, /\bsearch the web\b/i, /\blook up\b[^.\n]*\b(price|news|filing)/i],
    WebFetch: [/\bWebFetch\b/, /\bfetch\b[^.\n]*\b(article|page|url)/i],
  };

  for (const [tool, patterns] of Object.entries(evidence)) {
    if (patterns.some(re => re.test(body))) used.add(tool);
  }

  // Bash, Read, and Write are used by every skill via the preamble and the
  // journal deposit, so asserting on them would be noise.
  return [...used].sort();
}

/** The bash preamble block, normalized for comparison. */
export function extractPreamble(content: string): string | null {
  const m = content.match(/```bash\n([\s\S]*?)```/);
  if (!m) return null;
  // Comments and blank lines are cosmetic; the executable lines are the
  // contract. Compare those so a comment tweak is not a failure, but a
  // behavioral divergence is.
  return m[1]
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .join('\n');
}

/** `/skill` references in a skill's body — the transition graph edges. */
export function extractSkillReferences(content: string, self: string): string[] {
  const body = content.replace(/^---\n[\s\S]*?\n---/, '');
  const refs = new Set<string>();
  for (const m of body.matchAll(/\/(\w+)/g)) {
    const name = m[1];
    if (name !== self && (SKILLS as readonly string[]).includes(name)) {
      refs.add(name);
    }
  }
  return [...refs].sort();
}

/** Skill names registered in the setup script's SKILLS array. */
export function extractSetupSkills(setupSource: string): string[] {
  const m = setupSource.match(/SKILLS=\(([^)]+)\)/);
  if (!m) return [];
  return m[1].trim().split(/\s+/).sort();
}

// ── Checks ──────────────────────────────────────────────────────────────────

function readSkill(name: string): string | null {
  const file = join(ROOT, name, 'SKILL.md');
  return existsSync(file) ? readFileSync(file, 'utf-8') : null;
}

function readDoc(name: string): string | null {
  const file = join(ROOT, name);
  return existsSync(file) ? readFileSync(file, 'utf-8') : null;
}

export function runChecks(): CheckResult[] {
  const results: CheckResult[] = [];
  const cliSource = existsSync(CLI_FILE) ? readFileSync(CLI_FILE, 'utf-8') : '';
  const registered = extractCLICommands(cliSource);

  // 1. Registered commands match the help text.
  {
    const help = extractHelpCommands(cliSource);
    const missing = registered.filter(c => !help.includes(c));
    const extra = help.filter(c => !registered.includes(c));
    results.push({
      check: 'CLI commands match help text',
      pass: missing.length === 0 && extra.length === 0,
      details:
        missing.length > 0
          ? `Registered but undocumented: ${missing.join(', ')}`
          : extra.length > 0
            ? `In help but not registered: ${extra.join(', ')}`
            : undefined,
    });
  }

  // 2. Every $F reference in a skill names a real command.
  for (const skill of SKILLS) {
    const content = readSkill(skill);
    if (!content) continue;
    const invalid = extractSkillEngineRefs(content).filter(r => !registered.includes(r));
    results.push({
      check: `/${skill} references valid commands`,
      pass: invalid.length === 0,
      details: invalid.length > 0 ? `Unknown commands: ${invalid.join(', ')}` : undefined,
    });
  }

  // 3. Command counts stated in prose match reality.
  //    Caught "15 commands" in ARCHITECTURE.md.
  //
  //    CHANGELOG.md is excluded: it is a historical record. "25 engine
  //    commands" was what v0.6.0 shipped with (miscounted at the time, but
  //    still a statement about the past). Rewriting released entries to match
  //    the present would defeat the point of a changelog.
  for (const doc of ['ARCHITECTURE.md', 'README.md', 'CONTRIBUTING.md']) {
    const content = readDoc(doc);
    if (!content) continue;
    const claims = extractCommandCountClaims(content);
    const wrong = claims.filter(n => n !== registered.length);
    results.push({
      check: `${doc} states the correct command count`,
      pass: wrong.length === 0,
      details:
        wrong.length > 0
          ? `Claims ${wrong.join(', ')} but ${registered.length} are registered`
          : undefined,
    });
  }

  // 4. Skill counts stated in prose match the number of SKILL.md files.
  const presentSkills = SKILLS.filter(s => readSkill(s) !== null);
  for (const doc of ['ARCHITECTURE.md', 'README.md']) {
    const content = readDoc(doc);
    if (!content) continue;
    const wrong = extractSkillCountClaims(content).filter(n => n !== presentSkills.length);
    results.push({
      check: `${doc} states the correct skill count`,
      pass: wrong.length === 0,
      details:
        wrong.length > 0
          ? `Claims ${wrong.join(', ')} but ${presentSkills.length} skills exist`
          : undefined,
    });
  }

  // 5. setup registers exactly the skills that exist.
  if (existsSync(SETUP_FILE)) {
    const inSetup = extractSetupSkills(readFileSync(SETUP_FILE, 'utf-8'));
    const missing = presentSkills.filter(s => !inSetup.includes(s));
    const extra = inSetup.filter(s => !(presentSkills as readonly string[]).includes(s));
    results.push({
      check: 'setup registers every skill',
      pass: missing.length === 0 && extra.length === 0,
      details:
        missing.length > 0
          ? `SKILL.md exists but not in setup: ${missing.join(', ')}`
          : extra.length > 0
            ? `In setup but no SKILL.md: ${extra.join(', ')}`
            : undefined,
    });
  }

  // 6. allowed-tools covers what the body does.
  //
  //    Only under-declaration fails. A tool a skill uses but does not declare
  //    is unavailable at runtime, so the step silently does not happen —
  //    act/SKILL.md instructed a Glob over the journal without declaring Glob.
  //
  //    Over-declaration is reported but does not fail: the detector infers
  //    intent from prose, so it cannot be certain a declaration is dead, and
  //    the cost of a spare entry is zero while the cost of a wrong deletion is
  //    a broken skill.
  for (const skill of presentSkills) {
    const content = readSkill(skill) as string;
    const declared = extractAllowedTools(content);
    const used = extractUsedTools(content);

    const undeclared = used.filter(t => !declared.includes(t));
    const unused = declared.filter(
      t => !['Bash', 'Read', 'Write'].includes(t) && !used.includes(t),
    );

    results.push({
      check: `/${skill} declares the tools it uses`,
      pass: undeclared.length === 0,
      details:
        undeclared.length > 0
          ? `Used but not declared: ${undeclared.join(', ')}`
          : unused.length > 0
            ? `note: declared but no usage detected: ${unused.join(', ')}`
            : undefined,
    });
  }

  // 7. Every skill shares one preamble.
  //    Nine copies of the same 19 lines, so a fix to one silently leaves eight
  //    behind. SKILL.md has no include mechanism, so this is enforced instead.
  {
    const baseline = readSkill('sense');
    const basePreamble = baseline ? extractPreamble(baseline) : null;
    const diverged: string[] = [];

    if (basePreamble) {
      for (const skill of presentSkills) {
        if (skill === 'sense') continue;
        const content = readSkill(skill) as string;
        if (extractPreamble(content) !== basePreamble) diverged.push(skill);
      }
    }

    results.push({
      check: 'skill preambles are identical',
      pass: basePreamble !== null && diverged.length === 0,
      details:
        basePreamble === null
          ? 'No preamble found in sense/SKILL.md'
          : diverged.length > 0
            ? `Diverged from sense: ${diverged.join(', ')}`
            : undefined,
    });
  }

  // 8. Every skill carries the shared scaffolding.
  //
  //    review/SKILL.md had both its Learnings Context and Learning Deposit
  //    sections reduced to a bare code block, dropping the guidance that tells
  //    the model what to do with the loaded learnings and what is worth
  //    depositing. Nothing failed — the skill just quietly did less than the
  //    other eight.
  {
    const required = [
      { section: '## Learnings Context', marker: 'learn search' },
      { section: '## Learning Deposit', marker: 'learn add' },
    ];

    for (const skill of presentSkills) {
      const content = readSkill(skill) as string;
      const missing: string[] = [];

      for (const { section, marker } of required) {
        const idx = content.indexOf(section);
        if (idx === -1) {
          missing.push(`${section} (absent)`);
          continue;
        }
        // Take the section body up to the next heading.
        const rest = content.slice(idx + section.length);
        const end = rest.indexOf('\n## ');
        const body = end === -1 ? rest : rest.slice(0, end);

        if (!body.includes(marker)) {
          missing.push(`${section} (no ${marker})`);
        } else if (body.replace(/```[\s\S]*?```/g, '').trim().length < 80) {
          // Code block only, no surrounding guidance.
          missing.push(`${section} (truncated to a bare code block)`);
        }
      }

      results.push({
        check: `/${skill} has the shared scaffolding`,
        pass: missing.length === 0,
        details: missing.length > 0 ? missing.join('; ') : undefined,
      });
    }
  }

  return results;
}

if (import.meta.main) {
  const results = runChecks();
  const failures = results.filter(r => !r.pass);

  for (const r of results) {
    console.log(`${r.pass ? '✓' : '✗'} ${r.check}`);
    if (r.details) console.log(`  ${r.details}`);
  }

  console.log(`\n${results.length - failures.length}/${results.length} checks passed.`);

  if (failures.length > 0) {
    console.log('Documentation is stale. Fix the issues above.');
    process.exit(1);
  }
}
