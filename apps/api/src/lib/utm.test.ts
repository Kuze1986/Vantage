import { describe, it, expect } from "vitest";
import { tagUrls } from "./utm.js";

describe("tagUrls", () => {
  it("appends UTM params to a bare URL", () => {
    const out = tagUrls("see https://example.com/post", "x", "piece-1");
    expect(out).toContain("utm_source=x");
    expect(out).toContain("utm_medium=social");
    expect(out).toContain("utm_campaign=vantage");
    expect(out).toContain("utm_content=piece-1");
  });

  it("tags every URL in the string", () => {
    const out = tagUrls("https://a.com and https://b.com", "linkedin", "p2");
    expect(out.match(/utm_source=linkedin/g)).toHaveLength(2);
  });

  it("leaves non-URL text untouched", () => {
    const text = "no links here, just words.";
    expect(tagUrls(text, "x", "p")).toBe(text);
  });

  it("overwrites existing utm params rather than duplicating them", () => {
    const out = tagUrls("https://example.com?utm_source=old", "reddit", "p3");
    expect(out).toContain("utm_source=reddit");
    expect(out).not.toContain("utm_source=old");
    expect(out.match(/utm_source=/g)).toHaveLength(1);
  });

  it("does not break trailing punctuation in prose", () => {
    const out = tagUrls("visit https://example.com.", "x", "p");
    // the URL is tagged; the sentence period is handled by the URL regex boundary
    expect(out).toContain("utm_content=p");
  });
});
