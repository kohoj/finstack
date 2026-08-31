// Local Desk server.
//
// Desk is deliberately served by the engine, not a separate dev server. The
// browser is a second client of the same factual files as the CLI and MCP
// tools; it is not a static report with a different, stale calculation path.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, type FSWatcher, unlinkSync, watch } from 'node:fs';
import { markPortfolioPosition } from '../commands/portfolio';
import { calculateConcentration } from '../commands/risk';
import { estimateImpact, SCENARIOS } from '../commands/scenario';
import { computeDrawdown, loadEquity, recordEquity } from '../data/equity';
import { loadPortfolio, valuePortfolio } from '../data/portfolio';
import { markAgeDays, RISK_POLICY } from '../data/risk-policy';
import { loadShadow } from '../data/shadow';
import { FinstackError } from '../errors';
import { atomicWriteJSON, readJSONSafe } from '../fs';
import { paths } from '../paths';
import { renderDeskApp, renderDeskCss, renderDeskHtml } from './ui';

const DEFAULT_PORT = 41_307;
const MAX_PORT_ATTEMPTS = 32;
const EVENT_BUFFER_SIZE = 200;
const COOKIE_PREFIX = 'finstack_desk_';

export interface DeskConnection {
  port: number;
  url: string;
  startedAt: string;
  version: string;
}

export interface DeskDecisionRequest {
  requestId?: string;
  action_request?: { action: string; args?: Record<string, unknown> };
  config?: {
    allow_accept?: boolean;
    allow_edit?: boolean;
    allow_respond?: boolean;
    allow_ignore?: boolean;
  };
  description: string;
}

export interface DeskDecisionResponse {
  type: 'accept' | 'edit' | 'respond' | 'ignore';
  args?: Record<string, unknown>;
}

interface PendingDecision {
  requestId: string;
  request: DeskDecisionRequest;
  response?: DeskDecisionResponse;
  waiters: Set<{ resolve: (result: unknown) => void; timer: Timer }>;
}

interface DeskEvent {
  id: number;
  event: string;
  data: string;
}

interface DeskClient {
  controller: ReadableStreamDefaultController<Uint8Array>;
  heartbeat: Timer;
}

interface ActiveDesk {
  server: ReturnType<typeof Bun.serve>;
  port: number;
  /** Loopback control secret, kept in the user-only discovery record. */
  token: string;
  /** Browser handoff capabilities are single-use and never become Bearer secrets. */
  launchTokens: Set<string>;
  startedAt: string;
  cookieName: string;
  clients: Set<DeskClient>;
  events: DeskEvent[];
  nextEventId: number;
  pending: Map<string, PendingDecision>;
  watcher: FSWatcher | null;
  debounce: Timer | null;
}

interface DeskDiscovery {
  port: number;
  pid: number;
  token: string;
  startedAt: string;
  version: string;
}

let active: ActiveDesk | null = null;
let starting: Promise<DeskConnection> | null = null;

function version(): string {
  return '0.7.0';
}

function baseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(desk: ActiveDesk): string {
  const payload = `v1:${desk.port}`;
  const signature = createHmac('sha256', desk.token).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function issueLaunchUrl(desk: ActiveDesk): string {
  const launchToken = randomBytes(32).toString('base64url');
  desk.launchTokens.add(launchToken);
  return `${baseUrl(desk.port)}/?token=${launchToken}`;
}

function deskConnection(desk: ActiveDesk): DeskConnection {
  return {
    port: desk.port,
    url: issueLaunchUrl(desk),
    startedAt: desk.startedAt,
    version: version(),
  };
}

function parseCookies(request: Request): Record<string, string> {
  const raw = request.headers.get('cookie') || '';
  return Object.fromEntries(
    raw
      .split(';')
      .map(part => part.trim().split(/=(.*)/s, 2))
      .filter(([name]) => Boolean(name)),
  );
}

function securityHeaders(headers: Headers, desk: ActiveDesk): Headers {
  headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Cache-Control', 'no-store');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('X-Finstack-Desk-Version', version());
  headers.set('X-Finstack-Desk-Port', String(desk.port));
  return headers;
}

function response(desk: ActiveDesk, body: BodyInit | null, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: securityHeaders(new Headers(init.headers), desk),
  });
}

function json(desk: ActiveDesk, body: unknown, status = 200): Response {
  return response(desk, JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function isExactLocalHost(request: Request, desk: ActiveDesk): boolean {
  return request.headers.get('host') === `127.0.0.1:${desk.port}`;
}

function isAuthenticated(request: Request, desk: ActiveDesk): boolean {
  const authorization = request.headers.get('authorization');
  if (
    authorization?.startsWith('Bearer ') &&
    timingSafeStringEqual(authorization.slice(7), desk.token)
  ) {
    return true;
  }
  const value = parseCookies(request)[desk.cookieName];
  return value !== undefined && timingSafeStringEqual(value, cookieValue(desk));
}

function passesCsrf(request: Request, desk: ActiveDesk): boolean {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS')
    return true;
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'same-origin' || fetchSite === 'none') return true;
  // Non-browser or older-browser requests must send an exact origin. A missing
  // signal is not permission to write localhost state.
  return request.headers.get('origin') === baseUrl(desk.port);
}

function deskState(desk: ActiveDesk) {
  const portfolio = loadPortfolio();
  const valuation = valuePortfolio(portfolio);
  const positions = valuation.positions
    .map(position => ({
      ...position,
      weight:
        position.valueBase === null || valuation.totalValueBase === 0
          ? null
          : +((position.valueBase / valuation.totalValueBase) * 100).toFixed(1),
      unrealizedPLNative: +((position.price - position.avgCost) * position.shares).toFixed(2),
      unrealizedPLPct: +((position.price / position.avgCost - 1) * 100).toFixed(2),
    }))
    .sort((left, right) => (right.valueBase ?? -Infinity) - (left.valueBase ?? -Infinity));
  const concentration = calculateConcentration(
    positions.flatMap(position =>
      position.weight === null ? [] : [{ ticker: position.ticker, weight: position.weight }],
    ),
  );
  const equity = loadEquity();
  const drawdown = computeDrawdown(equity);
  const shadow = loadShadow();
  const theses = readJSONSafe<any>(paths.THESES_FILE, { theses: [] });
  const watchlist = readJSONSafe<any[]>(paths.WATCHLIST_FILE, []);
  const stress = ['spy-20pct', 'rates+100bp', 'recession'].map(id => {
    const scenario = SCENARIOS[id];
    const impact = estimateImpact(
      valuation.positions.map(position => ({
        ticker: position.ticker,
        shares: position.shares,
        valueBase: position.valueBase,
        scenarioExposure: position.scenarioExposure,
      })),
      scenario,
    );
    return {
      id,
      name: scenario.name,
      description: scenario.description,
      totalImpact: impact.totalImpact,
      totalImpactPct: impact.totalImpactPct,
      modeledValue: impact.modeledValue,
      unmodeledValue: impact.unmodeledValue,
      coveragePct: impact.coveragePct,
      unmodeledTickers: impact.unmodeledTickers,
      positions: impact.positions,
    };
  });
  const marked = positions.filter(position => position.priceSource === 'mark');
  const oldestMarkedAt =
    marked
      .map(position => position.markedAt)
      .filter((markedAt): markedAt is string => markedAt !== null)
      .sort()[0] ?? null;
  const oldestAgeDays = markAgeDays(oldestMarkedAt);
  const unmodeledTickers = [...new Set(stress.flatMap(item => item.unmodeledTickers))];
  const readiness = {
    hasExplicitValuation: valuation.fullyMarked,
    hasDailyMirror: equity.snapshots.length > 0,
    hasThesis: theses.theses.length > 0,
    hasShadowPlan: shadow.entries.length > 0,
  };
  const attention = [
    ...concentration.warnings.map(message => ({ level: 'warning' as const, message })),
    ...(valuation.costFallbackTickers.length
      ? [
          {
            level: 'warning' as const,
            message: `Needs an explicit price: ${valuation.costFallbackTickers.join(', ')}.`,
          },
        ]
      : []),
    ...(valuation.unvaluedTickers.length
      ? [
          {
            level: 'critical' as const,
            message: `Missing base-currency conversion: ${valuation.unvaluedTickers.join(', ')}.`,
          },
        ]
      : []),
    ...(oldestAgeDays !== null && oldestAgeDays > RISK_POLICY.markFreshnessDays
      ? [
          {
            level: 'warning' as const,
            message: `Oldest explicit mark is ${oldestAgeDays} days old (review threshold: ${RISK_POLICY.markFreshnessDays} day).`,
          },
        ]
      : []),
    ...(unmodeledTickers.length
      ? [
          {
            level: 'critical' as const,
            message: `Directional stress excludes unmodeled holdings: ${unmodeledTickers.join(', ')}. Record an explicit scenario exposure before treating totals as portfolio-wide.`,
          },
        ]
      : []),
  ];

  return {
    version: version(),
    generatedAt: new Date().toISOString(),
    portfolio: {
      baseCurrency: portfolio.baseCurrency,
      totalValueBase: valuation.totalValueBase,
      fullyMarked: valuation.fullyMarked,
      costFallbackTickers: valuation.costFallbackTickers,
      unvaluedTickers: valuation.unvaluedTickers,
      positions,
      concentration: {
        top1: concentration.top1,
        top3: concentration.top3,
        warnings: concentration.warnings,
      },
    },
    mirror: {
      equity: equity.snapshots,
      peak: equity.peak,
      drawdown,
      shadowOpen: shadow.entries.filter(entry => entry.status === 'open').length,
      theses: {
        alive: theses.theses.filter((thesis: any) => thesis.status !== 'dead').length,
        threatened: theses.theses.filter((thesis: any) => thesis.status === 'threatened').length,
      },
    },
    marks: {
      oldestMarkedAt,
      oldestAgeDays,
      reviewThresholdDays: RISK_POLICY.markFreshnessDays,
    },
    stress,
    attention,
    policy: RISK_POLICY,
    readiness,
    watchlist: watchlist.slice(0, 12),
    pendingDecisions: [...desk.pending.values()]
      .filter(decision => !decision.response)
      .map(decision => ({ requestId: decision.requestId, ...decision.request })),
  };
}

function recordDeskSnapshot(desk: ActiveDesk): Response {
  const valuation = valuePortfolio(loadPortfolio());
  if (!valuation.fullyMarked) {
    return json(
      desk,
      {
        error: 'A daily mirror requires explicit prices and FX for every position.',
        costFallbackTickers: valuation.costFallbackTickers,
        unvaluedTickers: valuation.unvaluedTickers,
      },
      409,
    );
  }
  const date = new Date().toISOString().slice(0, 10);
  const history = recordEquity(valuation.totalValueBase, date);
  emitState(desk);
  return json(desk, {
    recorded: { date, value: valuation.totalValueBase, baseCurrency: valuation.baseCurrency },
    snapshots: history.snapshots.length,
    drawdown: computeDrawdown(history),
  });
}

function writeDiscovery(desk: ActiveDesk): void {
  atomicWriteJSON(
    paths.DESK_FILE,
    {
      port: desk.port,
      pid: process.pid,
      token: desk.token,
      startedAt: desk.startedAt,
      version: version(),
    },
    0o600,
  );
}

async function liveDiscovery(): Promise<DeskConnection | null> {
  const discovery = readJSONSafe<Partial<DeskDiscovery> | null>(paths.DESK_FILE, null);
  if (
    !discovery ||
    !Number.isInteger(discovery.port) ||
    (discovery.port as number) < 1 ||
    (discovery.port as number) > 65_535 ||
    typeof discovery.token !== 'string' ||
    discovery.token.length < 32 ||
    typeof discovery.startedAt !== 'string' ||
    typeof discovery.version !== 'string'
  ) {
    return null;
  }
  const url = baseUrl(discovery.port as number);
  try {
    const health = await fetch(`${url}/health`, {
      headers: { Authorization: `Bearer ${discovery.token}` },
      signal: AbortSignal.timeout(400),
    });
    const body = await health.json();
    if (!health.ok || body?.ok !== true || body.version !== discovery.version) return null;
    const handoff = await fetch(`${url}/handoff`, {
      headers: { Authorization: `Bearer ${discovery.token}` },
      signal: AbortSignal.timeout(400),
    });
    const handoffBody = await handoff.json();
    if (!handoff.ok || typeof handoffBody?.url !== 'string') return null;
    return {
      port: discovery.port as number,
      url: handoffBody.url,
      startedAt: discovery.startedAt,
      version: discovery.version,
    };
  } catch {
    return null;
  }
}

function send(client: DeskClient, text: string): void {
  try {
    client.controller.enqueue(new TextEncoder().encode(text));
  } catch {
    clearInterval(client.heartbeat);
    active?.clients.delete(client);
  }
}

function emit(desk: ActiveDesk, event: string, data: unknown): void {
  const record: DeskEvent = {
    id: desk.nextEventId++,
    event,
    data: JSON.stringify(data),
  };
  desk.events.push(record);
  if (desk.events.length > EVENT_BUFFER_SIZE) desk.events.shift();
  const message = `id: ${record.id}\nevent: ${record.event}\ndata: ${record.data}\n\n`;
  for (const client of desk.clients) send(client, message);
}

function emitState(desk: ActiveDesk): void {
  emit(desk, 'state', deskState(desk));
}

function makeEventStream(request: Request, desk: ActiveDesk): Response {
  const lastId = Number(request.headers.get('last-event-id') || 0);
  let client: DeskClient | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const heartbeat = setInterval(() => {
        if (client) send(client, ': heartbeat\n\n');
      }, 15_000);
      client = { controller, heartbeat };
      desk.clients.add(client);
      const replay = Number.isFinite(lastId) ? desk.events.filter(event => event.id > lastId) : [];
      if (replay.length > 0) {
        for (const event of replay) {
          send(client, `id: ${event.id}\nevent: ${event.event}\ndata: ${event.data}\n\n`);
        }
      } else {
        const state = JSON.stringify(deskState(desk));
        send(client, `id: ${desk.nextEventId++}\nevent: state\ndata: ${state}\n\n`);
      }
    },
    cancel() {
      if (!client) return;
      clearInterval(client.heartbeat);
      desk.clients.delete(client);
    },
  });
  return response(desk, stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

async function markFromDesk(request: Request, desk: ActiveDesk): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json(desk, { error: 'Expected a JSON mark payload.' }, 400);
  }
  if (
    !body ||
    typeof body !== 'object' ||
    typeof body.ticker !== 'string' ||
    typeof body.price !== 'number'
  ) {
    return json(desk, { error: 'ticker (string) and price (number) are required.' }, 400);
  }
  const output = markPortfolioPosition(body.ticker, body.price, {
    asOf: typeof body.asOf === 'string' ? body.asOf : undefined,
    source: typeof body.source === 'string' ? body.source : 'Desk',
    fxRateToBase: typeof body.fxRateToBase === 'number' ? body.fxRateToBase : undefined,
  });
  emitState(desk);
  return json(desk, output);
}

async function respondToDecision(
  request: Request,
  desk: ActiveDesk,
  requestId: string,
): Promise<Response> {
  const pending = desk.pending.get(requestId);
  if (!pending) return json(desk, { error: 'Decision request not found.' }, 404);
  if (pending.response)
    return json(desk, { requestId, response: pending.response, idempotent: true });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json(desk, { error: 'Expected a JSON decision response.' }, 400);
  }
  if (!body || !['accept', 'edit', 'respond', 'ignore'].includes(body.type)) {
    return json(desk, { error: 'type must be accept, edit, respond, or ignore.' }, 400);
  }
  const response: DeskDecisionResponse = {
    type: body.type,
    ...(body.args && typeof body.args === 'object' && !Array.isArray(body.args)
      ? { args: body.args }
      : {}),
  };
  pending.response = response;
  const result = { status: 'resolved', requestId, response };
  for (const waiter of pending.waiters) {
    clearTimeout(waiter.timer);
    waiter.resolve(result);
  }
  pending.waiters.clear();
  emitState(desk);
  return json(desk, result);
}

async function handleRequest(request: Request, desk: ActiveDesk): Promise<Response> {
  if (!isExactLocalHost(request, desk)) return response(desk, 'Forbidden', { status: 403 });
  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname === '/' && url.searchParams.has('token')) {
    const launchToken = url.searchParams.get('token') || '';
    if (!desk.launchTokens.delete(launchToken)) {
      return response(desk, 'Unauthorized', { status: 401 });
    }
    return response(desk, null, {
      status: 302,
      headers: {
        Location: '/',
        'Set-Cookie': `${desk.cookieName}=${cookieValue(desk)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
      },
    });
  }

  if (!isAuthenticated(request, desk)) return response(desk, 'Unauthorized', { status: 401 });
  if (!passesCsrf(request, desk)) return response(desk, 'Forbidden', { status: 403 });

  if (request.method === 'GET' && url.pathname === '/') {
    return response(desk, renderDeskHtml(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  if (request.method === 'GET' && url.pathname === '/app.css') {
    return response(desk, renderDeskCss(), {
      headers: { 'Content-Type': 'text/css; charset=utf-8' },
    });
  }
  if (request.method === 'GET' && url.pathname === '/app.js') {
    return response(desk, renderDeskApp(), {
      headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
    });
  }
  if (request.method === 'GET' && url.pathname === '/health') {
    return json(desk, { ok: true, version: version() });
  }
  if (request.method === 'GET' && url.pathname === '/handoff') {
    return json(desk, { url: issueLaunchUrl(desk) });
  }
  if (request.method === 'GET' && url.pathname === '/api/state') return json(desk, deskState(desk));
  if (request.method === 'GET' && url.pathname === '/events') return makeEventStream(request, desk);
  if (request.method === 'POST' && url.pathname === '/api/portfolio/mark') {
    return markFromDesk(request, desk);
  }
  if (request.method === 'POST' && url.pathname === '/api/mirror/snapshot') {
    return recordDeskSnapshot(desk);
  }
  if (request.method === 'POST' && url.pathname.startsWith('/api/decision/')) {
    return respondToDecision(
      request,
      desk,
      decodeURIComponent(url.pathname.slice('/api/decision/'.length)),
    );
  }
  return response(desk, 'Not Found', { status: 404 });
}

function attachFileWatcher(desk: ActiveDesk): void {
  try {
    desk.watcher = watch(paths.FINSTACK_HOME, () => {
      if (desk.debounce) clearTimeout(desk.debounce);
      desk.debounce = setTimeout(() => emitState(desk), 100);
    });
  } catch {
    // The server still publishes its own writes. A watcher failure is not a
    // reason to expose a half-started Desk; external CLI writes simply refresh
    // on the next page fetch until the directory becomes watchable.
    desk.watcher = null;
  }
}

async function startNewDesk(requestedPort: number): Promise<DeskConnection> {
  const token = randomBytes(32).toString('base64url');
  const startedAt = new Date().toISOString();
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset++) {
    const port = requestedPort === 0 ? 0 : requestedPort + offset;
    let desk!: ActiveDesk;
    try {
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port,
        idleTimeout: 0,
        fetch: request => handleRequest(request, desk),
      });
      const actualPort = server.port;
      if (actualPort === undefined) {
        server.stop(true);
        throw new Error('Bun did not report the Desk listening port');
      }
      desk = {
        server,
        port: actualPort,
        token,
        launchTokens: new Set(),
        startedAt,
        cookieName: `${COOKIE_PREFIX}${actualPort}`,
        clients: new Set(),
        events: [],
        nextEventId: 1,
        pending: new Map(),
        watcher: null,
        debounce: null,
      };
      active = desk;
      writeDiscovery(desk);
      attachFileWatcher(desk);
      return deskConnection(desk);
    } catch {
      if (requestedPort === 0) break;
    }
  }
  throw new FinstackError(
    'Could not start local Desk',
    undefined,
    `Ports ${requestedPort}-${requestedPort + MAX_PORT_ATTEMPTS - 1} are unavailable.`,
    'Stop the conflicting process or set FINSTACK_DESK_PORT to a free local port.',
  );
}

/** Start one hardened loopback Desk, or return the active instance. */
export async function ensureDesk(
  options: { port?: number; own?: boolean } = {},
): Promise<DeskConnection> {
  if (active) {
    return deskConnection(active);
  }
  if (!starting) {
    starting = (async () => {
      // A plain `finstack desk` attaches to the already-running workbench. A
      // decision bridge needs its own process-local promise map, so it asks for
      // an owned server and participates in the bounded port scan instead.
      if (options.port === undefined && !options.own) {
        const discovered = await liveDiscovery();
        if (discovered) return discovered;
      }
      const configured = options.port ?? Number(process.env.FINSTACK_DESK_PORT || DEFAULT_PORT);
      const port =
        Number.isInteger(configured) && configured >= 0 && configured <= 65_535
          ? configured
          : DEFAULT_PORT;
      return startNewDesk(port);
    })().finally(() => {
      starting = null;
    });
  }
  return starting;
}

function waitForDecision(record: PendingDecision, waitSeconds: number): Promise<unknown> {
  if (record.response) {
    return Promise.resolve({
      status: 'resolved',
      requestId: record.requestId,
      response: record.response,
    });
  }
  return new Promise(resolve => {
    const waiter = {
      resolve,
      timer: setTimeout(
        () => {
          record.waiters.delete(waiter);
          resolve({ status: 'pending', requestId: record.requestId });
        },
        Math.max(1, Math.min(waitSeconds, 86_400)) * 1000,
      ),
    };
    record.waiters.add(waiter);
  });
}

/**
 * The MCP decision bridge. A pending request stays visible after a timeout, so
 * an idempotent retry with the same requestId can wait again instead of opening
 * a second human decision card.
 */
export async function awaitDeskDecision(
  request: DeskDecisionRequest,
  waitSeconds = 240,
): Promise<unknown> {
  await ensureDesk({ own: true });
  if (!active) throw new FinstackError('Desk failed to start');
  const requestId = request.requestId || randomBytes(16).toString('hex');
  let pending = active.pending.get(requestId);
  if (!pending) {
    pending = { requestId, request: { ...request, requestId }, waiters: new Set() };
    active.pending.set(requestId, pending);
    emitState(active);
  }
  return waitForDecision(pending, waitSeconds);
}

/** Tests and the stdio server use this to guarantee no orphan loopback server. */
export function stopDesk(): void {
  if (!active) return;
  const desk = active;
  active = null;
  if (desk.debounce) clearTimeout(desk.debounce);
  desk.watcher?.close();
  for (const client of desk.clients) {
    clearInterval(client.heartbeat);
    try {
      client.controller.close();
    } catch {}
  }
  for (const pending of desk.pending.values()) {
    for (const waiter of pending.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve({ status: 'stopped', requestId: pending.requestId });
    }
  }
  desk.server.stop(true);
  const discovery = readJSONSafe<any>(paths.DESK_FILE, null);
  if (discovery?.pid === process.pid && existsSync(paths.DESK_FILE)) {
    try {
      unlinkSync(paths.DESK_FILE);
    } catch {}
  }
}
