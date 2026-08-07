// engine/src/commands/shadow.ts
//
// The shadow portfolio: what the account would hold if every /act plan were
// followed exactly. Comparing it against the real portfolio is what separates
// analytical skill from execution — see ARCHITECTURE.md#the-shadow-portfolio-loop.
//
// Entries are composed by /act and arrive on stdin, because a staged plan
// carries a rationale for every tranche, stop, and target. That reasoning is
// the content; it cannot be passed as flags.

import { closeEntry, createEntry, findOpen, loadShadow } from '../data/shadow';
import { FinstackError } from '../errors';
import { SHADOW_SCHEMA_DOC, validateShadowInput } from '../schema';
import { readJSONFromStdin } from '../stdin';
import { validateISODate, validatePositiveNumber, validateTicker } from '../validation';

const ADD_USAGE =
  'Compose the plan as JSON and pipe it in: ' +
  "echo '<json>' | finstack shadow add   (see: finstack shadow add --schema)";

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

export async function shadow(args: string[]) {
  const sub = args[0] || 'show';

  switch (sub) {
    case 'add': {
      if (args.includes('--schema')) {
        console.log(SHADOW_SCHEMA_DOC);
        break;
      }

      const raw = await readJSONFromStdin('shadow entry', ADD_USAGE);
      const input = validateShadowInput(raw);

      // One open entry per ticker. A second would make the alpha comparison
      // ambiguous — which plan was the user deviating from?
      const existing = findOpen(input.ticker);
      if (existing) {
        throw new FinstackError(
          `An open shadow entry already exists for ${input.ticker}`,
          undefined,
          `Entry ${existing.id} was opened on ${existing.entryDate} and is still open`,
          `Close it first: finstack shadow close ${input.ticker} --price <exit> --reason <why>`,
        );
      }

      const created = createEntry(input);
      console.log(JSON.stringify(created, null, 2));
      break;
    }

    case 'close': {
      const ticker = validateTicker(args[1]);
      const priceStr = parseFlag(args, '--price');
      const dateStr = parseFlag(args, '--date');
      const reason = parseFlag(args, '--reason');

      if (!priceStr || !reason) {
        throw new FinstackError(
          'Usage: finstack shadow close <ticker> --price <exit> --reason <why>',
          undefined,
          'Both an exit price and a reason are required',
          'The reason is read by /reflect when judging whether an exit was planned',
        );
      }

      const price = validatePositiveNumber(priceStr, 'price');
      const date = dateStr
        ? validateISODate(dateStr, 'date')
        : new Date().toISOString().split('T')[0];

      const open = findOpen(ticker);
      if (!open) {
        throw new FinstackError(
          `No open shadow entry for ${ticker}`,
          undefined,
          'Nothing to close',
          'Run `finstack shadow show` to see open entries',
        );
      }

      closeEntry(ticker, price, date, reason);

      const updated = loadShadow().entries.find(e => e.id === open.id);
      console.log(JSON.stringify(updated, null, 2));
      break;
    }

    case 'show': {
      const store = loadShadow();
      const openOnly = args.includes('--open');
      const entries = openOnly ? store.entries.filter(e => e.status === 'open') : store.entries;

      console.log(
        JSON.stringify(
          {
            entries,
            count: entries.length,
            open: store.entries.filter(e => e.status === 'open').length,
            closed: store.entries.filter(e => e.status === 'closed').length,
          },
          null,
          2,
        ),
      );
      break;
    }

    default:
      throw new FinstackError(
        sub ? `Unknown subcommand: ${sub}` : 'Usage: finstack shadow add|close|show',
        undefined,
        undefined,
        'Use add|close|show',
      );
  }
}
