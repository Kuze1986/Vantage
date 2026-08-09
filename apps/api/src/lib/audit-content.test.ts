import { describe, expect, it } from "vitest";
import { AUDIT_MAX_CHARS, renderForAudit, renderPayloadForAudit } from "./audit-content.js";

describe("audit-content / the production failures", () => {
  it("shows a 305-char Facebook body in full", () => {
    // Rejected in production for "cuts off mid-sentence". It did not — the
    // reviewer was handed a 200-character slice.
    const body = "A".repeat(305);
    const out = renderForAudit({ text: body, instructions: "Post to the page" });
    expect(out).toContain(body);
    expect(out.length).toBeGreaterThan(305);
  });

  it("shows hashtags and alt text that a caption-only render hid", () => {
    // Rejected for "does not include a hashtag block and no alt text is
    // present" while carrying both.
    const out = renderForAudit({
      caption: "The Shift is here.",
      hashtags: ["#workforce", "#readiness"],
      alt_text: "A queue of seven mini-games",
    });
    expect(out).toContain("Hashtags: #workforce #readiness");
    expect(out).toContain("Alt text: A queue of seven mini-games");
  });

  it("shows the whole TikTok script, not the first 200 characters", () => {
    const script = "B".repeat(539);
    const out = renderForAudit({ hook: "Guesswork costs you", script, on_screen_text: "DEPLOY" });
    expect(out).toContain(script);
    expect(out).toContain("Hook: Guesswork costs you");
    expect(out).toContain("On-screen text: DEPLOY");
  });
});

describe("audit-content / rendering", () => {
  it("orders fields the way a reviewer reads them", () => {
    const out = renderPayloadForAudit({ body: "b", headline: "h", title: "t" });
    expect(out.indexOf("Title:")).toBeLessThan(out.indexOf("Headline:"));
    expect(out.indexOf("Headline:")).toBeLessThan(out.indexOf("Body:"));
  });

  it("renders email's subject and preview text", () => {
    const out = renderPayloadForAudit({
      subject: "Seven mini-games",
      preview_text: "One deploy",
      body: "<p>hi</p>",
    });
    expect(out).toContain("Subject line: Seven mini-games");
    expect(out).toContain("Preview text: One deploy");
  });

  it("renders booleans readably", () => {
    expect(renderPayloadForAudit({ title: "t", is_link_post: true })).toContain("Link post: yes");
    expect(renderPayloadForAudit({ title: "t", is_link_post: false })).toContain("Link post: no");
  });

  it("omits plumbing that would be noise in an audit", () => {
    const out = renderPayloadForAudit({
      body: "real copy",
      image_url: "https://x/a.png",
      video_url: "https://x/a.mp4",
      demoforge_job_id: "job-1",
      visual_type: "demo_video",
      needs_social_kit: true,
    });
    expect(out).toBe("Body: real copy");
  });

  it("skips empty and whitespace-only fields", () => {
    const out = renderPayloadForAudit({ body: "real", headline: "   ", alt_text: "" });
    expect(out).toBe("Body: real");
  });

  it("skips an empty hashtag array rather than printing a bare label", () => {
    expect(renderPayloadForAudit({ body: "b", hashtags: [] })).toBe("Body: b");
  });

  it("falls back to whole-payload JSON for an unrecognised shape", () => {
    // A new format should be reviewed imperfectly, never reviewed blind.
    const out = renderPayloadForAudit({ some_new_field: "value" });
    expect(out).toContain("some_new_field");
  });

  it("returns empty string for a missing payload", () => {
    expect(renderPayloadForAudit(null)).toBe("");
    expect(renderPayloadForAudit(undefined)).toBe("");
  });
});

describe("audit-content / length cap", () => {
  it("does not touch anything within budget", () => {
    const out = renderForAudit({ body: "C".repeat(1000) });
    expect(out).not.toContain("Truncated by Vantage");
  });

  it("tells the reviewer when we shortened it, so our cut is not read as the model's", () => {
    const out = renderForAudit({ body: "D".repeat(AUDIT_MAX_CHARS + 500) });
    expect(out).toContain("Truncated by Vantage");
    expect(out).toContain("the piece itself is complete");
    expect(out).toContain("Do not fail this for appearing cut off");
  });
});
