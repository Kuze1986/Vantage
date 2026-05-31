import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { generatePkce, buildAuthorizeUrl as xAuthorizeUrl, savePendingOAuth as xSavePending } from "../adapters/x.js";
import { buildAuthorizeUrl as liAuthorizeUrl, savePendingOAuth as liSavePending } from "../adapters/linkedin.js";
import { buildAuthorizeUrl as redditAuthorizeUrl, savePendingOAuth as redditSavePending } from "../adapters/reddit.js";

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
  const sb = getSupabaseAdmin();
  const { data: channels, error } = await sb
    .from("channels")
    .select("slug, enabled, cadence_config, connected_at, access_token_hash")
    .order("slug");
  if (error) throw new HTTPException(500, { message: error.message });

  const rows = (channels ?? []).map((ch: Record<string, unknown>) => ({
    slug:           ch.slug,
    enabled:        ch.enabled,
    cadence_config: ch.cadence_config,
    connected:      !!ch.access_token_hash,
    connected_at:   ch.connected_at ?? null,
  }));

  return c.json({ channels: rows });
});

// ── PATCH /:slug/cadence — update cadence config ──────────────────────────────
channelsAuthedRoutes.patch("/:slug/cadence", async (c) => {
  const slug = c.req.param("slug");
  const json = await c.req.json().catch(() => ({}));
  const parsed = cadenceSchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const sb = getSupabaseAdmin();

  // Load current config so we can merge (patch semantics)
  const { data: ch, error: fetchErr } = await sb
    .from("channels")
    .select("cadence_config").eq("slug", slug).single();
  if (fetchErr || !ch) throw new HTTPException(404, { message: `Channel ${slug} not found` });

  const merged = { ...(ch.cadence_config as object), ...parsed.data };
  const { error } = await sb.from("channels")
    .update({ cadence_config: merged, updated_at: new Date().toISOString() })
    .eq("slug", slug);
  if (error) throw new HTTPException(500, { message: error.message });

  return c.json({ ok: true, slug, cadence_config: merged });
});

// ── PATCH /:slug/toggle — enable/disable channel ─────────────────────────────
channelsAuthedRoutes.patch("/:slug/toggle", async (c) => {
  const slug = c.req.param("slug");
  const json = await c.req.json().catch(() => ({}));
  const { enabled } = z.object({ enabled: z.boolean() }).parse(json);

  const sb = getSupabaseAdmin();
  const { error } = await sb.from("channels")
    .update({ enabled, updated_at: new Date().toISOString() }).eq("slug", slug);
  if (error) throw new HTTPException(500, { message: error.message });

  return c.json({ ok: true, slug, enabled });
});

// ── POST /:slug/auth/start — begin OAuth flow ─────────────────────────────────
channelsAuthedRoutes.post("/:slug/auth/start", async (c) => {
  const slug = c.req.param("slug");
  const state = randomBytes(16).toString("hex");

  switch (slug) {
    case "x": {
      try {
        const { verifier, challenge } = generatePkce();
        await xSavePending(state, verifier);
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
        await liSavePending(state);
        const url = liAuthorizeUrl(state);
        return c.json({ authorize_url: url, state });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Missing")) {
          throw new HTTPException(503, { message: "LinkedIn OAuth not configured. Set LI_CLIENT_ID, LI_CLIENT_SECRET, and LI_REDIRECT_URI in Railway." });
        }
        throw e;
      }
    }
    case "reddit": {
      try {
        await redditSavePending(state);
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
    default:
      throw new HTTPException(400, { message: `OAuth not supported for channel: ${slug}` });
  }
});
