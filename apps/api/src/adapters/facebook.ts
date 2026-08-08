import { randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { RateLimitError, parseRetryAfter } from "../lib/rate-limit-error.js";

// Facebook Page posting via Graph API — same Meta app as instagram.ts (reuse
// the same App ID/Secret across FACEBOOK_CLIENT_ID/INSTAGRAM_CLIENT_ID in
// Railway if they're one app), same OAuth shape, but simpler: no linked-
// Instagram-account resolution, post directly to the Page.
// NOTE: Graph API version pinned below is written from general knowledge, not
// a fresh docs fetch — verify against Meta's current docs. pages_manage_posts
// requires Advanced Access via Meta App Review, same gate as Instagram's
// instagram_content_publishing.
const GRAPH_VERSION = "v21.0";
const FB_AUTH  = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
const FB_GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

type FacebookAuthState = {
  pending_oauth?: { state: string; created_at: string };
  tokens?: { access_token: string; expires_at?: string; page_id?: string };
};

function requireEnv(): { clientId: string; clientSecret: string; redirect: string } {
  const clientId     = process.env.FACEBOOK_CLIENT_ID;
  const clientSecret = process.env.FACEBOOK_CLIENT_SECRET;
  const redirect      = process.env.FACEBOOK_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirect) {
    throw new Error("Facebook OAuth not configured: set FACEBOOK_CLIENT_ID, FACEBOOK_CLIENT_SECRET, FACEBOOK_REDIRECT_URI");
  }
  return { clientId, clientSecret, redirect };
}

export function buildAuthorizeUrl(stateToken: string): string {
  const { clientId, redirect } = requireEnv();
  const u = new URL(FB_AUTH);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("state", stateToken);
  u.searchParams.set("scope", "pages_show_list,pages_read_engagement,pages_manage_posts,business_management");
  return u.toString();
}

export async function savePendingOAuth(workspaceId: string, state: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const auth_state: FacebookAuthState = { pending_oauth: { state, created_at: new Date().toISOString() } };
  const { error } = await sb.from("channels").update({ auth_state }).eq("workspace_id", workspaceId).eq("slug", "facebook");
  if (error) throw new Error(error.message);
}

export async function exchangeCodeForTokens(code: string, state: string): Promise<void> {
  const { clientId, clientSecret, redirect } = requireEnv();
  const sb = getSupabaseAdmin();

  // Unauthenticated callback — resolve the workspace by matching the pending state.
  const { data: rows } = await sb.from("channels").select("workspace_id, auth_state").eq("slug", "facebook");
  const match = (rows ?? []).find(
    (r) => ((r.auth_state ?? {}) as FacebookAuthState).pending_oauth?.state === state,
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
  if (!tokenRes.ok) throw new Error(`Facebook token exchange failed: ${JSON.stringify(tokenJson)}`);
  const shortToken = typeof tokenJson.access_token === "string" ? tokenJson.access_token : null;
  if (!shortToken) throw new Error("Facebook token response missing access_token");

  // Step 2: exchange for a long-lived token (~60 days).
  const longUrl = new URL(`${FB_GRAPH}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", clientId);
  longUrl.searchParams.set("client_secret", clientSecret);
  longUrl.searchParams.set("fb_exchange_token", shortToken);
  const longRes = await fetch(longUrl);
  const longJson = (await longRes.json()) as Record<string, unknown>;
  const userToken = typeof longJson.access_token === "string" ? longJson.access_token : shortToken;

  // Step 3: find the connected Page and its Page-scoped access token — Page
  // tokens derived from a long-lived user token are themselves long-lived and
  // don't carry their own separate expires_in in the /me/accounts response.
  const accountsUrl = new URL(`${FB_GRAPH}/me/accounts`);
  accountsUrl.searchParams.set("access_token", userToken);
  const accountsRes = await fetch(accountsUrl);
  const accountsJson = (await accountsRes.json()) as { data?: { id?: string; access_token?: string }[] };
  const page = accountsJson.data?.[0];
  if (!accountsRes.ok || !page?.id || !page.access_token) {
    throw new Error("No Facebook Page found for this account — connect an account that manages a Page first");
  }

  const expires_in = typeof longJson.expires_in === "number" ? longJson.expires_in : 5184000;
  const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();
  const next: FacebookAuthState = { tokens: { access_token: page.access_token, expires_at, page_id: page.id } };
  const { error } = await sb.from("channels").update({ auth_state: next, enabled: true }).eq("workspace_id", workspaceId).eq("slug", "facebook");
  if (error) throw new Error(error.message);

  await logActivity({ source: "adapter:facebook", source_type: "adapter", event_type: "oauth_connected", summary: "Facebook Page connected", payload: { page_id: page.id } });
}

/**
 * Meta long-lived tokens don't have a clean silent-refresh path (same
 * limitation as instagram.ts) — an expired token surfaces a reconnect error
 * rather than attempting a refresh.
 */
async function getAccessToken(workspaceId: string): Promise<{ token: string; pageId: string }> {
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("channels").select("auth_state").eq("workspace_id", workspaceId).eq("slug", "facebook").single();
  const auth = ((data?.auth_state ?? {}) as FacebookAuthState).tokens;
  if (!auth?.access_token) throw new Error("Facebook channel not connected");
  if (!auth.page_id) throw new Error("Facebook Page id missing — reconnect the channel");
  const exp = auth.expires_at ? Date.parse(auth.expires_at) : 0;
  if (exp && Date.now() > exp - 24 * 60 * 60 * 1000) {
    throw new Error("Facebook access token expired — reconnect the channel");
  }
  return { token: auth.access_token, pageId: auth.page_id };
}

export async function postFacebook(
  workspaceId: string,
  params: { message: string; imageUrl?: string },
): Promise<{ id: string }> {
  if (!params.message) throw new Error("Facebook post requires text");
  const { token, pageId } = await getAccessToken(workspaceId);

  // With an image, post to /photos (caption = message); otherwise a plain
  // text post to /feed. Facebook doesn't need the create-then-publish
  // container dance Instagram's video flow does — this is a single call.
  const url = new URL(`${FB_GRAPH}/${pageId}/${params.imageUrl ? "photos" : "feed"}`);
  url.searchParams.set("access_token", token);
  if (params.imageUrl) {
    url.searchParams.set("url", params.imageUrl);
    url.searchParams.set("caption", params.message);
  } else {
    url.searchParams.set("message", params.message);
  }
  const res = await fetch(url, { method: "POST" });
  const json = (await res.json()) as { id?: string; post_id?: string; error?: { message?: string } };
  if (res.status === 429) {
    throw new RateLimitError("Facebook rate limit — retry later", parseRetryAfter(res.headers.get("retry-after"), 5 * 60_000));
  }
  const id = json.post_id ?? json.id;
  if (!res.ok || !id) {
    const detail = json.error?.message ?? JSON.stringify(json);
    await logActivity({ source: "adapter:facebook", source_type: "adapter", event_type: "post_failed", summary: detail.slice(0, 500), payload: json as Record<string, unknown> });
    throw new Error(`Facebook post failed: ${detail}`);
  }

  await logActivity({ source: "adapter:facebook", source_type: "adapter", event_type: "post_success", summary: `Facebook post ${id}`, payload: { id } });
  return { id };
}

export interface FacebookPackage {
  text: string;
  instructions: string;
}

/** Retained as a manual-post fallback / reference even once real posting is live. */
export function packageForManualPost(payload: Record<string, unknown>): FacebookPackage {
  return {
    text: String(payload.body ?? ""),
    instructions: [
      "1. Open Facebook and go to your Page.",
      "2. Create a new post and paste the text below.",
      "3. Publish, then copy the URL and mark as published in Vantage.",
    ].join("\n"),
  };
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}
