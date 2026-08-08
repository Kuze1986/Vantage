import { randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { RateLimitError, parseRetryAfter } from "../lib/rate-limit-error.js";

// Instagram Graph API via Facebook Login. This is a Meta/Facebook developer
// app under the hood (INSTAGRAM_CLIENT_ID/SECRET are the Meta app's id/secret)
// — the same app could later back a real facebook.ts adapter too.
// NOTE: scope names below are confirmed against the live Meta console ("API
// setup with Facebook login" screen, 2026-08-08). The Graph API version
// pinned below and the media container status field/enum values are still
// written from general API knowledge, not a fresh docs fetch — verify those
// against Meta's current docs before relying on this in production. Feed
// video posts were deprecated in favor of Reels; confirm whether
// media_type: "REELS" is still required for video uploads.
const GRAPH_VERSION = "v21.0";
const FB_AUTH  = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
const FB_GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

type InstagramAuthState = {
  pending_oauth?: { state: string; created_at: string };
  tokens?: { access_token: string; expires_at?: string; page_id?: string; ig_user_id?: string };
};

function requireEnv(): { clientId: string; clientSecret: string; redirect: string } {
  const clientId     = process.env.INSTAGRAM_CLIENT_ID;
  const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
  const redirect      = process.env.INSTAGRAM_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirect) {
    throw new Error("Instagram OAuth not configured: set INSTAGRAM_CLIENT_ID, INSTAGRAM_CLIENT_SECRET, INSTAGRAM_REDIRECT_URI");
  }
  return { clientId, clientSecret, redirect };
}

export function buildAuthorizeUrl(stateToken: string): string {
  const { clientId, redirect } = requireEnv();
  const u = new URL(FB_AUTH);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("state", stateToken);
  // Confirmed against the app's full Permissions and Features list (not just
  // the abbreviated "API setup with Facebook login" summary screen, whose
  // label text doesn't match the real permission name): the permission that
  // actually exists and shows "Ready for testing" is instagram_content_publish
  // (no "-ing"). instagram_content_publishing doesn't exist at all — that was
  // a bad correction. Don't confuse this with instagram_business_content_publish,
  // a different permission tied to the separate "API setup with Instagram
  // login" path this adapter doesn't use.
  u.searchParams.set(
    "scope",
    "instagram_basic,instagram_content_publish,pages_read_engagement,business_management,pages_show_list",
  );
  return u.toString();
}

export async function savePendingOAuth(workspaceId: string, state: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const auth_state: InstagramAuthState = { pending_oauth: { state, created_at: new Date().toISOString() } };
  const { error } = await sb.from("channels").update({ auth_state }).eq("workspace_id", workspaceId).eq("slug", "instagram");
  if (error) throw new Error(error.message);
}

export async function exchangeCodeForTokens(code: string, state: string): Promise<void> {
  const { clientId, clientSecret, redirect } = requireEnv();
  const sb = getSupabaseAdmin();

  // Unauthenticated callback — resolve the workspace by matching the pending state.
  const { data: rows } = await sb.from("channels").select("workspace_id, auth_state").eq("slug", "instagram");
  const match = (rows ?? []).find(
    (r) => ((r.auth_state ?? {}) as InstagramAuthState).pending_oauth?.state === state,
  );
  if (!match) throw new Error("Invalid OAuth state");
  const workspaceId = match.workspace_id as string;

  // Step 1: short-lived user token.
  const tokenUrl = new URL(`${FB_GRAPH}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", clientId);
  tokenUrl.searchParams.set("client_secret", clientSecret);
  tokenUrl.searchParams.set("redirect_uri", redirect);
  tokenUrl.searchParams.set("code", code);
  const tokenRes = await fetch(tokenUrl);
  const tokenJson = (await tokenRes.json()) as Record<string, unknown>;
  if (!tokenRes.ok) throw new Error(`Instagram token exchange failed: ${JSON.stringify(tokenJson)}`);
  const shortToken = typeof tokenJson.access_token === "string" ? tokenJson.access_token : null;
  if (!shortToken) throw new Error("Instagram token response missing access_token");

  // Step 2: exchange for a long-lived token (~60 days).
  const longUrl = new URL(`${FB_GRAPH}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", clientId);
  longUrl.searchParams.set("client_secret", clientSecret);
  longUrl.searchParams.set("fb_exchange_token", shortToken);
  const longRes = await fetch(longUrl);
  const longJson = (await longRes.json()) as Record<string, unknown>;
  const userToken = typeof longJson.access_token === "string" ? longJson.access_token : shortToken;
  const expires_in = typeof longJson.expires_in === "number" ? longJson.expires_in : 5184000;
  const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();

  // Step 3: find the connected Facebook Page (and its Page-scoped access token).
  const accountsUrl = new URL(`${FB_GRAPH}/me/accounts`);
  accountsUrl.searchParams.set("access_token", userToken);
  const accountsRes = await fetch(accountsUrl);
  const accountsJson = (await accountsRes.json()) as { data?: { id?: string; access_token?: string }[] };
  const page = accountsJson.data?.[0];
  if (!accountsRes.ok || !page?.id) {
    throw new Error("No Facebook Page with a linked Instagram Business account found — connect a Page with an IG Business/Creator account first");
  }
  const pageToken = page.access_token ?? userToken;

  // Step 4: resolve the IG Business Account id linked to that Page.
  const igUrl = new URL(`${FB_GRAPH}/${page.id}`);
  igUrl.searchParams.set("fields", "instagram_business_account");
  igUrl.searchParams.set("access_token", pageToken);
  const igRes = await fetch(igUrl);
  const igJson = (await igRes.json()) as { instagram_business_account?: { id?: string } };
  const igUserId = igJson.instagram_business_account?.id;
  if (!igRes.ok || !igUserId) {
    throw new Error("No Facebook Page with a linked Instagram Business account found — connect a Page with an IG Business/Creator account first");
  }

  const next: InstagramAuthState = { tokens: { access_token: pageToken, expires_at, page_id: page.id, ig_user_id: igUserId } };
  const { error } = await sb.from("channels").update({ auth_state: next, enabled: true }).eq("workspace_id", workspaceId).eq("slug", "instagram");
  if (error) throw new Error(error.message);

  await logActivity({ source: "adapter:instagram", source_type: "adapter", event_type: "oauth_connected", summary: "Instagram account connected", payload: { page_id: page.id, ig_user_id: igUserId } });
}

/**
 * Meta long-lived tokens (~60 days) don't have a clean silent-refresh path the
 * way X/Reddit/LinkedIn/Threads' do — unlike those adapters, this does NOT
 * attempt a refresh. If the token is expired, the workspace needs to
 * reconnect via OAuth again.
 */
async function getAccessToken(workspaceId: string): Promise<{ token: string; igUserId: string }> {
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("channels").select("auth_state").eq("workspace_id", workspaceId).eq("slug", "instagram").single();
  const auth = ((data?.auth_state ?? {}) as InstagramAuthState).tokens;
  if (!auth?.access_token) throw new Error("Instagram channel not connected");
  if (!auth.ig_user_id) throw new Error("Instagram business account id missing — reconnect the channel");
  const exp = auth.expires_at ? Date.parse(auth.expires_at) : 0;
  if (exp && Date.now() > exp - 24 * 60 * 60 * 1000) {
    throw new Error("Instagram access token expired — reconnect the channel");
  }
  return { token: auth.access_token, igUserId: auth.ig_user_id };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function postInstagramMedia(
  workspaceId: string,
  params: { mediaUrl: string; mediaType: "IMAGE" | "VIDEO"; caption: string },
): Promise<{ id: string }> {
  if (!params.mediaUrl) throw new Error("Instagram post requires an image or video");
  const { token, igUserId } = await getAccessToken(workspaceId);

  const createUrl = new URL(`${FB_GRAPH}/${igUserId}/media`);
  createUrl.searchParams.set("access_token", token);
  createUrl.searchParams.set("caption", params.caption);
  if (params.mediaType === "VIDEO") {
    createUrl.searchParams.set("video_url", params.mediaUrl);
    createUrl.searchParams.set("media_type", "REELS");
  } else {
    createUrl.searchParams.set("image_url", params.mediaUrl);
  }
  const createRes = await fetch(createUrl, { method: "POST" });
  const createJson = (await createRes.json()) as { id?: string; error?: { message?: string; code?: number } };
  if (createRes.status === 429) {
    throw new RateLimitError("Instagram rate limit — retry later", parseRetryAfter(createRes.headers.get("retry-after"), 5 * 60_000));
  }
  const creationId = createJson.id;
  if (!createRes.ok || !creationId) {
    const detail = createJson.error?.message ?? JSON.stringify(createJson);
    await logActivity({ source: "adapter:instagram", source_type: "adapter", event_type: "post_failed", summary: detail.slice(0, 500), payload: createJson as Record<string, unknown> });
    throw new Error(`Instagram media create failed: ${detail}`);
  }

  // Video containers process asynchronously — poll until ready. Images are
  // typically ready immediately; one defensive check, no real polling loop.
  if (params.mediaType === "VIDEO") {
    let statusCode = "IN_PROGRESS";
    for (let i = 0; i < 30; i++) {
      await sleep(3000);
      const statusUrl = new URL(`${FB_GRAPH}/${creationId}`);
      statusUrl.searchParams.set("fields", "status_code");
      statusUrl.searchParams.set("access_token", token);
      const statusRes = await fetch(statusUrl);
      const statusJson = (await statusRes.json()) as { status_code?: string };
      statusCode = statusJson.status_code ?? statusCode;
      if (statusCode === "FINISHED") break;
      if (statusCode === "ERROR" || statusCode === "EXPIRED") {
        await logActivity({ source: "adapter:instagram", source_type: "adapter", event_type: "post_failed", summary: `container ${statusCode}`, payload: { creation_id: creationId } });
        throw new Error(`Instagram media processing failed: ${statusCode}`);
      }
    }
    if (statusCode !== "FINISHED") {
      throw new Error("Instagram media processing timed out — try publishing again shortly");
    }
  }

  const publishUrl = new URL(`${FB_GRAPH}/${igUserId}/media_publish`);
  publishUrl.searchParams.set("access_token", token);
  publishUrl.searchParams.set("creation_id", creationId);
  const publishRes = await fetch(publishUrl, { method: "POST" });
  const publishJson = (await publishRes.json()) as { id?: string; error?: { message?: string } };
  if (publishRes.status === 429) {
    throw new RateLimitError("Instagram rate limit — retry later", parseRetryAfter(publishRes.headers.get("retry-after"), 5 * 60_000));
  }
  const id = publishJson.id;
  if (!publishRes.ok || !id) {
    const detail = publishJson.error?.message ?? JSON.stringify(publishJson);
    await logActivity({ source: "adapter:instagram", source_type: "adapter", event_type: "post_failed", summary: detail.slice(0, 500), payload: publishJson as Record<string, unknown> });
    throw new Error(`Instagram publish failed: ${detail}`);
  }

  await logActivity({ source: "adapter:instagram", source_type: "adapter", event_type: "post_success", summary: `Instagram post ${id}`, payload: { id } });
  return { id };
}

export interface InstagramPackage {
  caption: string;
  hashtags: string[];
  alt_text: string;
  instructions: string;
}

/** Retained as a manual-post fallback / reference even once real posting is live. */
export function packageForManualPost(payload: Record<string, unknown>): InstagramPackage {
  return {
    caption:    String(payload.body ?? ""),
    hashtags:   Array.isArray(payload.hashtags) ? payload.hashtags.map(String) : [],
    alt_text:   String(payload.alt_text ?? ""),
    instructions: [
      "1. Open Instagram and tap the + button.",
      "2. Select your image or video.",
      "3. Paste the caption and hashtags below.",
      "4. Post, then copy the URL and mark as published in Vantage.",
    ].join("\n"),
  };
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}
