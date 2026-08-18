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
 *   review/SKILL.md's preamble had silently diverged from the other eight
 *   review/SKILL.md lost the guidance around its Learnings sections
 *
 * A check is only worth adding if it would have caught a real mistake. Prose
 * that cannot go stale is not checked.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const CLI_FILE = join(ROOT, 'engine', 'src', 'cli.ts');
const PATHS_FILE = join(ROOT, 'engine', 'src', 'paths.ts');
const MCP_SERVER_FILE = join(ROOT, 'engine', 'src', 'mcp', 'server.ts');
const SKILLS_DIR = join(ROOT, 'skills');
const PLUGIN_MANIFEST = join(ROOT, '.codex-plugin', 'plugin.json');

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

/**
 * State filenames (`*.json` / `*.jsonl` / `*.yaml`) named inside a doc's
 * `~/.finstack/` layout block. Caught `config.yaml`, a file no code ever read.
 *
 * Scoped to the fenced block that opens with `~/.finstack/` so a filename
 * mentioned in ordinary prose is not mistaken for a claimed state file.
 */
export function extractDocumentedStateFiles(doc: string): string[] {
  const files = new Set<string>();
  for (const block of doc.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
    if (!block[1].includes('~/.finstack/')) continue;
    for (const m of block[1].matchAll(/([\w.-]+\.(?:jsonl?|yaml|yml))/g)) {
      files.add(m[1]);
    }
  }
  return [...files].sort();
}

/** State filenames the engine actually reads or writes, drawn from source. */
export function extractRealStateFiles(...sources: string[]): string[] {
  const files = new Set<string>();
  for (const src of sources) {
    for (const m of src.matchAll(/join\([^,]+,\s*['"]([\w.-]+\.(?:jsonl?|yaml|yml))['"]\)/g)) {
      files.add(m[1]);
    }
  }
  return [...files].sort();
}

/** The `SERVER_VERSION` string the MCP server reports to the plugin host. */
export function extractMcpServerVersion(src: string): string | null {
  const m = src.match(/SERVER_VERSION\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

// ── Checks ──────────────────────────────────────────────────────────────────

function readVersion(): string {
  return readFileSync(join(ROOT, 'VERSION'), 'utf-8').trim();
}

function readSkill(name: string): string | null {
  const file = join(SKILLS_DIR, name, 'SKILL.md');
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

  // 5. The plugin manifest agrees with what is on disk.
  //
  //    Codex reads .codex-plugin/plugin.json to find the skills. A skill that
  //    exists but sits outside the declared directory is invisible to the
  //    host — it simply never fires, with no error anywhere.
  if (existsSync(PLUGIN_MANIFEST)) {
    const manifest = JSON.parse(readFileSync(PLUGIN_MANIFEST, 'utf-8'));

    results.push({
      check: 'plugin.json version matches VERSION',
      pass: manifest.version === readVersion(),
      details:
        manifest.version !== readVersion()
          ? `Manifest says ${manifest.version}, VERSION says ${readVersion()}`
          : undefined,
    });

    // The manifest points at a directory; every skill must live under it.
    const declared = String(manifest.skills ?? '')
      .replace(/^\.\//, '')
      .replace(/\/$/, '');
    results.push({
      check: 'plugin.json points at the skills directory',
      pass: declared === 'skills',
      details: declared !== 'skills' ? `Manifest declares "${manifest.skills}"` : undefined,
    });

    // defaultPrompt is the first thing a new user sees on the install screen.
    // An entry naming a skill that does not exist would be a dead end.
    const prompts: string[] = manifest.interface?.defaultPrompt ?? [];
    results.push({
      check: 'plugin.json has starter prompts',
      pass: prompts.length > 0,
      details: prompts.length === 0 ? 'interface.defaultPrompt is empty' : undefined,
    });
  }

  // 6. Every skill shares one preamble.
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

  // 7. Every skill carries the shared scaffolding.
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

  // 8. Every state file the docs draw in the ~/.finstack/ tree is a file the
  //    engine actually touches. Caught config.yaml — documented for two
  //    releases, read by nothing — and would catch a newly-added state file
  //    (equity.json) that the layout diagrams forgot to mention going the other
  //    way is left to reviewers; a phantom file is the misleading direction.
  {
    const pathsSrc = existsSync(PATHS_FILE) ? readFileSync(PATHS_FILE, 'utf-8') : '';
    const learningsSrc = existsSync(join(ROOT, 'engine', 'src', 'data', 'learnings.ts'))
      ? readFileSync(join(ROOT, 'engine', 'src', 'data', 'learnings.ts'), 'utf-8')
      : '';
    const sessionSrc = existsSync(join(ROOT, 'engine', 'src', 'session.ts'))
      ? readFileSync(join(ROOT, 'engine', 'src', 'session.ts'), 'utf-8')
      : '';
    const real = extractRealStateFiles(pathsSrc, learningsSrc, sessionSrc);

    for (const doc of ['ARCHITECTURE.md', 'README.md']) {
      const content = readDoc(doc);
      if (!content) continue;
      const phantom = extractDocumentedStateFiles(content).filter(f => !real.includes(f));
      results.push({
        check: `${doc} state files exist in code`,
        pass: phantom.length === 0,
        details:
          phantom.length > 0
            ? `Documented but never read/written: ${phantom.join(', ')}`
            : undefined,
      });
    }
  }

  // 9. The MCP server reports the repository version to the plugin host.
  //    serverInfo.version is baked into the compiled binary as a literal (the
  //    engine has no runtime access to package.json), so it can silently lag a
  //    release. A client keying behavior off the version would then be misled.
  {
    const src = existsSync(MCP_SERVER_FILE) ? readFileSync(MCP_SERVER_FILE, 'utf-8') : '';
    const declared = extractMcpServerVersion(src);
    const version = readVersion();
    results.push({
      check: 'MCP server version matches VERSION',
      pass: declared === version,
      details:
        declared !== version
          ? `mcp/server.ts SERVER_VERSION is ${declared ?? '(absent)'}, VERSION says ${version}`
          : undefined,
    });
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
