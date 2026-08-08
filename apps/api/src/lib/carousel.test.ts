import { describe, expect, it } from "vitest";
import {
  CAROUSEL_MAX,
  carouselUrlsForChannel,
  parseCarouselUrls,
  supportsMultiImage,
} from "./carousel.js";

describe("parseCarouselUrls", () => {
  it("returns [] for missing or non-array payloads", () => {
    expect(parseCarouselUrls(null)).toEqual([]);
    expect(parseCarouselUrls(undefined)).toEqual([]);
    expect(parseCarouselUrls({})).toEqual([]);
    expect(parseCarouselUrls({ carousel_urls: "not-an-array" })).toEqual([]);
  });

  it("keeps order and drops non-strings and blanks", () => {
    expect(
      parseCarouselUrls({ carousel_urls: ["a", 1, "", "  ", null, "b", { url: "c" }] }),
    ).toEqual(["a", "b"]);
  });

  it("trims and de-duplicates so a slide can't render twice", () => {
    expect(parseCarouselUrls({ carousel_urls: ["a", " a ", "b", "a"] })).toEqual(["a", "b"]);
  });

  it("caps at the platform maximum", () => {
    const many = Array.from({ length: 25 }, (_, i) => `https://cdn.test/${i}.png`);
    expect(parseCarouselUrls({ carousel_urls: many })).toHaveLength(CAROUSEL_MAX);
  });
});

describe("supportsMultiImage", () => {
  it("covers the adapters that can actually post several images", () => {
    expect(supportsMultiImage("instagram")).toBe(true);
    expect(supportsMultiImage("facebook")).toBe(true);
  });

  it("excludes text-only and single-image adapters", () => {
    for (const slug of ["x", "linkedin", "threads", "bluesky", "tiktok", "reddit", "email"]) {
      expect(supportsMultiImage(slug)).toBe(false);
    }
  });
});

describe("carouselUrlsForChannel", () => {
  const payload = { carousel_urls: ["https://cdn.test/1.png", "https://cdn.test/2.png"] };

  it("returns the slides for a supported channel", () => {
    expect(carouselUrlsForChannel("instagram", payload)).toHaveLength(2);
    expect(carouselUrlsForChannel("facebook", payload)).toHaveLength(2);
  });

  it("returns nothing for a channel whose adapter can't post multiple images", () => {
    expect(carouselUrlsForChannel("x", payload)).toEqual([]);
    expect(carouselUrlsForChannel("linkedin", payload)).toEqual([]);
  });

  it("defers to video — a rendered piece posts as a Reel, not a slide deck", () => {
    expect(carouselUrlsForChannel("instagram", payload, "https://cdn.test/v.mp4")).toEqual([]);
    expect(carouselUrlsForChannel("instagram", payload, null)).toHaveLength(2);
    expect(carouselUrlsForChannel("instagram", payload, "")).toHaveLength(2);
  });

  it("falls through to single-image below the two-slide minimum", () => {
    expect(carouselUrlsForChannel("instagram", { carousel_urls: ["https://cdn.test/1.png"] })).toEqual([]);
    // A duplicate collapses to one entry, so it is not a carousel either.
    expect(carouselUrlsForChannel("instagram", { carousel_urls: ["https://a.png", "https://a.png"] })).toEqual([]);
  });
});
