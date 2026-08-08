import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ response: "" }));

vi.mock("../lib/llm.js", () => ({
  resolveProvider: async () => ({
    generateCompletion: async () => h.response,
  }),
}));

import { auditContent } from "./ilita.js";

describe("auditContent", () => {
  it("returns a pass verdict with feedback and no category", async () => {
    h.response = JSON.stringify({ verdict: "pass", feedback: "Looks great." });
    const result = await auditContent({ content: "hi", format: "tweet", brand_voice: "{}" });
    expect(result).toEqual({ verdict: "pass", feedback: "Looks great." });
  });

  it("parses a recognized category on fail", async () => {
    h.response = JSON.stringify({ verdict: "fail", feedback: "Mentions a competitor.", category: "competitor_mention" });
    const result = await auditContent({ content: "hi", format: "tweet", brand_voice: "{}" });
    expect(result).toEqual({ verdict: "fail", feedback: "Mentions a competitor.", category: "competitor_mention" });
  });

  it("falls back to 'other' when the category is missing", async () => {
    h.response = JSON.stringify({ verdict: "fail", feedback: "Something's off." });
    const result = await auditContent({ content: "hi", format: "tweet", brand_voice: "{}" });
    expect(result).toMatchObject({ verdict: "fail", category: "other" });
  });

  it("falls back to 'other' when the category is unrecognized rather than throwing", async () => {
    h.response = JSON.stringify({ verdict: "fail", feedback: "Something's off.", category: "made_up_category" });
    const result = await auditContent({ content: "hi", format: "tweet", brand_voice: "{}" });
    expect(result).toMatchObject({ verdict: "fail", category: "other" });
  });

  it("throws on an invalid verdict", async () => {
    h.response = JSON.stringify({ verdict: "maybe", feedback: "?" });
    await expect(auditContent({ content: "hi", format: "tweet", brand_voice: "{}" })).rejects.toThrow(/invalid verdict/);
  });

  it("throws on non-JSON responses", async () => {
    h.response = "not json at all";
    await expect(auditContent({ content: "hi", format: "tweet", brand_voice: "{}" }))
      .rejects.toThrow(/Ilita returned no JSON/);
  });

  it("tolerates the malformed JSON a model actually emits", async () => {
    // Ilita shared Kuze's fragile extractor, so the missing comma that broke a
    // campaign launch would have failed an audit the same way.
    h.response = '{"verdict": "pass"\n "feedback": "on brand"}';
    const out = await auditContent({ content: "hi", format: "tweet", brand_voice: "{}" });
    expect(out.verdict).toBe("pass");
  });
});
