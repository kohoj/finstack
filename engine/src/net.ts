// engine/src/net.ts
export class TimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
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

export async function fetchWithRetry(
  url: string,
  opts: RequestInit = {},
  config: RetryConfig = {},
): Promise<Response> {
  const { retries, backoffMs, timeoutMs } = { ...DEFAULT_RETRY, ...config };
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
      throw new Error(`${url} returned ${res.status} after ${retries + 1} attempts`);
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
  throw lastError || new Error(`fetchWithRetry: unexpected state for ${url}`);
}
