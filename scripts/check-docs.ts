#!/usr/bin/env bun
// scripts/check-docs.ts — Validate documentation freshness
// Run: bun run scripts/check-docs.ts
// Exit 0 if docs are fresh, exit 1 if stale

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..');
const CLI_FILE = join(ROOT, 'engine', 'src', 'cli.ts');
const README_FILE = join(ROOT, 'README.md');

interface CheckResult {
  check: string;
  pass: boolean;
  details?: string;
}

export function extractCLICommands(cliSource: string): string[] {
  // Extract command names from the commands object
  const commandsMatch = cliSource.match(/const commands[^{]*\{([^}]+)\}/s);
  if (!commandsMatch) return [];

  const block = commandsMatch[1];
  // Match property names (command registrations)
  // Handles both: "command," and "command: commandFn,"
  const commands: string[] = [];
  const regex = /^\s*(\w+)(?::|\s*,)/gm;
  let match;
  while ((match = regex.exec(block)) !== null) {
    commands.push(match[1]);
  }
  return commands.sort();
}

export function extractHelpCommands(cliSource: string): string[] {
  // Extract commands listed in help text
  const helpMatch = cliSource.match(/Commands:\n([\s\S]*?)(?:\n\nData:|$)/);
  if (!helpMatch) return [];

  const lines = helpMatch[1].split('\n').filter(l => l.trim());
  const commands: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s+(\w+)/);
    if (match) commands.push(match[1]);
  }
  return commands.sort();
}

export function extractREADMECommands(readmeContent: string): string[] {
  // Look for command references in README (finstack <command> patterns)
  const commands = new Set<string>();
  const regex = /finstack\s+(\w+)/g;
  let match;
  while ((match = regex.exec(readmeContent)) !== null) {
    // Filter out non-command words
    const cmd = match[1];
    if (!['help', 'is', 'the', 'an', 'a', 'v0', 'v1'].includes(cmd)) {
      commands.add(cmd);
    }
  }
  return [...commands].sort();
}

export function extractSkillEngineRefs(skillDir: string): { skill: string; refs: string[] }[] {
  const results: { skill: string; refs: string[] }[] = [];
  const skillDirs = ['sense', 'research', 'judge', 'act', 'cascade', 'track', 'reflect', 'screen', 'review'];

  for (const skill of skillDirs) {
    const skillFile = join(ROOT, skill, 'SKILL.md');
    if (!existsSync(skillFile)) continue;

    const content = readFileSync(skillFile, 'utf-8');
    const refs = new Set<string>();
    // Match $F <command> patterns
    const regex = /\$F\s+(\w+)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      refs.add(match[1]);
    }
    if (refs.size > 0) {
      results.push({ skill, refs: [...refs].sort() });
    }
  }

  return results;
}

export function runChecks(): CheckResult[] {
  const results: CheckResult[] = [];

  // Check 1: CLI registered commands match help text
  if (existsSync(CLI_FILE)) {
    const cliSource = readFileSync(CLI_FILE, 'utf-8');
    const registered = extractCLICommands(cliSource);
    const helpCmds = extractHelpCommands(cliSource);

    const missingFromHelp = registered.filter(c => !helpCmds.includes(c));
    const extraInHelp = helpCmds.filter(c => !registered.includes(c));

    results.push({
      check: 'CLI commands match help text',
      pass: missingFromHelp.length === 0 && extraInHelp.length === 0,
      details: missingFromHelp.length > 0
        ? `Registered but not in help: ${missingFromHelp.join(', ')}`
        : extraInHelp.length > 0
          ? `In help but not registered: ${extraInHelp.join(', ')}`
          : undefined,
    });
  }

  // Check 2: SKILL.md $F refs are valid commands
  if (existsSync(CLI_FILE)) {
    const cliSource = readFileSync(CLI_FILE, 'utf-8');
    const registered = extractCLICommands(cliSource);
    const skillRefs = extractSkillEngineRefs(ROOT);

    for (const { skill, refs } of skillRefs) {
      const invalid = refs.filter(r => !registered.includes(r));
      results.push({
        check: `/${skill} SKILL.md references valid commands`,
        pass: invalid.length === 0,
        details: invalid.length > 0 ? `Unknown commands: ${invalid.join(', ')}` : undefined,
      });
    }
  }

  return results;
}

// CLI entry point
if (import.meta.main) {
  const results = runChecks();
  let hasFailures = false;

  for (const r of results) {
    const icon = r.pass ? '✓' : '✗';
    console.log(`${icon} ${r.check}`);
    if (r.details) console.log(`  ${r.details}`);
    if (!r.pass) hasFailures = true;
  }

  if (hasFailures) {
    console.log('\nDocumentation is stale. Fix the issues above.');
    process.exit(1);
  } else {
    console.log('\nAll documentation checks passed.');
  }
}
