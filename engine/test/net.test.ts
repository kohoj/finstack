// engine/test/net.test.ts
import { describe, it, expect, mock } from 'bun:test';
import { fetchWithTimeout, fetchWithRetry, TimeoutError } from '../src/net';

describe('fetchWithTimeout', () => {
  it('returns response when request completes within timeout', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response('ok', { status: 200 }))
    );
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch as any;
    try {
      const res = await fetchWithTimeout('http://example.com', {}, 5000);
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('throws TimeoutError when request exceeds timeout', async () => {
    const mockFetch = mock((_url: string, opts?: any) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response('late')), 5000);
        if (opts?.signal) {
          opts.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      })
    );
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch as any;
    try {
      await expect(fetchWithTimeout('http://example.com', {}, 50)).rejects.toThrow(TimeoutError);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('fetchWithRetry', () => {
  it('returns on first success without retrying', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response('ok', { status: 200 }))
    );
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch as any;
    try {
      const res = await fetchWithRetry('http://example.com');
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('retries on 5xx and succeeds', async () => {
    let calls = 0;
    const mockFetch = mock(() => {
      calls++;
      if (calls === 1) return Promise.resolve(new Response('error', { status: 500 }));
      return Promise.resolve(new Response('ok', { status: 200 }));
    });
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch as any;
    try {
      const res = await fetchWithRetry('http://example.com', {}, {
        retries: 2,
        backoffMs: [10, 20],
        timeoutMs: 5000,
      });
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('does not retry on 4xx errors', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response('not found', { status: 404 }))
    );
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch as any;
    try {
      const res = await fetchWithRetry('http://example.com', {}, {
        retries: 2,
        backoffMs: [10, 20],
        timeoutMs: 5000,
      });
      expect(res.status).toBe(404);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('throws after exhausting all retries', async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response('error', { status: 503 }))
    );
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch as any;
    try {
      await expect(
        fetchWithRetry('http://example.com', {}, {
          retries: 2,
          backoffMs: [10, 20],
          timeoutMs: 5000,
        })
      ).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(3);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('retries on network errors', async () => {
    let calls = 0;
    const mockFetch = mock(() => {
      calls++;
      if (calls === 1) return Promise.reject(new Error('network error'));
      return Promise.resolve(new Response('ok', { status: 200 }));
    });
    const original = globalThis.fetch;
    globalThis.fetch = mockFetch as any;
    try {
      const res = await fetchWithRetry('http://example.com', {}, {
        retries: 2,
        backoffMs: [10, 20],
        timeoutMs: 5000,
      });
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = original;
    }
  });
});
