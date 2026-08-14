import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const maybeSingleMock = vi.fn();

vi.mock("./supabase.js", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: maybeSingleMock,
          }),
        }),
      }),
    }),
  }),
}));

const loadProductProfileMock = vi.fn();
vi.mock("./product-profile.js", () => ({
  loadProductProfile: (...args: unknown[]) => loadProductProfileMock(...args),
}));

const { resolveDestination, appendDestination } = await import("./destination.js");

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingleMock.mockResolvedValue({ data: null });
  loadProductProfileMock.mockResolvedValue({
    default_product_id: "shift",
    product_base_url: "https://theshift.bioloopnexus.com",
    default_brand_id: "shift",
    default_demoforge_template_id: "",
    default_brand_kit_id: "",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("destination / resolveDestination", () => {
  it("falls back to the workspace product profile with no campaign", async () => {
    const out = await resolveDestination("ws-1", "x");
    expect(out).toEqual({ url: "https://theshift.bioloopnexus.com", policy: "inline" });
  });

  it("prefers the campaign's own destination_url when set", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { destination_url: "https://demogate.example.com/demo" } });
    const out = await resolveDestination("ws-1", "linkedin", "camp-1");
    expect(out.url).toBe("https://demogate.example.com/demo");
    expect(loadProductProfileMock).not.toHaveBeenCalled();
  });

  it("falls back to the product profile when the campaign has no override", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { destination_url: null } });
    const out = await resolveDestination("ws-1", "x", "camp-1");
    expect(out.url).toBe("https://theshift.bioloopnexus.com");
  });

  it("returns bio policy untouched for tiktok/instagram", async () => {
    const tiktok = await resolveDestination("ws-1", "tiktok");
    const instagram = await resolveDestination("ws-1", "instagram");
    expect(tiktok.policy).toBe("bio");
    expect(instagram.policy).toBe("bio");
  });

  it("degrades to no link when nothing is configured", async () => {
    loadProductProfileMock.mockResolvedValueOnce({
      default_product_id: "shift",
      product_base_url: "",
      default_brand_id: "shift",
      default_demoforge_template_id: "",
      default_brand_kit_id: "",
    });
    const out = await resolveDestination("ws-1", "x");
    expect(out.url).toBeNull();
  });

  it("degrades to no link rather than ship a typo'd host", async () => {
    // Same comma-for-dot failure target-url.ts exists to catch on the DemoForge
    // recording path — a destination link gets the same protection, because a
    // dead link inside a published post can't be edited after the fact.
    loadProductProfileMock.mockResolvedValueOnce({
      default_product_id: "shift",
      product_base_url: "https://theshift,bioloopnexus.com",
      default_brand_id: "shift",
      default_demoforge_template_id: "",
      default_brand_kit_id: "",
    });
    const out = await resolveDestination("ws-1", "x");
    expect(out.url).toBeNull();
  });
});

describe("destination / appendDestination", () => {
  it("appends the URL to body on an inline-policy channel", () => {
    const out = appendDestination(
      { body: "Some tweet text" },
      { url: "https://theshift.bioloopnexus.com/try", policy: "inline" },
    );
    expect(out.body).toBe("Some tweet text\n\nhttps://theshift.bioloopnexus.com/try");
  });

  it("does nothing when policy is bio", () => {
    const payload = { body: "TikTok caption", hook: "hook" };
    const out = appendDestination(payload, { url: "https://x.example.com", policy: "bio" });
    expect(out).toBe(payload);
  });

  it("does nothing when url is null", () => {
    const payload = { body: "text" };
    const out = appendDestination(payload, { url: null, policy: "inline" });
    expect(out).toBe(payload);
  });

  it("does nothing when body is missing or not a string", () => {
    const payload = { title: "no body field" };
    const out = appendDestination(payload, { url: "https://example.com", policy: "inline" });
    expect(out).toBe(payload);
  });

  it("does not double up a link the model already wrote", () => {
    const payload = { body: "Check it out: https://theshift.bioloopnexus.com/try" };
    const out = appendDestination(payload, { url: "https://theshift.bioloopnexus.com/try", policy: "inline" });
    expect(out).toBe(payload);
    expect((out.body as string).match(/theshift\.bioloopnexus\.com/g)).toHaveLength(1);
  });

  it("leaves other payload fields untouched", () => {
    const out = appendDestination(
      { body: "text", hashtags: ["a", "b"], alt_text: "alt" },
      { url: "https://example.com", policy: "inline" },
    );
    expect(out.hashtags).toEqual(["a", "b"]);
    expect(out.alt_text).toBe("alt");
  });
});
