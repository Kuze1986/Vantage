import { describe, expect, it } from "vitest";
import { channelAuthMethod, supportsOAuthConnect, CREDENTIAL_CHANNELS } from "./channel-auth.js";
import { MANUAL_PUBLISH_CHANNELS } from "./publish-pack.js";

describe("channel-auth", () => {
  it("classifies the three auth methods", () => {
    expect(channelAuthMethod("x")).toBe("oauth");
    expect(channelAuthMethod("linkedin")).toBe("oauth");
    expect(channelAuthMethod("threads")).toBe("oauth");
    expect(channelAuthMethod("bluesky")).toBe("api_key");
    expect(channelAuthMethod("email")).toBe("api_key");
    expect(channelAuthMethod("reddit")).toBe("manual");
  });

  it("treats TikTok, Instagram and Facebook as OAuth, not manual", () => {
    // These three were manual historically. The DB's channels.auth_method column
    // still reads 'manual' for workspaces seeded before they went live — deriving
    // from MANUAL_PUBLISH_CHANNELS is what stops that stale row reaching the UI.
    for (const slug of ["tiktok", "instagram", "facebook"]) {
      expect(channelAuthMethod(slug)).toBe("oauth");
      expect(supportsOAuthConnect(slug)).toBe(true);
    }
  });

  it("stays in step with MANUAL_PUBLISH_CHANNELS", () => {
    // The invariant that makes this module trustworthy: manual-ness is never
    // stated independently of the set the pipeline obeys. Adding a slug there
    // must flip this without any other edit.
    for (const slug of MANUAL_PUBLISH_CHANNELS) {
      expect(channelAuthMethod(slug)).toBe("manual");
      expect(supportsOAuthConnect(slug)).toBe(false);
    }
  });

  it("never offers an OAuth connect button for manual or credential channels", () => {
    expect(supportsOAuthConnect("reddit")).toBe(false);
    for (const slug of CREDENTIAL_CHANNELS) {
      expect(supportsOAuthConnect(slug)).toBe(false);
    }
  });

  it("defaults an unknown slug to oauth rather than silently hiding it", () => {
    // A new channel added to the seed but not to either set should surface a
    // Connect button, not disappear from the API-channel list.
    expect(channelAuthMethod("some-new-network")).toBe("oauth");
    expect(supportsOAuthConnect("some-new-network")).toBe(true);
  });
});
