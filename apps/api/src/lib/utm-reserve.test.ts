import { describe, it, expect } from "vitest";
import { tagUrls, utmExpansionCost, DEFAULT_UTM_CAMPAIGN } from "./utm.js";

const DEST = "https://theshift.bioloopnexus.com";
const CAMPAIGN = "b33a5bc6-b810-4dce-acbe-fd19e29b9ee2";
const PIECE = "8a3f23c1-f5cf-40f4-a5b6-8deae3db680f";

describe("utmExpansionCost", () => {
  it("predicts exactly what tagUrls adds", () => {
    for (const channel of ["x", "bluesky", "threads", "linkedin", "instagram", "email"]) {
      const actual = tagUrls(DEST, channel, PIECE, CAMPAIGN).length - DEST.length;
      expect(utmExpansionCost(DEST, channel, CAMPAIGN)).toBe(actual);
    }
  });

  it("accounts for the origin gaining a trailing slash on normalization", () => {
    // new URL("https://host").toString() === "https://host/" — a hand-computed
    // suffix length misses this character.
    expect(tagUrls(DEST, "x", PIECE, CAMPAIGN)).toContain("bioloopnexus.com/?");
    expect(utmExpansionCost(DEST, "x", CAMPAIGN)).toBeGreaterThan(
      `?utm_source=x&utm_medium=social&utm_campaign=${CAMPAIGN}&utm_content=${PIECE}`.length - 1,
    );
  });

  it("is larger for a campaign-scoped tag than the ad-hoc default", () => {
    expect(utmExpansionCost(DEST, "x", CAMPAIGN)).toBeGreaterThan(
      utmExpansionCost(DEST, "x", DEFAULT_UTM_CAMPAIGN),
    );
  });

  it("exceeds the flat 130-character allowance that caused the overflows", () => {
    // The regression: a campaign-scoped tag on any channel is >130 chars, so the
    // old reserve left finished posts over the hard caps on X/Threads/Bluesky.
    for (const channel of ["x", "bluesky", "threads"]) {
      expect(utmExpansionCost(DEST, channel, CAMPAIGN)).toBeGreaterThan(130);
    }
  });

  it("leaves a usable prose budget once reserved against the tweet cap", () => {
    const reserve = DEST.length + 2 + utmExpansionCost(DEST, "x", CAMPAIGN) + 24;
    expect(280 - reserve).toBeGreaterThan(40);
  });
});
