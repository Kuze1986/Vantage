import { describe, it, expect } from "vitest";
import {
  DEFAULT_POSTING_HOURS,
  postingHoursFor,
  pickPostingHour,
  scheduledAtOnDate,
} from "./posting-hours.js";

describe("postingHoursFor", () => {
  it("returns the configured hours", () => {
    expect(postingHoursFor({ posting_hours: [8, 20] })).toEqual([8, 20]);
  });

  it("falls back to the default when unset, empty, or null", () => {
    expect(postingHoursFor(null)).toEqual(DEFAULT_POSTING_HOURS);
    expect(postingHoursFor(undefined)).toEqual(DEFAULT_POSTING_HOURS);
    expect(postingHoursFor({})).toEqual(DEFAULT_POSTING_HOURS);
    expect(postingHoursFor({ posting_hours: [] })).toEqual(DEFAULT_POSTING_HOURS);
  });

  it("drops out-of-range and non-integer hours", () => {
    expect(postingHoursFor({ posting_hours: [9, 24, -1, 12.5, 17] })).toEqual([9, 17]);
  });

  it("falls back when every configured hour is invalid", () => {
    expect(postingHoursFor({ posting_hours: [99, -3] })).toEqual(DEFAULT_POSTING_HOURS);
  });

  it("does not hand back the shared default array for callers to mutate", () => {
    const hours = postingHoursFor(null);
    hours.push(23);
    expect(DEFAULT_POSTING_HOURS).toEqual([9, 12, 17]);
  });
});

describe("pickPostingHour", () => {
  it("rotates through the configured hours", () => {
    const cfg = { posting_hours: [8, 13, 19] };
    expect([0, 1, 2, 3].map((i) => pickPostingHour(cfg, i))).toEqual([8, 13, 19, 8]);
  });

  it("staggers channels on the same day to different hours", () => {
    const cfg = { posting_hours: [9, 12, 17] };
    const day = 3;
    const hours = [0, 1, 2].map((channelIndex) => pickPostingHour(cfg, day + channelIndex));
    expect(new Set(hours).size).toBe(3);
  });

  it("survives a negative or fractional index", () => {
    const cfg = { posting_hours: [9, 12] };
    expect(cfg.posting_hours).toContain(pickPostingHour(cfg, -5));
    expect(cfg.posting_hours).toContain(pickPostingHour(cfg, 2.7));
    expect(cfg.posting_hours).toContain(pickPostingHour(cfg, NaN));
  });
});

describe("scheduledAtOnDate", () => {
  it("builds a UTC timestamp at the given hour", () => {
    expect(scheduledAtOnDate("2026-08-08", 14)).toBe("2026-08-08T14:00:00.000Z");
  });

  it("handles midnight", () => {
    expect(scheduledAtOnDate("2026-01-01", 0)).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects malformed dates", () => {
    expect(scheduledAtOnDate("not-a-date", 9)).toBeNull();
    expect(scheduledAtOnDate("2026-8-8", 9)).toBeNull();
  });

  it("rejects dates that would silently roll over into the next month", () => {
    expect(scheduledAtOnDate("2026-02-31", 9)).toBeNull();
  });
});
