// engine/src/net.ts

/**
 * Strip secret-bearing query parameters before a URL enters an error message.
 *
 * Provider URLs carry the API key inline (?api_key=…, ?apikey=…, ?apiKey=…,
 * ?token=…). Those error messages surface to the user through command-layer
 * `e.message` passthrough (macro.ts, earnings.ts, …), so an unredacted URL
 * leaks the key into logs and terminal output. This is the single choke point
 * where every provider URL becomes error text, so redaction lives here.
 *
 * Falls back to a bare path on unparseable input rather than risk echoing raw
 * query text.
 */
export function redactUrl(url: string): string {
  const SECRET_PARAMS = /^(api_?key|apikey|token)$/i;
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (SECRET_PARAMS.test(k)) u.searchParams.set(k, 'REDACTED');
    }
    return u.toString();
  } catch {
    return url.split('?')[0];
  }
}

export class TimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${redactUrl(url)} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

export async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new TimeoutError(url, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface RetryConfig {
  retries?: number;
  backoffMs?: number[];
  timeoutMs?: number;
}

const DEFAULT_RETRY: Required<RetryConfig> = {
  retries: 2,
  backoffMs: [1000, 3000],
  timeoutMs: 10_000,
};

/**
 * Escape hatch for tests: FINSTACK_NO_BACKOFF=1 collapses retry delays to zero.
 *
 * Retry *counts* are unchanged, so the code path under test is the same one
 * that runs in production — only the sleeping goes away. Without this, every
 * simulated outage costs 4 seconds of real waiting.
 */
function backoffFor(configured: number[]): number[] {
  return process.env.FINSTACK_NO_BACKOFF === '1' ? configured.map(() => 0) : configured;
}

export async function fetchWithRetry(
  url: string,
  opts: RequestInit = {},
  config: RetryConfig = {},
): Promise<Response> {
  const merged = { ...DEFAULT_RETRY, ...config };
  const { retries, timeoutMs } = merged;
  const backoffMs = backoffFor(merged.backoffMs);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, opts, timeoutMs);
      // Don't retry 4xx — those are not transient
      if (res.status < 500) return res;
      // 5xx — retry if we have attempts left
      if (attempt < retries) {
        const delay = backoffMs[attempt] ?? backoffMs[backoffMs.length - 1] ?? 1000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      // Exhausted retries on 5xx
      throw new Error(`${redactUrl(url)} returned ${res.status} after ${retries + 1} attempts`);
    } catch (err: any) {
      lastError = err;
      // Retryable errors: timeout, network
      if (attempt < retries) {
        const delay = backoffMs[attempt] ?? backoffMs[backoffMs.length - 1] ?? 1000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error(`fetchWithRetry: unexpected state for ${redactUrl(url)}`);
}
