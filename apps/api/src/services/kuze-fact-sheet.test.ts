import { describe, it, expect } from "vitest";
import {
  kuzeSystemPrompt,
  ilitaAuditSystemPrompt,
  renderFactSheet,
  isProductFactSheet,
  type ProductFactSheet,
} from "@vantage/prompts";

const FACT: ProductFactSheet = {
  product_name: "The Shift",
  approved_claims: ["The Shift is a game-based certification-prep platform with career-specific content packs."],
  prohibited_claims: ["Guaranteed exam passes, job placement, or score improvement."],
  approved_terms: ["The Shift", "The Queue", "Blueprints"],
  primary_cta: "Start a Queue deploy",
};

describe("isProductFactSheet", () => {
  it("rejects partial sheets", () => {
    expect(isProductFactSheet(null)).toBe(false);
    expect(isProductFactSheet({})).toBe(false);
    expect(isProductFactSheet({ ...FACT, approved_claims: [] })).toBe(false);
    expect(isProductFactSheet({ ...FACT, product_name: "  " })).toBe(false);
  });

  it("accepts a complete sheet", () => {
    expect(isProductFactSheet(FACT)).toBe(true);
  });
});

describe("renderFactSheet", () => {
  it("is empty for an invalid sheet, so prompts can branch on it", () => {
    expect(renderFactSheet(null)).toBe("");
    expect(renderFactSheet({ ...FACT, approved_terms: [] })).toBe("");
  });

  it("includes every field", () => {
    const rendered = renderFactSheet(FACT);
    expect(rendered).toContain("The Shift");
    expect(rendered).toContain("game-based certification-prep platform");
    expect(rendered).toContain("Guaranteed exam passes");
    expect(rendered).toContain("Start a Queue deploy");
  });
});

describe("kuzeSystemPrompt with a fact sheet", () => {
  it("states that facts outrank the brand voice", () => {
    const sys = kuzeSystemPrompt("tweet", { factSheet: FACT });
    expect(sys).toContain("ground truth");
    expect(sys).toMatch(/outrank the brand voice on matters of FACT/i);
  });

  it("tells the model a topic is a subject, not a product claim", () => {
    const sys = kuzeSystemPrompt("linkedin_post", { factSheet: FACT });
    expect(sys).toMatch(/SUBJECT to write about, not a claim about the product/i);
  });

  it("omits the topic-vs-claim guard when there are no facts to anchor it", () => {
    const sys = kuzeSystemPrompt("linkedin_post");
    expect(sys).not.toMatch(/SUBJECT to write about/i);
  });

  it("keeps the schema and voice precedence intact", () => {
    const sys = kuzeSystemPrompt("tweet", { factSheet: FACT });
    expect(sys).toContain("yield to brand voice");
    expect(sys).toMatch(/AUTHORITATIVE on matters of VOICE/i);
  });
});

describe("ilitaAuditSystemPrompt", () => {
  it("no longer hard-codes NEXUS as the product", () => {
    expect(ilitaAuditSystemPrompt("tweet")).not.toContain("NEXUS");
    expect(ilitaAuditSystemPrompt("tweet", undefined, FACT)).not.toContain("NEXUS");
  });

  it("names the product from the fact sheet", () => {
    const sys = ilitaAuditSystemPrompt("tweet", undefined, FACT);
    expect(sys).toContain("The Shift");
    expect(sys).toContain("Approved product facts");
  });

  it("directs the reviewer to fail unsupported capability claims", () => {
    const sys = ilitaAuditSystemPrompt("facebook_post", undefined, FACT);
    expect(sys).toMatch(/not supported by an approved claim is an inaccurate_product_claim/i);
    expect(sys).toMatch(/audience_mismatch/i);
  });

  it("fails capability claims outright when no fact sheet is available", () => {
    const sys = ilitaAuditSystemPrompt("tweet");
    expect(sys).toMatch(/No approved fact sheet was supplied/i);
    expect(sys).toMatch(/Fail any content that asserts a specific product capability/i);
  });
});

describe("facebook engagement-bait rule", () => {
  it("defaults to a CTA and names the banned question shapes", () => {
    const sys = kuzeSystemPrompt("facebook_post");
    expect(sys).toMatch(/Close with ONE restrained CTA/i);
    expect(sys).toContain("How do you currently handle X?");
  });
});
