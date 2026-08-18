import { describe, expect, it } from "vitest";
import {
  assembleGallery,
  inferKind,
  itemsFromBrandKit,
  itemsFromClip,
  itemsFromJob,
  itemsFromPiece,
  type MediaItem,
} from "./media-gallery.js";

const AT = "2026-08-01T10:00:00Z";

describe("media-gallery / inferKind", () => {
  it("recognises video extensions, including with a query string", () => {
    expect(inferKind("https://x/a.mp4")).toBe("video");
    expect(inferKind("https://x/a.mov?token=1")).toBe("video");
    expect(inferKind("https://x/a.webm")).toBe("video");
    expect(inferKind("https://x/a.png")).toBe("image");
    expect(inferKind("https://x/a")).toBe("image");
  });
});

describe("media-gallery / itemsFromPiece", () => {
  it("pulls hero, video, og, carousel and mode stills off one piece", () => {
    const items = itemsFromPiece({
      id: "p1",
      channel_slug: "instagram",
      image_url: "https://x/hero.png",
      video_url: "https://x/reel.mp4",
      created_at: AT,
      content_payload: {
        og_image_url: "https://x/og.png",
        carousel_urls: ["https://x/hero.png", "https://x/s2.png", "https://x/s3.png"],
        mode_stills: [{ mode: "sweep", url: "https://x/sweep.png" }],
      },
    });
    const urls = items.map((i) => i.url);
    expect(urls).toContain("https://x/reel.mp4");
    expect(urls).toContain("https://x/og.png");
    expect(urls).toContain("https://x/s2.png");
    expect(urls).toContain("https://x/sweep.png");
    // Slide 01 is mirrored onto image_url by the builder — listed once, as the hero.
    expect(urls.filter((u) => u === "https://x/hero.png")).toHaveLength(1);
    expect(items.every((i) => i.piece_id === "p1" && i.source === "piece")).toBe(true);
  });

  it("uses the hero image as the video's poster", () => {
    const [video] = itemsFromPiece({
      id: "p1", channel_slug: "tiktok",
      image_url: "https://x/cover.png", video_url: "https://x/v.mp4",
    });
    expect(video).toMatchObject({ kind: "video", thumbnail_url: "https://x/cover.png" });
  });

  it("returns nothing for a piece with no media", () => {
    expect(itemsFromPiece({ id: "p1", content_payload: { body: "text only" } })).toEqual([]);
  });

  it("ignores malformed carousel and mode_still entries", () => {
    const items = itemsFromPiece({
      id: "p1",
      content_payload: { carousel_urls: [null, 42, "  "], mode_stills: [{ mode: "x" }, "nope", null] },
    });
    expect(items).toEqual([]);
  });
});

describe("media-gallery / itemsFromJob", () => {
  it("pulls render, cover and keyframes, skipping the frame reused as cover", () => {
    const items = itemsFromJob({
      id: "j1", content_piece_id: "p9", target_format: "tiktok",
      output_url: "https://x/out.mp4", thumbnail_url: "https://x/f2.png",
      extracted_frames: ["https://x/f1.png", "https://x/f2.png"],
      created_at: AT,
    });
    const urls = items.map((i) => i.url);
    expect(urls).toEqual(["https://x/out.mp4", "https://x/f2.png", "https://x/f1.png"]);
    expect(items[0]).toMatchObject({ kind: "video", thumbnail_url: "https://x/f2.png", job_id: "j1", piece_id: "p9" });
  });

  it("accepts frames stored as objects as well as bare strings", () => {
    const items = itemsFromJob({
      id: "j1", extracted_frames: [{ url: "https://x/f1.png" }, { nope: 1 }],
    });
    expect(items.map((i) => i.url)).toEqual(["https://x/f1.png"]);
  });
});

describe("media-gallery / brand kits and clips", () => {
  it("skips a brand kit with no logo", () => {
    expect(itemsFromBrandKit({ id: "k1", name: "Shift" })).toEqual([]);
  });

  it("resolves a clip's storage path to a public URL", () => {
    const [item] = itemsFromClip(
      { id: "c1", name: "Outro", type: "outro", storage_path: "clips/outro.mp4", preview_url: "https://x/p.gif" },
      (p) => `https://cdn/${p}`,
    );
    expect(item).toMatchObject({
      url: "https://cdn/clips/outro.mp4",
      kind: "video",
      thumbnail_url: "https://x/p.gif",
      source: "clip",
    });
  });

  it("falls back to the preview when a clip has no storage path", () => {
    const [item] = itemsFromClip({ id: "c1", preview_url: "https://x/p.gif" }, (p) => `https://cdn/${p}`);
    expect(item).toMatchObject({ url: "https://x/p.gif", kind: "image" });
  });
});

describe("media-gallery / assembleGallery", () => {
  const mk = (over: Partial<MediaItem>): MediaItem => ({
    id: "i", kind: "image", url: "https://x/a.png", thumbnail_url: null,
    label: "a", source: "piece", piece_id: null, job_id: null, created_at: AT, vertical: null, ...over,
  });

  it("sorts newest first and sends undated items last", () => {
    const out = assembleGallery(
      [
        mk({ id: "old", url: "https://x/1.png", created_at: "2026-01-01T00:00:00Z" }),
        mk({ id: "none", url: "https://x/2.png", created_at: null }),
        mk({ id: "new", url: "https://x/3.png", created_at: "2026-08-08T00:00:00Z" }),
      ],
      { limit: 10, offset: 0 },
    );
    expect(out.items.map((i) => i.id)).toEqual(["new", "old", "none"]);
  });

  it("de-dupes by URL so a job cover shared with its piece appears once", () => {
    const out = assembleGallery(
      [
        mk({ id: "job", url: "https://x/same.png", source: "demoforge" }),
        mk({ id: "piece", url: "https://x/same.png", source: "piece" }),
      ],
      { limit: 10, offset: 0 },
    );
    expect(out.items).toHaveLength(1);
    expect(out.total).toBe(1);
  });

  it("filters by source and kind", () => {
    const all = [
      mk({ url: "https://x/1.png", source: "piece", kind: "image" }),
      mk({ url: "https://x/2.mp4", source: "piece", kind: "video" }),
      mk({ url: "https://x/3.png", source: "brand_kit", kind: "image" }),
    ];
    expect(assembleGallery(all, { source: "piece", limit: 10, offset: 0 }).items).toHaveLength(2);
    expect(assembleGallery(all, { kind: "video", limit: 10, offset: 0 }).items).toHaveLength(1);
    expect(assembleGallery(all, { source: "piece", kind: "image", limit: 10, offset: 0 }).items).toHaveLength(1);
  });

  it("pages and reports next_offset, null on the last page", () => {
    const all = Array.from({ length: 5 }, (_, i) =>
      mk({ url: `https://x/${i}.png`, created_at: `2026-08-0${5 - i}T00:00:00Z` }),
    );
    const first = assembleGallery(all, { limit: 2, offset: 0 });
    expect(first.items).toHaveLength(2);
    expect(first.next_offset).toBe(2);
    expect(first.total).toBe(5);

    const last = assembleGallery(all, { limit: 2, offset: 4 });
    expect(last.items).toHaveLength(1);
    expect(last.next_offset).toBeNull();
  });
});
