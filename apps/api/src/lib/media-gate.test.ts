import { describe, expect, it } from "vitest";
import {
  assertMediaReady,
  isMediaForced,
  isMediaGated,
  mediaGateReason,
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

  describe("mediaGateReason", () => {
    it("reports the Social Kit reason for a social_graphic piece, not the generic DemoForge message", () => {
      // campaigns.ts initializes media_status="pending" for every non-"none" visual_type,
      // including social_graphic — so this exact combination (pending + needs_social_kit)
      // is the normal state of every unattached social-graphic piece, not an edge case.
      const piece = { media_status: "pending", content_payload: { needs_social_kit: true } };
      expect(mediaGateReason(piece)).toBe("Social Kit graphic required — attach an image or use force");
    });

    it("falls through to the DemoForge message once the Social Kit image is attached", () => {
      const piece = {
        media_status: "pending",
        image_url: "https://example.com/x.png",
        content_payload: { needs_social_kit: true },
      };
      expect(mediaGateReason(piece)).toBe("Media is still pending (DemoForge / upload)");
    });

    it("reports the DemoForge message for a plain pending piece with no social kit need", () => {
      expect(mediaGateReason({ media_status: "pending" })).toBe("Media is still pending (DemoForge / upload)");
    });

    it("reports the failed message", () => {
      expect(mediaGateReason({ media_status: "failed" })).toBe("Media generation failed — fix media or use force");
    });
  });
});
