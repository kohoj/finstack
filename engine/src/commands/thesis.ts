import {
  addThreat,
  getAlive,
  getObituaryQueue,
  killThesis as killThesisData,
  loadTheses,
  registerThesis,
  type Thesis,
  transitionThesis,
} from '../data/thesis';
import { FinstackError } from '../errors';
import { THESIS_SCHEMA_DOC, validateThesisInput } from '../schema';
import { readJSONFromStdin } from '../stdin';
import { validateTicker } from '../validation';

const ADD_USAGE =
  'Compose the thesis as JSON and pipe it in: ' +
  "echo '<json>' | finstack thesis add   (see: finstack thesis add --schema)";

const THESIS_STATUSES = ['alive', 'threatened', 'critical', 'reinforced'] as const;
const THREAT_CONFIDENCE = ['high', 'moderate', 'low'] as const;

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

export function formatThesisList(theses: Thesis[]): any[] {
  return theses.map(t => {
    const pendingCount = t.conditions.filter(c => c.status === 'pending').length;
    const failedCount = t.conditions.filter(c => c.status === 'failed').length;
    const condSummary =
      failedCount > 0
        ? `${failedCount} failed, ${pendingCount} pending`
        : `${pendingCount} pending`;

    return {
      id: t.id,
      ticker: t.ticker,
      thesis: t.thesis,
      status: t.status.toUpperCase(),
      conditions: condSummary,
      since: t.createdAt.split('T')[0],
      obituaryDue: t.obituaryDueDate || null,
    };
  });
}

export function formatThesisHistory(theses: Thesis[]) {
  const alive = theses.filter(t => t.status !== 'dead').length;
  const dead = theses.filter(t => t.status === 'dead').length;
  const threatened = theses.filter(t => t.status === 'threatened').length;

  const deadTheses = theses.filter(t => t.status === 'dead');
  const causeOfDeath: Record<string, number> = {};
  for (const t of deadTheses) {
    const lastChange = t.statusHistory[t.statusHistory.length - 1];
    const cause = lastChange?.reason || 'unknown';
    causeOfDeath[cause] = (causeOfDeath[cause] || 0) + 1;
  }

  const lifespans = deadTheses.map(t => {
    const created = new Date(t.createdAt).getTime();
    const died = new Date(
      t.statusHistory[t.statusHistory.length - 1]?.date || t.createdAt,
    ).getTime();
    return Math.ceil((died - created) / 86400000);
  });
  const avgLifespan =
    lifespans.length > 0 ? Math.round(lifespans.reduce((s, l) => s + l, 0) / lifespans.length) : 0;

  return {
    total: theses.length,
    alive,
    dead,
    threatened,
    causeOfDeath,
    avgLifespanDays: avgLifespan,
    obituariesPending: getObituaryQueue().length,
  };
}

export async function thesis(args: string[]) {
  const sub = args[0] || 'list';

  switch (sub) {
    case 'add': {
      // The shape is long enough that a model should be able to ask for it
      // rather than guess.
      if (args.includes('--schema')) {
        console.log(THESIS_SCHEMA_DOC);
        break;
      }

      // Composed by /judge from the adversarial exchange, so it arrives on
      // stdin rather than as flags — the content is prose, not parameters.
      const raw = await readJSONFromStdin('thesis', ADD_USAGE);
      const input = validateThesisInput(raw);
      const created = registerThesis(input);

      console.log(JSON.stringify(created, null, 2));
      break;
    }

    case 'threaten': {
      // /sense calls this when news challenges a condition. Separate from
      // `transition` because a threat is evidence, and evidence accumulates —
      // three independent sources is a different signal from one.
      const id = args[1];
      const conditionId = parseFlag(args, '--condition');
      const source = parseFlag(args, '--source');
      const reasoning = parseFlag(args, '--reasoning');
      const confidence = parseFlag(args, '--confidence') || 'moderate';

      if (!id || !conditionId || !source || !reasoning) {
        throw new FinstackError(
          'Usage: finstack thesis threaten <id> --condition <cid> --source <where> --reasoning <why> [--confidence high|moderate|low]',
          undefined,
          'A threat needs the thesis, the condition it challenges, where it came from, and why it counts',
          'Run `finstack thesis list` to see thesis and condition ids',
        );
      }

      if (!(THREAT_CONFIDENCE as readonly string[]).includes(confidence)) {
        throw new FinstackError(
          `Invalid confidence: ${confidence}`,
          undefined,
          `Must be one of ${THREAT_CONFIDENCE.join(', ')}`,
          'Example: --confidence moderate',
        );
      }

      const store = loadTheses();
      const target = store.theses.find(t => t.id === id);
      if (!target) {
        throw new FinstackError(
          `Thesis ${id} not found`,
          undefined,
          'No thesis with that id exists',
          'Run `finstack thesis list` to see ids',
        );
      }

      const cond = target.conditions.find(c => c.id === conditionId);
      if (!cond) {
        throw new FinstackError(
          `Condition ${conditionId} not found on thesis ${id}`,
          undefined,
          `That thesis has: ${target.conditions.map(c => c.id).join(', ')}`,
          'Run `finstack thesis list` to see condition ids',
        );
      }
      if (cond.type !== 'event') {
        throw new FinstackError(
          `Condition ${conditionId} is an earnings condition`,
          undefined,
          'Threats attach to event conditions; earnings conditions resolve against a reported number',
          'Wait for the earnings release, or attach the threat to an event condition',
        );
      }

      addThreat(id, conditionId, {
        date: new Date().toISOString().split('T')[0],
        source,
        confidence: confidence as (typeof THREAT_CONFIDENCE)[number],
        reasoning,
      });

      // A threatened thesis is not a dead one. /sense flags; only the user kills.
      if (target.status === 'alive') {
        transitionThesis(id, 'threatened', `Threat from ${source}`);
      }

      const updated = loadTheses().theses.find(t => t.id === id);
      console.log(JSON.stringify(updated, null, 2));
      break;
    }

    case 'transition': {
      const id = args[1];
      const to = args[2];
      const reason = args.slice(3).join(' ');

      if (!id || !to || !reason) {
        throw new FinstackError(
          'Usage: finstack thesis transition <id> <status> <reason>',
          undefined,
          `Status must be one of ${THESIS_STATUSES.join(', ')}`,
          'To mark a thesis dead use `finstack thesis kill` — that also schedules the obituary',
        );
      }

      if (!(THESIS_STATUSES as readonly string[]).includes(to)) {
        throw new FinstackError(
          `Invalid status: ${to}`,
          undefined,
          `Must be one of ${THESIS_STATUSES.join(', ')}`,
          'Use `finstack thesis kill <id> <reason>` to mark one dead',
        );
      }

      const store = loadTheses();
      if (!store.theses.find(t => t.id === id)) {
        throw new FinstackError(
          `Thesis ${id} not found`,
          undefined,
          'No thesis with that id exists',
          'Run `finstack thesis list` to see ids',
        );
      }

      transitionThesis(id, to as (typeof THESIS_STATUSES)[number], reason);

      const updated = loadTheses().theses.find(t => t.id === id);
      console.log(JSON.stringify(updated, null, 2));
      break;
    }

    case 'list': {
      const all = loadTheses();
      const output = formatThesisList(all.theses);
      console.log(JSON.stringify(output, null, 2));
      break;
    }

    case 'check': {
      // Optional filter — validate only when supplied.
      const ticker = args[1] ? validateTicker(args[1]) : undefined;
      const alive = getAlive();
      const filtered = ticker ? alive.filter(t => t.ticker === ticker) : alive;
      const withEarnings = filtered.filter(t =>
        t.conditions.some(c => c.type === 'earnings' && c.status === 'pending'),
      );
      console.log(
        JSON.stringify(
          {
            message: `${withEarnings.length} theses with pending earnings conditions`,
            theses: formatThesisList(withEarnings),
          },
          null,
          2,
        ),
      );
      break;
    }

    case 'kill': {
      const id = args[1];
      const reason = args.slice(2).join(' ') || 'Manual kill';
      if (!id) {
        throw new FinstackError(
          'Usage: finstack thesis kill <id> <reason>',
          undefined,
          'No thesis id provided',
          'Run `finstack thesis list` to see ids',
        );
      }
      const store = loadTheses();
      if (!store.theses.find(t => t.id === id)) {
        throw new FinstackError(
          `Thesis ${id} not found`,
          undefined,
          'No thesis with that id exists',
          'Run `finstack thesis list` to see active theses',
        );
      }
      killThesisData(id, reason);
      console.log(JSON.stringify({ message: `Thesis ${id} killed: ${reason}` }));
      break;
    }

    case 'history': {
      const all = loadTheses();
      const summary = formatThesisHistory(all.theses);
      console.log(JSON.stringify(summary, null, 2));
      break;
    }

    default:
      throw new FinstackError(
        sub
          ? `Unknown subcommand: ${sub}`
          : 'Usage: finstack thesis add|list|check|threaten|transition|kill|history',
        undefined,
        undefined,
        'Use add|list|check|threaten|transition|kill|history',
      );
  }
}
