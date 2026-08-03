import { describe, it, expect } from "vitest";
import { kuzeUserPrompt } from "@vantage/prompts";

const BASE = {
  format: "tweet" as const,
  topic_text: "pharmacy tech certification tips",
  vertical: "pharmacy",
  brand_voice: "warm, authoritative",
};

describe("kuzeUserPrompt — virality patterns and avoid-list sections", () => {
  it("omits both new sections when no extras are provided", () => {
    const prompt = kuzeUserPrompt(BASE);
    expect(prompt).not.toContain("Proven viral patterns");
    expect(prompt).not.toContain("Underperforming patterns");
  });

  it("renders the virality patterns section with characteristics and stats", () => {
    const prompt = kuzeUserPrompt({
      ...BASE,
      extras: {
        viralityPatterns: [
          {
            pattern_name: "personal_story_hook",
            characteristics: { tone: "conversational", hooks: ["what if", "imagine"], length: "medium" },
            reproduction_success_rate: 0.72,
            confidence_score: 0.81,
          },
        ],
      },
    });
    expect(prompt).toContain("Proven viral patterns for this channel");
    expect(prompt).toContain("personal_story_hook");
    expect(prompt).toContain("tone: conversational");
    expect(prompt).toContain("hooks: what if, imagine");
    expect(prompt).toContain("72% reproduction rate");
    expect(prompt).toContain("confidence 0.81");
  });

  it("renders the avoid-list section using AVOID phrasing, mapped through PATTERN_INSTRUCTIONS", () => {
    const prompt = kuzeUserPrompt({
      ...BASE,
      extras: { avoidWeights: "length_long: 0.62 (n=11)" },
    });
    expect(prompt).toContain("Underperforming patterns — avoid these");
    expect(prompt).toContain("AVOID — this pattern underperforms");
    expect(prompt).toContain("write a longer, more detailed body");
    expect(prompt).toContain("0.62× lift, n=11");
  });

  it("silently drops unrecognized pattern keys instead of rendering a broken line", () => {
    const prompt = kuzeUserPrompt({
      ...BASE,
      extras: { avoidWeights: "totally_unknown_key: 0.55 (n=3)" },
    });
    expect(prompt).not.toContain("Underperforming patterns");
  });

  it("orders sections: weights, then virality patterns, then avoid-list, before the final instruction", () => {
    const prompt = kuzeUserPrompt({
      ...BASE,
      extras: {
        weights: "has_cta: 1.4 (n=20)",
        viralityPatterns: [{ pattern_name: "stat_open" }],
        avoidWeights: "length_long: 0.6 (n=5)",
      },
    });
    const iWeights   = prompt.indexOf("High-performing content patterns");
    const iVirality  = prompt.indexOf("Proven viral patterns");
    const iAvoid     = prompt.indexOf("Underperforming patterns");
    const iFinal     = prompt.indexOf("Generate the tweet JSON now.");
    expect(iWeights).toBeGreaterThan(-1);
    expect(iVirality).toBeGreaterThan(iWeights);
    expect(iAvoid).toBeGreaterThan(iVirality);
    expect(iFinal).toBeGreaterThan(iAvoid);
  });

  it("renders the rejection-categories section, mapped through the category instruction lookup", () => {
    const prompt = kuzeUserPrompt({
      ...BASE,
      extras: { rejectionCategories: "competitor_mention: 4\noff_topic: 2" },
    });
    expect(prompt).toContain("Ilita has recently rejected content on this channel");
    expect(prompt).toContain("AVOID — mentioning competitor brands");
    expect(prompt).toContain("[4× rejected recently]");
    expect(prompt).toContain("AVOID — touching the operator-specified off-topics");
    expect(prompt).toContain("[2× rejected recently]");
  });

  it("omits the rejection-categories section when no extras are provided", () => {
    const prompt = kuzeUserPrompt(BASE);
    expect(prompt).not.toContain("Ilita has recently rejected");
  });

  it("places the rejection-categories section last, right before the final instruction", () => {
    const prompt = kuzeUserPrompt({
      ...BASE,
      extras: {
        avoidWeights: "length_long: 0.6 (n=5)",
        rejectionCategories: "off_topic: 3",
      },
    });
    const iAvoid     = prompt.indexOf("Underperforming patterns");
    const iRejection = prompt.indexOf("Ilita has recently rejected");
    const iFinal     = prompt.indexOf("Generate the tweet JSON now.");
    expect(iRejection).toBeGreaterThan(iAvoid);
    expect(iFinal).toBeGreaterThan(iRejection);
  });
});
