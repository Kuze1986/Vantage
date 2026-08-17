import { describe, it, expect } from "vitest";
import { tagPayloadUrls } from "./utm.js";
import { validateFinalPayload } from "./campaign-quality.js";

const CAMPAIGN = "b33a5bc6-b810-4dce-acbe-fd19e29b9ee2";
const PIECE = "003d8b50-d263-4d12-9054-a4311fe16fb4";
const ASSET = "https://cdn.example.com/uploads/queue.gif";

describe("tagPayloadUrls", () => {
  it("tags the click destination in the body", () => {
    const { payload, changed } = tagPayloadUrls(
      { body: "Start a deploy.\n\nhttps://theshift.example.com" },
      "instagram", PIECE, CAMPAIGN,
    );
    expect(changed).toBe(true);
    expect(String(payload.body)).toContain("utm_source=instagram");
  });

  it("leaves media URLs untouched", () => {
    // The regression: every string field was tagged, so the stored asset URL
    // became "...queue.gif?utm_source=instagram&..." — meaningless on a URL the
    // platform's ingest fetches, and rejected outright by CDNs that validate
    // their query string.
    const { payload } = tagPayloadUrls(
      { image_url: ASSET, video_url: "https://cdn.example.com/a.mp4", body: "see https://theshift.example.com" },
      "instagram", PIECE, CAMPAIGN,
    );
    expect(payload.image_url).toBe(ASSET);
    expect(payload.video_url).toBe("https://cdn.example.com/a.mp4");
    expect(String(payload.body)).toContain("utm_source=");
  });

  it("reports unchanged when there is nothing to tag", () => {
    const { changed } = tagPayloadUrls({ image_url: ASSET, body: "no link here" }, "x", PIECE, CAMPAIGN);
    expect(changed).toBe(false);
  });

  it("passes non-string fields through", () => {
    const { payload } = tagPayloadUrls(
      { hashtags: ["a", "b"], carousel_urls: [ASSET], body: "x" },
      "instagram", PIECE, CAMPAIGN,
    );
    expect(payload.hashtags).toEqual(["a", "b"]);
    expect(payload.carousel_urls).toEqual([ASSET]);
  });
});

describe("instagram GIF guard", () => {
  const base = { body: "caption", hashtags: ["a", "b", "c"], alt_text: "alt" };

  it("rejects a GIF before it reaches the publish call", () => {
    const r = validateFinalPayload("instagram", { ...base, image_url: ASSET });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/cannot publish GIF/i);
  });

  it("rejects a GIF carrying a query string", () => {
    const r = validateFinalPayload("instagram", { ...base, image_url: `${ASSET}?v=2` });
    expect(r.valid).toBe(false);
  });

  it("accepts a JPEG", () => {
    const r = validateFinalPayload("instagram", { ...base, image_url: "https://cdn.example.com/queue.jpg" });
    expect(r.valid).toBe(true);
  });

  it("rejects PNG, which Instagram also refuses for a feed image", () => {
    const r = validateFinalPayload("instagram", { ...base, image_url: "https://cdn.example.com/queue.png" });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/cannot publish PNG/i);
  });

  it("rejects a 9:16 still as too tall for the feed", () => {
    // 1080x1920 is the natural output of a phone-viewport capture and is
    // 0.5625 — below Instagram's 4:5 floor. It was accepted at container
    // create and then failed at publish with "Media ID is not available".
    const r = validateFinalPayload("instagram", {
      ...base,
      image_url: "https://cdn.example.com/drop-03.jpg",
      image_dimensions: { width: 1080, height: 1920 },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/between 4:5 and 1.91:1/);
    expect(r.errors.join(" ")).toMatch(/1080x1350/);
  });

  it("accepts a 4:5 still", () => {
    const r = validateFinalPayload("instagram", {
      ...base,
      image_url: "https://cdn.example.com/drop-03.jpg",
      image_dimensions: { width: 1080, height: 1350 },
    });
    expect(r.valid).toBe(true);
  });

  it("accepts a square still", () => {
    const r = validateFinalPayload("instagram", {
      ...base,
      image_url: "https://cdn.example.com/q.jpg",
      image_dimensions: { width: 1080, height: 1080 },
    });
    expect(r.valid).toBe(true);
  });

  it("does not constrain other channels", () => {
    const r = validateFinalPayload("facebook", { body: "post", image_url: ASSET });
    expect(r.valid).toBe(true);
  });
});
