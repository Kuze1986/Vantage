/**
 * Posting-hour resolution — shared by the autopilot cadence and campaign launch.
 *
 * Send times live on `channels.cadence_config.posting_hours` (UTC hours, per channel).
 * Both schedulers read the same config through here so a channel's configured hours
 * apply no matter which path produced the piece.
 */

/** UTC hours used when a channel has no `posting_hours` configured. */
export const DEFAULT_POSTING_HOURS = [9, 12, 17];

export type PostingHoursConfig = { posting_hours?: number[] } | null | undefined;

/** Valid UTC hour: an integer 0–23. Anything else is dropped. */
function isHour(h: unknown): h is number {
  return typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23;
}

/**
 * A channel's configured posting hours, sanitised. Falls back to the shared default
 * when the config is missing, empty, or contains no usable hours.
 */
export function postingHoursFor(config: PostingHoursConfig): number[] {
  const raw = config?.posting_hours;
  if (!Array.isArray(raw)) return [...DEFAULT_POSTING_HOURS];
  const hours = raw.filter(isHour);
  return hours.length ? hours : [...DEFAULT_POSTING_HOURS];
}

/**
 * Pick one hour from a channel's rotation. `index` staggers successive pieces for the
 * same channel (day number, piece index, …) so a run doesn't stack them all on one hour.
 */
export function pickPostingHour(config: PostingHoursConfig, index: number): number {
  const hours = postingHoursFor(config);
  // Guard against a negative or fractional index producing an out-of-range lookup.
  const i = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : 0;
  return hours[i % hours.length]!;
}

/**
 * Build an ISO timestamp for `YYYY-MM-DD` at the given UTC hour.
 * Returns null when the date string isn't a valid calendar date.
 */
export function scheduledAtOnDate(dateStr: string, hour: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), hour, 0, 0);
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return null;
  // Reject dates the Date constructor silently rolled over (e.g. 2026-02-31).
  if (dt.getUTCMonth() !== Number(mo) - 1 || dt.getUTCDate() !== Number(d)) return null;
  return dt.toISOString();
}
