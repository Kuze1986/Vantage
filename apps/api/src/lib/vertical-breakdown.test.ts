import { describe, expect, it } from "vitest";
import { buildVerticalBreakdown, type VerticalPieceRow } from "./vertical-breakdown.js";

const WINDOW = { since7d: "2026-08-01T00:00:00Z", todayStart: "2026-08-08T00:00:00Z" };

const piece = (over: Partial<VerticalPieceRow> & { id: string }): VerticalPieceRow => ({
  status: "published",
  published_at: "2026-08-05T12:00:00Z",
  topics: { vertical: "fitness" },
  ...over,
});

describe("vertical-breakdown", () => {
  it("counts queued and auditing pieces, which have a null published_at", () => {
    // The original bug: the query filtered on published_at >= since7d, so these
    // two rows never reached the accumulator and both counts were always zero.
    const out = buildVerticalBreakdown(
      [
        piece({ id: "a", status: "queued", published_at: null }),
        piece({ id: "b", status: "auditing", published_at: null }),
      ],
      [],
      WINDOW,
    );
    expect(out.fitness).toMatchObject({ queued: 1, auditing: 1, published_7d: 0 });
  });

  it("applies the 7d window to published pieces only", () => {
    const out = buildVerticalBreakdown(
      [
        piece({ id: "recent", published_at: "2026-08-05T00:00:00Z" }),
        piece({ id: "stale", published_at: "2026-07-01T00:00:00Z" }),
      ],
      [],
      WINDOW,
    );
    expect(out.fitness.published_7d).toBe(1);
  });

  it("counts today as a subset of the 7d window", () => {
    const out = buildVerticalBreakdown(
      [
        piece({ id: "today", published_at: "2026-08-08T09:00:00Z" }),
        piece({ id: "earlier", published_at: "2026-08-03T09:00:00Z" }),
      ],
      [],
      WINDOW,
    );
    expect(out.fitness).toMatchObject({ published_7d: 2, published_today: 1 });
  });

  it("attributes engagement to the vertical of its piece", () => {
    const out = buildVerticalBreakdown(
      [
        piece({ id: "p1", topics: { vertical: "fitness" } }),
        piece({ id: "p2", topics: { vertical: "finance" } }),
      ],
      [
        { content_piece_id: "p1" },
        { content_piece_id: "p1" },
        { content_piece_id: "p2" },
      ],
      WINDOW,
    );
    expect(out.fitness.engagement_7d).toBe(2);
    expect(out.finance.engagement_7d).toBe(1);
  });

  it("skips engagement that cannot be attributed", () => {
    const out = buildVerticalBreakdown(
      [piece({ id: "p1" })],
      [{ content_piece_id: null }, { content_piece_id: "unknown-piece" }],
      WINDOW,
    );
    expect(out.fitness.engagement_7d).toBe(0);
  });

  it("accepts the topics embed as either an object or an array", () => {
    const out = buildVerticalBreakdown(
      [
        piece({ id: "obj", topics: { vertical: "fitness" } }),
        piece({ id: "arr", topics: [{ vertical: "fitness" }] }),
      ],
      [],
      WINDOW,
    );
    expect(out.fitness.published_7d).toBe(2);
  });

  it("ignores pieces with no usable vertical", () => {
    const out = buildVerticalBreakdown(
      [
        piece({ id: "a", topics: null }),
        piece({ id: "b", topics: { vertical: null } }),
        piece({ id: "c", topics: { vertical: "   " } }),
        piece({ id: "d", topics: [] }),
      ],
      [],
      WINDOW,
    );
    expect(Object.keys(out)).toEqual([]);
  });

  it("keeps verticals separate and ignores statuses it does not track", () => {
    const out = buildVerticalBreakdown(
      [
        piece({ id: "a", topics: { vertical: "fitness" } }),
        piece({ id: "b", status: "rejected", published_at: null, topics: { vertical: "finance" } }),
      ],
      [],
      WINDOW,
    );
    expect(out.fitness.published_7d).toBe(1);
    // A rejected piece still registers its vertical, but increments nothing.
    expect(out.finance).toMatchObject({ published_7d: 0, queued: 0, auditing: 0, engagement_7d: 0 });
  });
});
