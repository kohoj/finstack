import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { importPortfolioSnapshot } from '../../src/commands/portfolio';
import { awaitDeskDecision, ensureDesk, stopDesk } from '../../src/desk/server';
import { useTestHome } from '../helpers';

const home = useTestHome('desk-server');

function base(url: string): string {
  const parsed = new URL(url);
  return parsed.origin;
}

async function session(url: string) {
  const exchange = await fetch(url, { redirect: 'manual' });
  const rawCookie = exchange.headers.get('set-cookie');
  expect(exchange.status).toBe(302);
  expect(rawCookie).toBeTruthy();
  return rawCookie?.split(';')[0] as string;
}

beforeEach(() => {
  stopDesk();
  home.reset();
  importPortfolioSnapshot({
    baseCurrency: 'USD',
    positions: [
      {
        ticker: 'MSFT',
        shares: 10,
        avgCost: 400,
        currency: 'USD',
      },
    ],
  });
});

afterEach(() => {
  stopDesk();
});

describe('Desk loopback boundary', () => {
  it('exchanges a one-time URL capability for an HttpOnly session and serves marked state', async () => {
    const connection = await ensureDesk({ port: 0 });
    const origin = base(connection.url);

    expect((await fetch(`${origin}/api/state`)).status).toBe(401);
    const cookie = await session(connection.url);
    expect((await fetch(connection.url, { redirect: 'manual' })).status).toBe(401);
    const state = await fetch(`${origin}/api/state`, { headers: { cookie } });

    expect(state.status).toBe(200);
    const body = await state.json();
    expect(body.portfolio.costFallbackTickers).toEqual(['MSFT']);
    expect(state.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(state.headers.get('cache-control')).toBe('no-store');
  });

  it('fails cross-origin state writes even with a valid local capability', async () => {
    const connection = await ensureDesk({ port: 0 });
    const origin = base(connection.url);
    const cookie = await session(connection.url);
    const headers = {
      cookie,
      'content-type': 'application/json',
    };
    const denied = await fetch(`${origin}/api/portfolio/mark`, {
      method: 'POST',
      headers: { ...headers, origin: 'https://attacker.example' },
      body: JSON.stringify({ ticker: 'MSFT', price: 500 }),
    });
    expect(denied.status).toBe(403);

    const accepted = await fetch(`${origin}/api/portfolio/mark`, {
      method: 'POST',
      headers: { ...headers, origin },
      body: JSON.stringify({ ticker: 'MSFT', price: 500, source: 'test' }),
    });
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).valuation.totalValueBase).toBe(5000);
  });

  it('records a daily mirror only after every holding has an explicit mark', async () => {
    const connection = await ensureDesk({ port: 0 });
    const origin = base(connection.url);
    const cookie = await session(connection.url);
    const headers = { cookie, origin, 'content-type': 'application/json' };

    const incomplete = await fetch(`${origin}/api/mirror/snapshot`, {
      method: 'POST',
      headers,
    });
    expect(incomplete.status).toBe(409);

    await fetch(`${origin}/api/portfolio/mark`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ticker: 'MSFT', price: 500, source: 'test' }),
    });
    const recorded = await fetch(`${origin}/api/mirror/snapshot`, {
      method: 'POST',
      headers,
    });
    expect(recorded.status).toBe(200);
    expect((await recorded.json()).recorded.value).toBe(5000);
  });

  it('projects concentration, mark freshness, and directional stress from the factual state', async () => {
    const connection = await ensureDesk({ port: 0 });
    const origin = base(connection.url);
    const cookie = await session(connection.url);
    const state = await fetch(`${origin}/api/state`, { headers: { cookie } });
    const body = await state.json();

    expect(body.portfolio.concentration.warnings).toContain(
      'MSFT is 100.0% of portfolio (limit: 25%)',
    );
    expect(body.stress.map((item: any) => item.id)).toEqual([
      'spy-20pct',
      'rates+100bp',
      'recession',
    ]);
    expect(body.attention.length).toBeGreaterThan(0);
  });

  it('makes incomplete stress coverage a first-class constraint instead of substituting SPY', async () => {
    importPortfolioSnapshot(
      {
        baseCurrency: 'USD',
        positions: [
          { ticker: 'MSFT', shares: 10, avgCost: 400, currency: 'USD' },
          { ticker: 'PRIVATE', shares: 5, avgCost: 200, currency: 'USD' },
        ],
      },
      true,
    );
    const connection = await ensureDesk({ port: 0 });
    const origin = base(connection.url);
    const cookie = await session(connection.url);
    const state = await fetch(`${origin}/api/state`, { headers: { cookie } });
    const body = await state.json();

    expect(body.stress[0].coveragePct).toBe(80);
    expect(body.stress[0].unmodeledTickers).toEqual(['PRIVATE']);
    expect(body.attention).toContainEqual({
      level: 'critical',
      message: expect.stringContaining('Directional stress excludes unmodeled holdings: PRIVATE.'),
    });
  });

  it('bridges an idempotent human decision from Desk back to the waiting caller', async () => {
    const connection = await ensureDesk({ port: 0 });
    const origin = base(connection.url);
    const cookie = await session(connection.url);
    const waiting = awaitDeskDecision(
      {
        requestId: 'ticket-msft-001',
        action_request: { action: 'confirm-ticket' },
        description: 'Confirm a small MSFT starter position after reviewing concentration.',
      },
      10,
    );

    const state = await fetch(`${origin}/api/state`, { headers: { cookie } });
    expect((await state.json()).pendingDecisions[0].requestId).toBe('ticket-msft-001');
    const response = await fetch(`${origin}/api/decision/ticket-msft-001`, {
      method: 'POST',
      headers: { cookie, origin, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'accept' }),
    });
    expect(response.status).toBe(200);
    expect(await waiting).toEqual({
      status: 'resolved',
      requestId: 'ticket-msft-001',
      response: { type: 'accept' },
    });
  });
});
