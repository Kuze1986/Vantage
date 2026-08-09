import { describe, expect, it } from "vitest";
import { kuzeSystemPrompt, kuzeUserPrompt, renderBrandVoice, parseBrandVoice } from "@vantage/prompts";

// The real shape, trimmed. per_channel_tone carries all nine channels.
const BRAND_VOICE = JSON.stringify({
  name: "NEXUS Intro",
  description:
    "The voice is Brandon's voice — direct, systems-minded, and credible. No hype. No startup clichés. " +
    "No generic motivational content. When we talk about The Shift, we talk about readiness simulation — not \"a quiz app.\"",
  per_channel_tone: {
    x: "Punchy and precise. Lead with the operational truth. If there's a hook, it's observational, not clickbait.",
    linkedin:
      "Lead with an observation or a real problem statement — not a question-bait opener. " +
      "No buzzwords. No \"I'm excited to announce.\" No engagement-bait questions at the end.",
    instagram: "Visual-first context. The caption supports the image — it doesn't repeat it.",
  },
  off_topics: ["Competitor promotions", "Guaranteed outcomes or placement rates"],
});

describe("kuze brand voice / precedence", () => {
  it("puts the brand voice in the system prompt, where it outranks the defaults", () => {
    const sys = kuzeSystemPrompt("linkedin_post", { brandVoice: BRAND_VOICE, channel: "linkedin" });
    expect(sys).toContain("No hype. No startup clichés.");
    expect(sys).toContain("AUTHORITATIVE");
    expect(sys).toMatch(/brand voice wins/i);
  });

  it("sends only the target channel's tone, not all nine as raw JSON", () => {
    const sys = kuzeSystemPrompt("linkedin_post", { brandVoice: BRAND_VOICE, channel: "linkedin" });
    expect(sys).toContain("not a question-bait opener");
    // The X and Instagram tones must not be in a LinkedIn prompt.
    expect(sys).not.toContain("Punchy and precise");
    expect(sys).not.toContain("Visual-first context");
  });

  it("no longer asserts a hard-coded product identity that contradicts the config", () => {
    const sys = kuzeSystemPrompt("tweet", { brandVoice: BRAND_VOICE, channel: "x" });
    // The old prompt claimed NEXUS was "a suite of online certification prep
    // products" with "education-first energy" — a different product and register
    // from the operator's brand voice, asserted at system level where it won.
    expect(sys).not.toMatch(/certification prep products/i);
    expect(sys).not.toMatch(/education-first energy/i);
  });

  it("drops the format rules that manufactured the rejected copy", () => {
    const linkedin = kuzeSystemPrompt("linkedin_post");
    // Brand voice forbids exactly these; the built-in rules used to demand them.
    expect(linkedin).not.toMatch(/End with a question/i);
    expect(linkedin).not.toMatch(/bold claim or surprising stat/i);

    const facebook = kuzeSystemPrompt("facebook_post");
    expect(facebook).not.toMatch(/Open with a question/i);
  });

  it("labels the remaining defaults as yielding to brand voice", () => {
    for (const format of ["tweet", "linkedin_post", "facebook_post", "instagram_caption"] as const) {
      expect(kuzeSystemPrompt(format)).toContain("yield to brand voice");
    }
  });

  it("names the cliches the reviewer actually rejects", () => {
    const sys = kuzeSystemPrompt("tweet", { brandVoice: BRAND_VOICE, channel: "x" });
    for (const phrase of ["seamless", "innovative", "excited to announce", "engagement-bait"]) {
      expect(sys.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });

  it("carries the off-topics through", () => {
    const sys = kuzeSystemPrompt("tweet", { brandVoice: BRAND_VOICE, channel: "x" });
    expect(sys).toContain("Guaranteed outcomes or placement rates");
  });

  it("keeps the output schema hard while the tone is soft", () => {
    const sys = kuzeSystemPrompt("instagram_caption", { brandVoice: BRAND_VOICE, channel: "instagram" });
    expect(sys).toContain('"hashtags"');
    expect(sys).toContain('"alt_text"');
    expect(sys).toMatch(/not negotiable/i);
  });
});

describe("kuze brand voice / user prompt", () => {
  it("restates the channel tone next to the topic instead of the whole blob", () => {
    const user = kuzeUserPrompt({
      format: "linkedin_post",
      topic_text: "The Shift is live",
      vertical: null,
      brand_voice: BRAND_VOICE,
      channel: "linkedin",
    });
    expect(user).toContain("not a question-bait opener");
    // The raw JSON dump is gone.
    expect(user).not.toContain('"per_channel_tone"');
    expect(user).not.toContain("Punchy and precise");
  });

  it("passes an unparseable brand voice through rather than dropping it", () => {
    const user = kuzeUserPrompt({
      format: "tweet",
      topic_text: "t",
      vertical: null,
      brand_voice: "plain text voice guidance",
      channel: "x",
    });
    expect(user).toContain("plain text voice guidance");
  });
});

describe("kuze brand voice / renderer", () => {
  it("returns raw input when the payload is not JSON", () => {
    expect(renderBrandVoice("just a string", "x")).toBe("just a string");
  });

  it("handles a missing channel tone without dropping the rest", () => {
    const out = renderBrandVoice(BRAND_VOICE, "tiktok");
    expect(out).toContain("No hype. No startup clichés.");
    expect(out).not.toContain("Tone for this channel");
  });

  it("parses and rejects non-object payloads", () => {
    expect(parseBrandVoice("[1,2]")).toBeNull();
    expect(parseBrandVoice("nope")).toBeNull();
    expect(parseBrandVoice(null)).toBeNull();
    expect(parseBrandVoice(BRAND_VOICE)?.name).toBe("NEXUS Intro");
  });
});
