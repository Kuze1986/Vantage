import { createHash, randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { RateLimitError, parseRetryAfter } from "../lib/rate-limit-error.js";

// TikTok Content Posting API + Login Kit.
// NOTE: endpoint paths, the client_key/client_secret param naming, post_info /
// source_info field shapes, chunk-size limits, and the status enum values below
// are written from general API knowledge, not a fresh docs fetch — verify each
// against TikTok's current developer docs before relying on this in production.
const TT_AUTH   = "https://www.tiktok.com/v2/auth/authorize/";
const TT_TOKEN  = "https://open.tiktokapis.com/v2/oauth/token/";
const TT_INIT   = "https://open.tiktokapis.com/v2/post/publish/video/init/";
const TT_STATUS = "https://open.tiktokapis.com/v2/post/publish/status/fetch/";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE — TikTok Login Kit requires code_challenge/S256, same as X. */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function requireEnv(): { clientKey: string; clientSecret: string; redirect: string } {
  const clientKey    = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirect      = process.env.TIKTOK_REDIRECT_URI;
  if (!clientKey || !clientSecret || !redirect) {
    throw new Error("TikTok OAuth not configured: set TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI");
  }
  return { clientKey, clientSecret, redirect };
}

export function buildAuthorizeUrl(params: { state: string; code_challenge: string }): string {
  const { clientKey, redirect } = requireEnv();
  const u = new URL(TT_AUTH);
  u.searchParams.set("client_key", clientKey);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("scope", "user.info.basic,video.publish");
  u.searchParams.set("state", params.state);
  u.searchParams.set("code_challenge", params.code_challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

type TikTokAuthState = {
  pending_oauth?: { state: string; code_verifier: string; created_at: string };
  tokens?: { access_token: string; refresh_token?: string; expires_at?: string; open_id?: string };
};

export async function savePendingOAuth(workspaceId: string, state: string, verifier: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const auth_state: TikTokAuthState = { pending_oauth: { state, code_verifier: verifier, created_at: new Date().toISOString() } };
  const { error } = await sb.from("channels").update({ auth_state }).eq("workspace_id", workspaceId).eq("slug", "tiktok");
  if (error) throw new Error(error.message);
}

export async function exchangeCodeForTokens(code: string, state: string): Promise<void> {
  const { clientKey, clientSecret, redirect } = requireEnv();
  const sb = getSupabaseAdmin();

  // Unauthenticated callback — resolve the workspace by matching the pending state.
  const { data: rows } = await sb.from("channels").select("workspace_id, auth_state").eq("slug", "tiktok");
  const match = (rows ?? []).find(
    (r) => ((r.auth_state ?? {}) as TikTokAuthState).pending_oauth?.state === state,
  );
  if (!match) throw new Error("Invalid OAuth state");
  const workspaceId = match.workspace_id as string;
  const pending = ((match.auth_state ?? {}) as TikTokAuthState).pending_oauth!;

  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirect,
    code_verifier: pending.code_verifier,
  });
  const res = await fetch(TT_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    await logActivity({ source: "adapter:tiktok", source_type: "adapter", event_type: "oauth_token_error", summary: JSON.stringify(json).slice(0, 500), payload: json });
    throw new Error(`TikTok token exchange failed: ${JSON.stringify(json)}`);
  }

  const access_token  = typeof json.access_token  === "string" ? json.access_token  : null;
  const refresh_token = typeof json.refresh_token === "string" ? json.refresh_token : undefined;
  const open_id       = typeof json.open_id       === "string" ? json.open_id       : undefined;
  if (!access_token) throw new Error("TikTok token response missing access_token");
  const expires_in = typeof json.expires_in === "number" ? json.expires_in : 86400;
  const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();

  const next: TikTokAuthState = { tokens: { access_token, refresh_token, expires_at, open_id } };
  const { error } = await sb.from("channels").update({ auth_state: next, enabled: true }).eq("workspace_id", workspaceId).eq("slug", "tiktok");
  if (error) throw new Error(error.message);

  await logActivity({ source: "adapter:tiktok", source_type: "adapter", event_type: "oauth_connected", summary: "TikTok account connected", payload: { open_id } });
}

async function getAccessToken(workspaceId: string): Promise<{ token: string; openId: string }> {
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("channels").select("auth_state").eq("workspace_id", workspaceId).eq("slug", "tiktok").single();
  const auth = ((data?.auth_state ?? {}) as TikTokAuthState).tokens;
  if (!auth?.access_token) throw new Error("TikTok channel not connected");
  const exp = auth.expires_at ? Date.parse(auth.expires_at) : 0;
  if (exp && Date.now() > exp - 60_000 && auth.refresh_token) {
    return refreshAccessToken(workspaceId, auth.refresh_token, auth.open_id);
  }
  return { token: auth.access_token, openId: auth.open_id ?? "" };
}

async function refreshAccessToken(workspaceId: string, refreshToken: string, openId?: string): Promise<{ token: string; openId: string }> {
  const { clientKey, clientSecret } = requireEnv();
  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch(TT_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`TikTok refresh failed: ${JSON.stringify(json)}`);
  const access_token = typeof json.access_token === "string" ? json.access_token : null;
  const new_refresh = typeof json.refresh_token === "string" ? json.refresh_token : refreshToken;
  if (!access_token) throw new Error("TikTok refresh missing access_token");
  const expires_in = typeof json.expires_in === "number" ? json.expires_in : 86400;
  const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();
  const sb = getSupabaseAdmin();
  const next: TikTokAuthState = { tokens: { access_token, refresh_token: new_refresh, expires_at, open_id: openId } };
  const { error } = await sb.from("channels").update({ auth_state: next }).eq("workspace_id", workspaceId).eq("slug", "tiktok");
  if (error) throw new Error(error.message);
  return { token: access_token, openId: openId ?? "" };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Publish a video via TikTok's Content Posting API using FILE_UPLOAD (not
 * PULL_FROM_URL — that requires verifying the video URL's domain with TikTok,
 * which isn't practical since videos live on a shared Supabase Storage domain).
 * Fetches the video bytes server-side and uploads them directly, mirroring
 * linkedin.ts's uploadImageToLinkedIn() fetch-then-PUT pattern.
 */
export async function postTikTokVideo(
  workspaceId: string,
  params: { videoUrl: string; title: string; privacyLevel?: string },
): Promise<{ id: string }> {
  if (!params.videoUrl) throw new Error("TikTok post requires a video");
  const { token } = await getAccessToken(workspaceId);

  const videoRes = await fetch(params.videoUrl);
  if (!videoRes.ok) throw new Error(`Failed to fetch video for TikTok upload: ${videoRes.status}`);
  const videoBuf = await videoRes.arrayBuffer();

  const initRes = await fetch(TT_INIT, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      post_info: {
        title: params.title.slice(0, 150),
        // SELF_ONLY by default — unaudited/sandbox apps are typically restricted
        // from PUBLIC_TO_EVERYONE until full app review is approved.
        privacy_level: params.privacyLevel ?? "SELF_ONLY",
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoBuf.byteLength,
        chunk_size: videoBuf.byteLength,
        total_chunk_count: 1,
      },
    }),
  });
  const initJson = (await initRes.json()) as {
    data?: { publish_id?: string; upload_url?: string };
    error?: { code?: string; message?: string };
  };
  if (initRes.status === 429) {
    throw new RateLimitError("TikTok rate limit — retry later", parseRetryAfter(initRes.headers.get("retry-after"), 5 * 60_000));
  }
  const publishId = initJson.data?.publish_id;
  const uploadUrl = initJson.data?.upload_url;
  if (!initRes.ok || !publishId || !uploadUrl) {
    const detail = initJson.error?.message ?? JSON.stringify(initJson);
    await logActivity({ source: "adapter:tiktok", source_type: "adapter", event_type: "post_failed", summary: detail.slice(0, 500), payload: initJson as Record<string, unknown> });
    throw new Error(`TikTok publish init failed: ${detail}`);
  }

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Range": `bytes 0-${videoBuf.byteLength - 1}/${videoBuf.byteLength}`,
    },
    body: videoBuf,
  });
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => "");
    await logActivity({ source: "adapter:tiktok", source_type: "adapter", event_type: "post_failed", summary: `upload PUT failed: ${putRes.status}`, payload: { publish_id: publishId, body: text.slice(0, 300) } });
    throw new Error(`TikTok video upload PUT failed: ${putRes.status}`);
  }

  // Publish is async — poll status, but don't hard-fail on timeout since the
  // upload itself already succeeded; TikTok will finish processing regardless.
  let finalStatus = "PROCESSING_DOWNLOAD";
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    const statusRes = await fetch(TT_STATUS, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const statusJson = (await statusRes.json()) as { data?: { status?: string; fail_reason?: string } };
    finalStatus = statusJson.data?.status ?? finalStatus;
    if (finalStatus === "PUBLISH_COMPLETE") break;
    if (finalStatus === "FAILED") {
      const reason = statusJson.data?.fail_reason ?? "unknown";
      await logActivity({ source: "adapter:tiktok", source_type: "adapter", event_type: "post_failed", summary: `publish failed: ${reason}`, payload: { publish_id: publishId } });
      throw new Error(`TikTok publish failed: ${reason}`);
    }
  }
  if (finalStatus !== "PUBLISH_COMPLETE") {
    await logActivity({ source: "adapter:tiktok", source_type: "adapter", event_type: "post_pending", summary: `TikTok publish ${publishId} still processing after poll timeout`, payload: { publish_id: publishId, last_status: finalStatus } });
  }

  await logActivity({ source: "adapter:tiktok", source_type: "adapter", event_type: "post_success", summary: `TikTok publish ${publishId}`, payload: { publish_id: publishId, status: finalStatus } });
  return { id: publishId };
}

export interface TikTokPackage {
  hook: string;
  script: string;
  on_screen_text?: string;
  instructions: string;
}

/** Retained as a manual-post fallback / reference even once real posting is live. */
export function packageForManualPost(payload: Record<string, unknown>): TikTokPackage {
  return {
    hook:           String(payload.hook ?? ""),
    script:         String(payload.body ?? ""),
    on_screen_text: payload.on_screen_text ? String(payload.on_screen_text) : undefined,
    instructions: [
      "1. Record a video following the script below.",
      "2. Add on-screen text captions where indicated.",
      "3. Upload to TikTok Creator Studio.",
      "4. Copy the TikTok URL and paste it into Vantage to mark as published.",
    ].join("\n"),
  };
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}
