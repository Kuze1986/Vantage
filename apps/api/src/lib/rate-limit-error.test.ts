import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimitError, parseRetryAfter } from "./rate-limit-error.js";

describe("parseRetryAfter", () => {
  it("falls back to the default when the header is null", () => {
    expect(parseRetryAfter(null, 15_000)).toBe(15_000);
  });

  it("parses a delta-seconds header into milliseconds", () => {
    expect(parseRetryAfter("30", 15_000)).toBe(30_000);
  });

  it("ignores non-positive second values and uses the default", () => {
    expect(parseRetryAfter("0", 15_000)).toBe(15_000);
    expect(parseRetryAfter("-5", 15_000)).toBe(15_000);
  });

  it("parses an HTTP-date header relative to now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const future = new Date("2026-01-01T00:01:00Z").toUTCString();
    expect(parseRetryAfter(future, 5_000)).toBe(60_000);
    vi.useRealTimers();
  });

  it("falls back to the default for unparseable garbage", () => {
    expect(parseRetryAfter("not-a-date", 9_999)).toBe(9_999);
  });
});

describe("RateLimitError", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("computes retryAfter as now + delay and is named", () => {
    const err = new RateLimitError("slow down", 60_000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("RateLimitError");
    expect(err.retryAfter.toISOString()).toBe("2026-01-01T00:01:00.000Z");
  });
});
