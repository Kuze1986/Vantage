import { describe, expect, it } from "vitest";
import { getThreadsTokenStatus } from "./threads.js";

describe("getThreadsTokenStatus", () => {
  const now = Date.parse("2026-08-15T12:00:00.000Z");

  it("marks an expired token as unusable before a publish attempt", () => {
    expect(getThreadsTokenStatus("2026-08-15T11:59:59.000Z", now)).toBe("expired");
  });

  it("warns while the token is still refreshable", () => {
    expect(getThreadsTokenStatus("2026-08-20T12:00:00.000Z", now)).toBe("expires_soon");
  });

  it("keeps a healthy token connected and tolerates legacy records without an expiry", () => {
    expect(getThreadsTokenStatus("2026-08-30T12:00:00.000Z", now)).toBe("valid");
    expect(getThreadsTokenStatus(undefined, now)).toBe("unknown");
  });
});
