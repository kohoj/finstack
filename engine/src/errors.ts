export class FinstackError extends Error {
  source?: string;
  reason?: string;
  suggestion?: string;
  cached?: { data: unknown; age: string };

  constructor(
    message: string,
    source?: string,
    reason?: string,
    suggestion?: string,
  ) {
    super(message);
    this.name = 'FinstackError';
    this.source = source;
    this.reason = reason;
    this.suggestion = suggestion;
  }
}

export function formatErrorJSON(err: Error): string {
  if (err instanceof FinstackError) {
    const obj: Record<string, unknown> = { error: err.message };
    if (err.source) obj.source = err.source;
    if (err.reason) obj.reason = err.reason;
    if (err.suggestion) obj.suggestion = err.suggestion;
    if (err.cached) obj.cached = err.cached;
    return JSON.stringify(obj);
  }
  return JSON.stringify({ error: err.message });
}
