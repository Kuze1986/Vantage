import { describe, expect, it } from "vitest";
import { launchStatusForMedia, shouldAutoQueue } from "./auto-queue.js";

describe("auto-queue", () => {
  it("launchStatusForMedia queues when media ready", () => {
    expect(launchStatusForMedia("none")).toBe("queued");
    expect(launchStatusForMedia("ready")).toBe("queued");
    expect(launchStatusForMedia("pending")).toBe("approved");
    expect(launchStatusForMedia("failed")).toBe("approved");
  });

  it("shouldAutoQueue requires approved + scheduled_for + ready media", () => {
    expect(
      shouldAutoQueue({
        id: "1",
        status: "approved",
        scheduled_for: "2026-08-02T09:00:00Z",
        media_status: "ready",
      }),
    ).toBe(true);
    expect(
      shouldAutoQueue({
        id: "1",
        status: "approved",
        scheduled_for: "2026-08-02T09:00:00Z",
        media_status: "pending",
      }),
    ).toBe(false);
    expect(
      shouldAutoQueue({
        id: "1",
        status: "queued",
        scheduled_for: "2026-08-02T09:00:00Z",
        media_status: "ready",
      }),
    ).toBe(false);
  });
});
