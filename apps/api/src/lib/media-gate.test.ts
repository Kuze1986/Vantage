import { describe, expect, it } from "vitest";
import {
  assertMediaReady,
  isMediaForced,
  isMediaGated,
  withForceMedia,
} from "./media-gate.js";

describe("media-gate", () => {
  it("gates pending and failed media", () => {
    expect(isMediaGated({ media_status: "pending" })).toBe(true);
    expect(isMediaGated({ media_status: "failed" })).toBe(true);
    expect(isMediaGated({ media_status: "ready" })).toBe(false);
    expect(isMediaGated({ media_status: "none" })).toBe(false);
  });

  it("gates social kit without image", () => {
    expect(
      isMediaGated({
        media_status: "none",
        content_payload: { needs_social_kit: true },
      }),
    ).toBe(true);
    expect(
      isMediaGated({
        media_status: "none",
        image_url: "https://example.com/x.png",
        content_payload: { needs_social_kit: true },
      }),
    ).toBe(false);
  });

  it("honors force_media stamp", () => {
    const piece = {
      media_status: "pending",
      content_payload: { force_media: true },
    };
    expect(isMediaForced(piece)).toBe(true);
    expect(isMediaGated(piece)).toBe(false);
    expect(() => assertMediaReady(piece)).not.toThrow();
  });

  it("withForceMedia stamps payload", () => {
    expect(withForceMedia({ a: 1 }, true)).toEqual({ a: 1, force_media: true });
    expect(withForceMedia(null, false)).toEqual({});
  });
});
