// engine/src/stdin.ts
//
// Read JSON from stdin.
//
// The two commands that accept composed state (`thesis add`, `shadow add`)
// take it on stdin rather than as flags. Their content is the output of
// reasoning — a thesis paragraph, a rationale attached to every stop and
// target — and squeezing that through argv would either truncate it or turn
// the skill into a shell-quoting exercise.

import { FinstackError } from './errors';

/**
 * Read all of stdin as text.
 *
 * Returns null when stdin is a TTY — i.e. the command was run interactively
 * with nothing piped in. That is a usage error, not an empty document, and the
 * caller reports it differently.
 */
export async function readStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;

  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Uint8Array);
  }
  if (chunks.length === 0) return null;

  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Read and parse a JSON document from stdin.
 *
 * `what` names the document in error messages, and `usage` shows how to pipe
 * it — both are what a model needs to correct itself on retry.
 */
export async function readJSONFromStdin(what: string, usage: string): Promise<unknown> {
  const raw = await readStdin();

  if (raw === null || raw.trim() === '') {
    throw new FinstackError(
      `No ${what} provided on stdin`,
      undefined,
      'This command reads a JSON document from stdin',
      usage,
    );
  }

  try {
    return JSON.parse(raw);
  } catch (e) {
    // Point at the offending position: a model correcting a long document
    // needs to know where, not just that.
    const message = (e as Error).message;
    const position = message.match(/position (\d+)/)?.[1];
    const near = position
      ? ` near: ...${raw.slice(Math.max(0, Number(position) - 40), Number(position) + 40)}...`
      : '';

    throw new FinstackError(
      `Could not parse ${what} as JSON`,
      undefined,
      `${message}${near}`,
      'Check for a trailing comma, an unquoted key, or an unescaped newline inside a string',
    );
  }
}
