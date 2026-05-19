/**
 * 3B-4: Typed error thrown by adapters on HTTP 429 / rate-limit responses.
 * The scheduler catches this specifically and reschedules without incrementing
 * the retry_count, since rate limits are transient platform conditions.
 */
export class RateLimitError extends Error {
  public readonly retryAfter: Date;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfter = new Date(Date.now() + retryAfterMs);
  }
}

/** Parse Retry-After header (seconds or HTTP-date). Falls back to defaultMs. */
export function parseRetryAfter(header: string | null, defaultMs: number): number {
  if (!header) return defaultMs;
  const secs = Number(header);
  if (!isNaN(secs) && secs > 0) return secs * 1000;
  const date = Date.parse(header);
  if (!isNaN(date)) return Math.max(0, date - Date.now());
  return defaultMs;
}
