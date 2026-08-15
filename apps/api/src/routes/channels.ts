import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { channelAuthMethod, supportsOAuthConnect } from "../lib/channel-auth.js";
import { generatePkce, buildAuthorizeUrl as xAuthorizeUrl, savePendingOAuth as xSavePending } from "../adapters/x.js";
import { buildAuthorizeUrl as liAuthorizeUrl, savePendingOAuth as liSavePending } from "../adapters/linkedin.js";
import { buildAuthorizeUrl as redditAuthorizeUrl, savePendingOAuth as redditSavePending } from "../adapters/reddit.js";
import { buildAuthorizeUrl as threadsAuthorizeUrl, getThreadsTokenStatus, savePendingOAuth as threadsSavePending } from "../adapters/threads.js";
import { connect as blueskyConnect } from "../adapters/bluesky.js";
import {
  generatePkce as ttGeneratePkce,
  buildAuthorizeUrl as ttAuthorizeUrl,
  savePendingOAuth as ttSavePending,
  fetchCreatorInfo as ttCreatorInfo,
  fetchUserInfo as ttUserInfo,
  fetchPublishStatus as ttPublishStatus,
  revokeAccess as ttRevoke,
} from "../adapters/tiktok.js";
import { buildAuthorizeUrl as igAuthorizeUrl, savePendingOAuth as igSavePending } from "../adapters/instagram.js";
import { buildAuthorizeUrl as fbAuthorizeUrl, savePendingOAuth as fbSavePending } from "../adapters/facebook.js";

const cadenceSchema = z.object({
  posts_per_day:   z.number().int().min(0).max(20).optional(),
  posts_per_week:  z.number().int().min(0).max(140).optional(),
  posting_hours:   z.array(z.number().int().min(0).max(23)).optional(),
  auto_approve:    z.boolean().optional(),
  subreddits:      z.array(z.string()).optional(),
  newsletter_day:  z.enum(["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]).optional(),
});

export const channelsAuthedRoutes = new Hono();

// ── GET / — list all channels with connection status ─────────────────────────
channelsAuthedRoutes.get("/", async (c) => {
  const ws = c.get("workspaceId");
  const sb = getSupabaseAdmin();
  const { data: channels, error } = await sb
    .from("channels")
    .select("slug, enabled, cadence_config, connected_at, access_token_hash, auth_state")
    .eq("workspace_id", ws)
    .order("slug");
  if (error) throw new HTTPException(500, { message: error.message });

  const rows = (channels ?? []).map((ch: Record<string, unknown>) => {
    // Adapters store credentials in auth_state.tokens on successful connect.
    // Fall back to the legacy access_token_hash column if present.
    const tokens = (ch.auth_state as { tokens?: { expires_at?: unknown } } | null)?.tokens;
    const slug   = String(ch.slug);
    const expiresAt = typeof tokens?.expires_at === "string" ? tokens.expires_at : null;
    const authStatus = slug === "threads" ? getThreadsTokenStatus(expiresAt ?? undefined) : null;
    const expired = authStatus === "expired";
    return {
      slug:           ch.slug,
      enabled:        ch.enabled,
      cadence_config: ch.cadence_config,
      connected:      (!!tokens || !!ch.access_token_hash) && !expired,
      connected_at:   ch.connected_at ?? null,
      auth_status:    authStatus,
      auth_expires_at: expiresAt,
      // Derived, never read from the stale channels.auth_method column — see
      // lib/channel-auth.ts. This keeps the UI in step with what the publish
      // path actually does, with no migration required.
      auth_method:    channelAuthMethod(slug),
      supports_oauth: supportsOAuthConnect(slug),
    };
  });

  return c.json({ channels: rows });
});

// ── PATCH /:slug/cadence — update cadence config ──────────────────────────────
channelsAuthedRoutes.patch("/:slug/cadence", async (c) => {
  const slug = c.req.param("slug");
  const ws = c.get("workspaceId");
  const json = await c.req.json().catch(() => ({}));
  const parsed = cadenceSchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const sb = getSupabaseAdmin();

  // Load current config so we can merge (patch semantics)
  const { data: ch, error: fetchErr } = await sb
    .from("channels")
    .select("cadence_config").eq("workspace_id", ws).eq("slug", slug).single();
  if (fetchErr || !ch) throw new HTTPException(404, { message: `Channel ${slug} not found` });

  const merged = { ...(ch.cadence_config as object), ...parsed.data };
  const { error } = await sb.from("channels")
    .update({ cadence_config: merged, updated_at: new Date().toISOString() })
    .eq("workspace_id", ws).eq("slug", slug);
  if (error) throw new HTTPException(500, { message: error.message });

  return c.json({ ok: true, slug, cadence_config: merged });
});

// ── PATCH /:slug/toggle — enable/disable channel ─────────────────────────────
channelsAuthedRoutes.patch("/:slug/toggle", async (c) => {
  const slug = c.req.param("slug");
  const ws = c.get("workspaceId");
  const json = await c.req.json().catch(() => ({}));
  const { enabled } = z.object({ enabled: z.boolean() }).parse(json);

  const sb = getSupabaseAdmin();
  const { error } = await sb.from("channels")
    .update({ enabled, updated_at: new Date().toISOString() }).eq("workspace_id", ws).eq("slug", slug);
  if (error) throw new HTTPException(500, { message: error.message });

  return c.json({ ok: true, slug, enabled });
});

// ── POST /:slug/auth/start — begin OAuth flow ─────────────────────────────────
channelsAuthedRoutes.post("/:slug/auth/start", async (c) => {
  const slug = c.req.param("slug");
  const ws = c.get("workspaceId");
  const state = randomBytes(16).toString("hex");

  switch (slug) {
    case "x": {
      try {
        const { verifier, challenge } = generatePkce();
        await xSavePending(ws, state, verifier);
        const url = xAuthorizeUrl({ state, code_challenge: challenge });
        return c.json({ authorize_url: url, state });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Missing")) {
          const base = process.env.API_BASE_URL ?? "https://your-api.railway.app";
          throw new HTTPException(503, {
            message: `X OAuth not configured. Set X_CLIENT_ID, X_CLIENT_SECRET, and X_REDIRECT_URI in Railway. Callback URL: ${base}/v1/channels/x/auth/callback`,
          });
        }
        throw e;
      }
    }
    case "linkedin": {
      try {
        await liSavePending(ws, state);
        const url = liAuthorizeUrl(state);
        return c.json({ authorize_url: url, state });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Missing")) {
          throw new HTTPException(503, { message: "LinkedIn OAuth not configured. Set LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, and LINKEDIN_REDIRECT_URI in Railway." });
        }
        throw e;
      }
    }
    case "reddit": {
      try {
        await redditSavePending(ws, state);
        const url = redditAuthorizeUrl(state);
        return c.json({ authorize_url: url, state });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Missing")) {
          throw new HTTPException(503, { message: "Reddit OAuth not configured. Set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, and REDDIT_REDIRECT_URI in Railway." });
        }
        throw e;
      }
    }
    case "threads": {
      try {
        await threadsSavePending(ws, state);
        const url = threadsAuthorizeUrl(state);
        return c.json({ authorize_url: url, state });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("not configured")) {
          throw new HTTPException(503, { message: "Threads OAuth not configured. Set THREADS_CLIENT_ID, THREADS_CLIENT_SECRET, and THREADS_REDIRECT_URI in Railway." });
        }
        throw e;
      }
    }
    case "tiktok": {
      try {
        const { verifier, challenge } = ttGeneratePkce();
        await ttSavePending(ws, state, verifier);
        const url = ttAuthorizeUrl({ state, code_challenge: challenge });
        return c.json({ authorize_url: url, state });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("not configured")) {
          throw new HTTPException(503, { message: "TikTok OAuth not configured. Set TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, and TIKTOK_REDIRECT_URI in Railway." });
        }
        throw e;
      }
    }
    case "instagram": {
      try {
        await igSavePending(ws, state);
        const url = igAuthorizeUrl(state);
        return c.json({ authorize_url: url, state });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("not configured")) {
          throw new HTTPException(503, { message: "Instagram OAuth not configured. Set INSTAGRAM_CLIENT_ID, INSTAGRAM_CLIENT_SECRET, and INSTAGRAM_REDIRECT_URI in Railway." });
        }
        throw e;
      }
    }
    case "facebook": {
      try {
        await fbSavePending(ws, state);
        const url = fbAuthorizeUrl(state);
        return c.json({ authorize_url: url, state });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("not configured")) {
          throw new HTTPException(503, { message: "Facebook OAuth not configured. Set FACEBOOK_CLIENT_ID, FACEBOOK_CLIENT_SECRET, and FACEBOOK_REDIRECT_URI in Railway." });
        }
        throw e;
      }
    }
    default:
      throw new HTTPException(400, { message: `OAuth not supported for channel: ${slug}` });
  }
});

// ── POST /:slug/connect — credential-based connect (Bluesky app password) ─────
const blueskyConnectSchema = z.object({
  handle:       z.string().min(1),
  app_password: z.string().min(1),
});

// ── TikTok Direct Post support ───────────────────────────────────────────────
// These back the compose UI. TikTok's guidelines require the posting screen to
// be rendered from a LIVE creator_info response every time it opens, so this is
// deliberately not cached anywhere.

/** GET /tiktok/creator-info — privacy options, interaction availability, limits. */
channelsAuthedRoutes.get("/tiktok/creator-info", async (c) => {
  const ws = c.get("workspaceId");
  try {
    return c.json({ creator: await ttCreatorInfo(ws) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("not connected")) throw new HTTPException(409, { message: msg });
    throw new HTTPException(502, { message: msg });
  }
});

/** GET /tiktok/user-info — the connected account, for the Channels screen. */
channelsAuthedRoutes.get("/tiktok/user-info", async (c) => {
  const ws = c.get("workspaceId");
  try {
    return c.json({ user: await ttUserInfo(ws) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("not connected")) throw new HTTPException(409, { message: msg });
    throw new HTTPException(502, { message: msg });
  }
});

/** GET /tiktok/publish-status/:publishId — drives the progress indicator. */
channelsAuthedRoutes.get("/tiktok/publish-status/:publishId", async (c) => {
  const ws = c.get("workspaceId");
  try {
    return c.json(await ttPublishStatus(ws, c.req.param("publishId")));
  } catch (e) {
    throw new HTTPException(502, { message: e instanceof Error ? e.message : String(e) });
  }
});

/** DELETE /tiktok/auth — revoke the token with TikTok and clear it locally. */
channelsAuthedRoutes.delete("/tiktok/auth", async (c) => {
  const ws = c.get("workspaceId");
  try {
    return c.json({ ok: true, ...(await ttRevoke(ws)) });
  } catch (e) {
    throw new HTTPException(502, { message: e instanceof Error ? e.message : String(e) });
  }
});

channelsAuthedRoutes.post("/:slug/connect", async (c) => {
  const slug = c.req.param("slug");
  const ws = c.get("workspaceId");
  if (slug !== "bluesky") {
    throw new HTTPException(400, { message: `Credential connect not supported for channel: ${slug}` });
  }
  const parsed = blueskyConnectSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new HTTPException(400, { message: "handle and app_password are required" });
  try {
    const { did, handle } = await blueskyConnect(ws, parsed.data.handle, parsed.data.app_password);
    return c.json({ ok: true, did, handle });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HTTPException(400, { message: msg });
  }
});
