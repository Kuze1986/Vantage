import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  authState: {} as unknown,
  calls: [] as Array<{ url: URL; method?: string }>,
}));

vi.mock("../lib/supabase.js", () => {
  const sb = {
    from() {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        single: () => Promise.resolve({ data: { auth_state: h.authState }, error: null }),
        maybeSingle: () => Promise.resolve({ data: { auth_state: h.authState }, error: null }),
      };
      return chain;
    },
  };
  return { getSupabaseAdmin: () => sb, getSupabaseForSchema: () => sb, getSupabaseAnon: () => sb };
});
vi.mock("../lib/activity.js", () => ({ logActivity: vi.fn(async () => {}) }));

import { postInstagramCarousel } from "./instagram.js";

/** Params of the Nth captured request, minus the token. */
function paramsOf(i: number): Record<string, string> {
  const out: Record<string, string> = {};
  h.calls[i]!.url.searchParams.forEach((v, k) => {
    if (k !== "access_token") out[k] = v;
  });
  return out;
}

beforeEach(() => {
  h.calls.length = 0;
  h.authState = {
    tokens: {
      access_token: "tok",
      ig_user_id: "ig-1",
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    },
  };

  let containerSeq = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string, init?: { method?: string }) => {
    const url = input instanceof URL ? input : new URL(String(input));
    h.calls.push({ url, method: init?.method });
    if (url.searchParams.has("fields")) {
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ status_code: "FINISHED" }) };
    }
    if (url.pathname.endsWith("/media_publish")) {
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ id: "post-1" }) };
    }
    containerSeq += 1;
    return { ok: true, status: 200, headers: new Headers(), json: async () => ({ id: `c${containerSeq}` }) };
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("postInstagramCarousel", () => {
  it("creates one child per image, a CAROUSEL parent, then publishes", async () => {
    vi.useFakeTimers();
    const promise = postInstagramCarousel("ws-1", {
      imageUrls: ["https://cdn.test/1.png", "https://cdn.test/2.png", "https://cdn.test/3.png"],
      caption: "hello world",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toEqual({ id: "post-1" });

    // 3 children + 1 parent + >=1 status poll + 1 publish
    expect(h.calls.length).toBeGreaterThanOrEqual(6);

    // Children: is_carousel_item, no caption, and media_type omitted for images.
    for (let i = 0; i < 3; i++) {
      expect(paramsOf(i)).toEqual({
        image_url: `https://cdn.test/${i + 1}.png`,
        is_carousel_item: "true",
      });
      expect(h.calls[i]!.url.pathname).toMatch(/\/ig-1\/media$/);
      expect(h.calls[i]!.method).toBe("POST");
    }

    // Parent: CAROUSEL + comma-separated children + the caption.
    expect(paramsOf(3)).toEqual({
      media_type: "CAROUSEL",
      children: "c1,c2,c3",
      caption: "hello world",
    });

    // Publishes the parent container, not a child.
    const publish = h.calls.at(-1)!;
    expect(publish.url.pathname).toMatch(/\/ig-1\/media_publish$/);
    expect(publish.url.searchParams.get("creation_id")).toBe("c4");
  });

  it("waits for the parent container to finish before publishing", async () => {
    vi.useFakeTimers();
    const promise = postInstagramCarousel("ws-1", {
      imageUrls: ["https://cdn.test/1.png", "https://cdn.test/2.png"],
      caption: "c",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await promise;

    const statusIdx = h.calls.findIndex((c) => c.url.searchParams.get("fields") === "status_code");
    const publishIdx = h.calls.findIndex((c) => c.url.pathname.endsWith("/media_publish"));
    expect(statusIdx).toBeGreaterThan(-1);
    expect(statusIdx).toBeLessThan(publishIdx);
  });

  it("rejects counts outside Instagram's 2–10 range without calling the API", async () => {
    await expect(
      postInstagramCarousel("ws-1", { imageUrls: ["https://cdn.test/1.png"], caption: "c" }),
    ).rejects.toThrow("at least 2 images");

    const eleven = Array.from({ length: 11 }, (_, i) => `https://cdn.test/${i}.png`);
    await expect(
      postInstagramCarousel("ws-1", { imageUrls: eleven, caption: "c" }),
    ).rejects.toThrow("at most 10 images");

    expect(h.calls).toHaveLength(0);
  });

  it("surfaces a container failure instead of publishing a partial carousel", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: URL | string) => {
      const url = input instanceof URL ? input : new URL(String(input));
      h.calls.push({ url });
      return {
        ok: false, status: 400, headers: new Headers(),
        json: async () => ({ error: { message: "Media could not be fetched" } }),
      };
    }));

    await expect(
      postInstagramCarousel("ws-1", {
        imageUrls: ["https://cdn.test/1.png", "https://cdn.test/2.png"],
        caption: "c",
      }),
    ).rejects.toThrow("Media could not be fetched");

    // Stopped on the first child — never reached the parent or publish.
    expect(h.calls).toHaveLength(1);
  });
});
