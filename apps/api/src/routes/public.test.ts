import { describe, expect, it } from "vitest";
import { bucketByDay, dayKeys } from "./public.js";

describe("public / dayKeys", () => {
  it("returns the requested number of ISO date keys, oldest first", () => {
    const keys = dayKeys(7);
    expect(keys).toHaveLength(7);
    expect(keys[6]).toBe(new Date().toISOString().slice(0, 10)); // today, last
    for (const k of keys) expect(k).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("public / bucketByDay", () => {
  it("counts timestamps into their matching day bucket", () => {
    const keys = dayKeys(3);
    const today = keys[2];
    const out = bucketByDay(keys, [`${today}T09:00:00Z`, `${today}T18:00:00Z`]);
    expect(out).toEqual([0, 0, 2]);
  });

  it("ignores null timestamps and timestamps outside the window", () => {
    const keys = dayKeys(2);
    const out = bucketByDay(keys, [null, "2000-01-01T00:00:00Z"]);
    expect(out).toEqual([0, 0]);
  });

  it("returns all zeros for an empty input", () => {
    expect(bucketByDay(dayKeys(4), [])).toEqual([0, 0, 0, 0]);
  });
});
