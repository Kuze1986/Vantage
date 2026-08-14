import { describe, it, expect } from "vitest";
import { planChunks, validatePostSettings, TIKTOK_TITLE_MAX, type TikTokCreatorInfo, type TikTokPostSettings } from "./tiktok.js";

const MB = 1024 * 1024;

function creator(over: Partial<TikTokCreatorInfo> = {}): TikTokCreatorInfo {
  return {
    creator_avatar_url: "", creator_username: "u", creator_nickname: "N",
    privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
    comment_disabled: false, duet_disabled: false, stitch_disabled: false,
    max_video_post_duration_sec: 600,
    ...over,
  };
}

function settings(over: Partial<TikTokPostSettings> = {}): TikTokPostSettings {
  return { title: "hello", privacy_level: "PUBLIC_TO_EVERYONE", ...over };
}

describe("planChunks — TikTok FILE_UPLOAD limits", () => {
  it("uploads a sub-5MB video as a single whole-file chunk", () => {
    expect(planChunks(3 * MB)).toEqual({ chunkSize: 3 * MB, totalChunks: 1 });
  });

  it("does NOT send an oversized single chunk for a large video", () => {
    // The pre-fix bug: chunk_size === video_size for everything.
    const plan = planChunks(80 * MB);
    expect(plan.chunkSize).toBeLessThanOrEqual(64 * MB);
    expect(plan.chunkSize).toBeGreaterThanOrEqual(5 * MB);
    expect(plan.totalChunks).toBeGreaterThan(1);
  });

  it("keeps every chunk inside 5–64MB and never exceeds 1000 chunks", () => {
    for (const size of [5 * MB, 12 * MB, 500 * MB, 3 * 1024 * MB]) {
      const { chunkSize, totalChunks } = planChunks(size);
      expect(chunkSize).toBeGreaterThanOrEqual(5 * MB);
      expect(chunkSize).toBeLessThanOrEqual(64 * MB);
      expect(totalChunks).toBeLessThanOrEqual(1000);
      expect(totalChunks).toBe(Math.floor(size / chunkSize));
    }
  });

  it("covers the whole file — the final chunk absorbs the remainder", () => {
    const size = 33 * MB + 7;
    const { chunkSize, totalChunks } = planChunks(size);
    const lastChunkEnd = (totalChunks - 1) * chunkSize + (size - (totalChunks - 1) * chunkSize);
    expect(lastChunkEnd).toBe(size);
  });

  it("rejects an empty video and one over 4GB", () => {
    expect(() => planChunks(0)).toThrow();
    expect(() => planChunks(5 * 1024 * MB)).toThrow(/4 GB/);
  });
});

describe("validatePostSettings — Content Posting API guideline rules", () => {
  it("requires an explicit privacy level (no default is permitted)", () => {
    expect(() => validatePostSettings(settings({ privacy_level: "" }), creator()))
      .toThrow(/privacy level must be chosen/i);
  });

  it("rejects a privacy level the account no longer permits", () => {
    const c = creator({ privacy_level_options: ["SELF_ONLY"] });
    expect(() => validatePostSettings(settings({ privacy_level: "PUBLIC_TO_EVERYONE" }), c))
      .toThrow(/no longer permitted/);
  });

  it("refuses branded content with SELF_ONLY visibility", () => {
    const s = settings({ privacy_level: "SELF_ONLY", brand_content_toggle: true });
    expect(() => validatePostSettings(s, creator())).toThrow(/cannot be posted with SELF_ONLY/);
  });

  it("allows branded content when the post is public", () => {
    const s = settings({ privacy_level: "PUBLIC_TO_EVERYONE", brand_content_toggle: true });
    expect(() => validatePostSettings(s, creator())).not.toThrow();
  });

  it("allows promotional (Your Brand) content privately — only branded content is restricted", () => {
    const s = settings({ privacy_level: "SELF_ONLY", brand_organic_toggle: true });
    expect(() => validatePostSettings(s, creator())).not.toThrow();
  });

  it("refuses to enable an interaction the creator has disabled", () => {
    expect(() => validatePostSettings(settings({ disable_comment: false }), creator({ comment_disabled: true })))
      .toThrow(/comments disabled/);
    expect(() => validatePostSettings(settings({ disable_duet: false }), creator({ duet_disabled: true })))
      .toThrow(/duet disabled/);
    expect(() => validatePostSettings(settings({ disable_stitch: false }), creator({ stitch_disabled: true })))
      .toThrow(/stitch disabled/);
  });

  it("enforces the 2200-rune caption limit", () => {
    expect(() => validatePostSettings(settings({ title: "x".repeat(TIKTOK_TITLE_MAX + 1) }), creator()))
      .toThrow(/exceeds/);
    expect(() => validatePostSettings(settings({ title: "x".repeat(TIKTOK_TITLE_MAX) }), creator()))
      .not.toThrow();
  });

  it("validates without creator info when it could not be fetched", () => {
    expect(() => validatePostSettings(settings())).not.toThrow();
    expect(() => validatePostSettings(settings({ privacy_level: "SELF_ONLY", brand_content_toggle: true })))
      .toThrow(/SELF_ONLY/);
  });
});
