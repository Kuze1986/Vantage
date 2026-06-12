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
  const trimmed = header.trim();
  // A purely numeric header is delta-seconds. Handle it explicitly so values
  // like "0" don't fall through to Date.parse (which would read "0" as a year).
  if (/^-?\d+$/.test(trimmed)) {
    const secs = Number(trimmed);
    return secs > 0 ? secs * 1000 : defaultMs;
  }
  const date = Date.parse(trimmed);
  if (!isNaN(date)) return Math.max(0, date - Date.now());
  return defaultMs;
}
