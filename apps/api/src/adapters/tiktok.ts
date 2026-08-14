import { createHash, randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { RateLimitError, parseRetryAfter } from "../lib/rate-limit-error.js";

/**
 * TikTok Content Posting API (Direct Post) + Login Kit.
 *
 * Endpoint paths, field shapes, chunk limits and enum values below were
 * verified against TikTok's developer docs on 2026-08-08. The relevant rules
 * that are easy to get wrong, and that this file now encodes:
 *
 *   - Direct Post requires a creator_info/query call to render the posting UI.
 *     The privacy level offered to the user MUST come from that response and
 *     MUST NOT have a default (see docs/tiktok-app-review.md §3b).
 *   - Branded content may not be posted privately.
 *   - FILE_UPLOAD is only single-chunk for videos under 5 MB. Above that,
 *     chunks are 5–64 MB, max 1000 of them, uploaded sequentially.
 *   - Unaudited clients have all posts forced to SELF_ONLY regardless of the
 *     privacy_level sent. That is TikTok's behaviour, not ours — we still send
 *     what the user chose.
 */
const TT_AUTH         = "https://www.tiktok.com/v2/auth/authorize/";
const TT_TOKEN        = "https://open.tiktokapis.com/v2/oauth/token/";
const TT_REVOKE       = "https://open.tiktokapis.com/v2/oauth/revoke/";
const TT_USER_INFO    = "https://open.tiktokapis.com/v2/user/info/";
const TT_CREATOR_INFO = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";
const TT_INIT         = "https://open.tiktokapis.com/v2/post/publish/video/init/";
const TT_STATUS       = "https://open.tiktokapis.com/v2/post/publish/status/fetch/";

/** Direct Post caption limit (UTF-16 runes). */
export const TIKTOK_TITLE_MAX = 2200;

const MIN_CHUNK_BYTES = 5 * 1024 * 1024;
const MAX_CHUNK_BYTES = 64 * 1024 * 1024;
const MAX_CHUNK_COUNT = 1000;
const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;
const DEFAULT_CHUNK_BYTES = 10 * 1024 * 1024;

/** Pending OAuth states older than this are treated as expired. */
const PENDING_OAUTH_TTL_MS = 10 * 60_000;

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
  /** Set when a refresh fails — the operator must reconnect. */
  needs_reauth?: boolean;
};

/**
 * Single point of truth for locating a workspace's TikTok channel row.
 *
 * NOTE: `vantage.channels` is keyed `(workspace_id, slug)`, so a workspace can
 * hold exactly ONE TikTok connection. Supporting one account per portfolio
 * product requires adding `product_slug` to the table and threading it through
 * here — see docs/tiktok-app-review.md §1. Every authenticated lookup in this
 * file funnels through these two helpers so that change lands in one place.
 * (`exchangeCodeForTokens` is the exception: it runs unauthenticated and must
 * scan for a matching state, so it will need the product resolved the same way.)
 */
const CHANNEL_SLUG = "tiktok";

async function loadAuthState(workspaceId: string): Promise<TikTokAuthState> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("channels").select("auth_state")
    .eq("workspace_id", workspaceId).eq("slug", CHANNEL_SLUG)
    .single();
  return (data?.auth_state ?? {}) as TikTokAuthState;
}

async function writeAuthState(workspaceId: string, next: TikTokAuthState, extra?: Record<string, unknown>): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("channels").update({ auth_state: next, ...(extra ?? {}) })
    .eq("workspace_id", workspaceId).eq("slug", CHANNEL_SLUG);
  if (error) throw new Error(error.message);
}

/**
 * Stores the pending PKCE state WITHOUT discarding existing tokens — a user who
 * starts a reconnect and abandons it must not lose the working connection.
 */
export async function savePendingOAuth(workspaceId: string, state: string, verifier: string): Promise<void> {
  const current = await loadAuthState(workspaceId);
  await writeAuthState(workspaceId, {
    ...current,
    pending_oauth: { state, code_verifier: verifier, created_at: new Date().toISOString() },
  });
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
  const existing = (match.auth_state ?? {}) as TikTokAuthState;
  const pending = existing.pending_oauth!;

  // An unbounded state window lets a leaked callback URL be replayed forever.
  const age = Date.now() - Date.parse(pending.created_at ?? "");
  if (!Number.isFinite(age) || age > PENDING_OAUTH_TTL_MS) {
    throw new Error("OAuth state expired — start the connection again");
  }

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

  // Drop pending_oauth, clear any stale needs_reauth flag.
  await writeAuthState(
    workspaceId,
    { tokens: { access_token, refresh_token, expires_at, open_id } },
    { enabled: true, connected_at: new Date().toISOString() },
  );

  await logActivity({ source: "adapter:tiktok", source_type: "adapter", event_type: "oauth_connected", summary: "TikTok account connected", payload: { open_id } });
}

async function getAccessToken(workspaceId: string): Promise<{ token: string; openId: string }> {
  const auth = (await loadAuthState(workspaceId)).tokens;
  if (!auth?.access_token) throw new Error("TikTok channel not connected");
  const exp = auth.expires_at ? Date.parse(auth.expires_at) : 0;
  if (exp && Date.now() > exp - 60_000) {
    if (!auth.refresh_token) {
      await markNeedsReauth(workspaceId);
      throw new Error("TikTok access token expired and no refresh token is stored — reconnect the channel");
    }
    return refreshAccessToken(workspaceId, auth.refresh_token, auth.open_id);
  }
  return { token: auth.access_token, openId: auth.open_id ?? "" };
}

async function markNeedsReauth(workspaceId: string): Promise<void> {
  const current = await loadAuthState(workspaceId);
  await writeAuthState(workspaceId, { ...current, needs_reauth: true }, { enabled: false });
  await logActivity({
    source: "adapter:tiktok", source_type: "adapter", event_type: "needs_reauth",
    summary: "TikTok credentials are no longer valid — reconnect required", payload: {},
  });
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
  const access_token = typeof json.access_token === "string" ? json.access_token : null;
  if (!res.ok || !access_token) {
    // Refresh tokens expire after 365 days. Without this the channel fails
    // silently on every publish forever; flag it so the UI can say "reconnect".
    await markNeedsReauth(workspaceId);
    throw new Error(`TikTok refresh failed: ${JSON.stringify(json)}`);
  }
  const new_refresh = typeof json.refresh_token === "string" ? json.refresh_token : refreshToken;
  const expires_in = typeof json.expires_in === "number" ? json.expires_in : 86400;
  const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();
  await writeAuthState(workspaceId, { tokens: { access_token, refresh_token: new_refresh, expires_at, open_id: openId } });
  return { token: access_token, openId: openId ?? "" };
}

// ── Login Kit: user.info.basic ────────────────────────────────────────────────

export interface TikTokUserInfo {
  open_id: string;
  display_name: string;
  avatar_url: string;
}

/**
 * Reads the connected account's public profile. This is the ONLY consumer of the
 * `user.info.basic` scope — it backs the Channels screen so an operator can see
 * which TikTok account is linked before publishing. TikTok's review rejects
 * scopes an app requests but never uses.
 */
export async function fetchUserInfo(workspaceId: string): Promise<TikTokUserInfo> {
  const { token } = await getAccessToken(workspaceId);
  const u = new URL(TT_USER_INFO);
  u.searchParams.set("fields", "open_id,display_name,avatar_url");
  const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
  const json = (await res.json()) as { data?: { user?: Partial<TikTokUserInfo> }; error?: { message?: string } };
  if (!res.ok || !json.data?.user) {
    throw new Error(`TikTok user info failed: ${json.error?.message ?? JSON.stringify(json)}`);
  }
  const user = json.data.user;
  return {
    open_id:      String(user.open_id ?? ""),
    display_name: String(user.display_name ?? ""),
    avatar_url:   String(user.avatar_url ?? ""),
  };
}

// ── Direct Post: creator info ────────────────────────────────────────────────

export interface TikTokCreatorInfo {
  creator_avatar_url: string;
  creator_username: string;
  creator_nickname: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
}

/**
 * MUST be called every time the posting UI is rendered — TikTok requires the
 * privacy options, interaction availability and duration cap shown to the user
 * to reflect the account's CURRENT settings, not a cached copy.
 */
export async function fetchCreatorInfo(workspaceId: string): Promise<TikTokCreatorInfo> {
  const { token } = await getAccessToken(workspaceId);
  const res = await fetch(TT_CREATOR_INFO, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
  });
  const json = (await res.json()) as {
    data?: Partial<TikTokCreatorInfo>;
    error?: { code?: string; message?: string };
  };
  if (res.status === 429) {
    throw new RateLimitError("TikTok rate limit — retry later", parseRetryAfter(res.headers.get("retry-after"), 60_000));
  }
  if (!res.ok || !json.data) {
    throw new Error(`TikTok creator info failed: ${json.error?.message ?? JSON.stringify(json)}`);
  }
  const d = json.data;
  return {
    creator_avatar_url:          String(d.creator_avatar_url ?? ""),
    creator_username:            String(d.creator_username ?? ""),
    creator_nickname:            String(d.creator_nickname ?? ""),
    privacy_level_options:       Array.isArray(d.privacy_level_options) ? d.privacy_level_options.map(String) : [],
    comment_disabled:            !!d.comment_disabled,
    duet_disabled:               !!d.duet_disabled,
    stitch_disabled:             !!d.stitch_disabled,
    max_video_post_duration_sec: Number(d.max_video_post_duration_sec ?? 0),
  };
}

// ── Direct Post: publish ─────────────────────────────────────────────────────

export interface TikTokPostSettings {
  /** Caption. Up to TIKTOK_TITLE_MAX UTF-16 runes. */
  title: string;
  /** Chosen by the user from creator_info.privacy_level_options — never defaulted. */
  privacy_level: string;
  disable_comment?: boolean;
  disable_duet?: boolean;
  disable_stitch?: boolean;
  video_cover_timestamp_ms?: number;
  /** "Branded Content" / paid partnership. */
  brand_content_toggle?: boolean;
  /** "Your Brand" / promotional content. */
  brand_organic_toggle?: boolean;
  /** AI-generated content disclosure. */
  is_aigc?: boolean;
}

/**
 * Enforces the guideline rules that must hold no matter which client posted, so
 * a bug in the compose UI can't produce a non-compliant post.
 */
export function validatePostSettings(settings: TikTokPostSettings, creator?: TikTokCreatorInfo): void {
  if (!settings.privacy_level) {
    throw new Error("A privacy level must be chosen before posting to TikTok");
  }
  if (creator && creator.privacy_level_options.length && !creator.privacy_level_options.includes(settings.privacy_level)) {
    throw new Error(`Privacy level ${settings.privacy_level} is no longer permitted for this account`);
  }
  // TikTok: branded content cannot be private.
  if (settings.brand_content_toggle && settings.privacy_level === "SELF_ONLY") {
    throw new Error("Branded content cannot be posted with SELF_ONLY visibility");
  }
  if (creator?.comment_disabled && settings.disable_comment === false) {
    throw new Error("This account has comments disabled — they cannot be enabled for a post");
  }
  if (creator?.duet_disabled && settings.disable_duet === false) {
    throw new Error("This account has duet disabled — it cannot be enabled for a post");
  }
  if (creator?.stitch_disabled && settings.disable_stitch === false) {
    throw new Error("This account has stitch disabled — it cannot be enabled for a post");
  }
  if ([...settings.title].length > TIKTOK_TITLE_MAX) {
    throw new Error(`TikTok caption exceeds ${TIKTOK_TITLE_MAX} characters`);
  }
}

/** Picks a chunk plan satisfying TikTok's 5–64 MB / ≤1000 chunk rules. */
export function planChunks(videoSize: number): { chunkSize: number; totalChunks: number } {
  if (videoSize <= 0) throw new Error("TikTok upload: empty video");
  if (videoSize > MAX_VIDEO_BYTES) throw new Error("TikTok upload: video exceeds the 4 GB limit");

  // Anything up to the 64 MB max chunk size goes as one chunk sized exactly to
  // the file. Below 5 MB TikTok *requires* whole-file; between 5 and 64 MB it is
  // simply the correct single-chunk plan. Note chunk_size must never exceed
  // video_size, or total_chunk_count = floor(video_size / chunk_size) is 0.
  if (videoSize <= MAX_CHUNK_BYTES) return { chunkSize: videoSize, totalChunks: 1 };

  let chunkSize = DEFAULT_CHUNK_BYTES;
  if (Math.floor(videoSize / chunkSize) > MAX_CHUNK_COUNT) {
    chunkSize = Math.ceil(videoSize / MAX_CHUNK_COUNT);
  }
  if (chunkSize > MAX_CHUNK_BYTES || chunkSize < MIN_CHUNK_BYTES) {
    throw new Error("TikTok upload: video cannot be chunked within TikTok's limits");
  }
  // Trailing bytes ride along with the final chunk rather than forming a
  // short one, which TikTok rejects for being under the minimum.
  return { chunkSize, totalChunks: Math.floor(videoSize / chunkSize) };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadChunks(uploadUrl: string, video: Buffer, chunkSize: number, totalChunks: number): Promise<void> {
  const size = video.byteLength;
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end   = i === totalChunks - 1 ? size - 1 : start + chunkSize - 1;
    const slice = video.subarray(start, end + 1);
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Range": `bytes ${start}-${end}/${size}`,
      },
      body: new Uint8Array(slice),
    });
    // 206 = more chunks expected, 201 = upload complete.
    if (!res.ok && res.status !== 206) {
      const text = await res.text().catch(() => "");
      throw new Error(`TikTok chunk ${i + 1}/${totalChunks} upload failed: ${res.status} ${text.slice(0, 200)}`);
    }
  }
}

/**
 * Publish a video via TikTok's Content Posting API using FILE_UPLOAD (not
 * PULL_FROM_URL — that requires verifying the video URL's domain with TikTok,
 * which isn't practical since videos live on a shared Supabase Storage domain).
 *
 * `settings` must originate from the compose UI, where the user chose them
 * against a live creator_info response. There is deliberately no default
 * privacy level: posting without an explicit choice violates TikTok's UX rules.
 */
export async function postTikTokVideo(
  workspaceId: string,
  params: { videoUrl: string; settings: TikTokPostSettings },
): Promise<{ id: string; status: string }> {
  if (!params.videoUrl) throw new Error("TikTok post requires a video");
  const { token } = await getAccessToken(workspaceId);

  // Re-check against live creator settings: a scheduled post may have been
  // composed days ago, and the account's permissions can have changed since.
  const creator = await fetchCreatorInfo(workspaceId).catch(() => undefined);
  validatePostSettings(params.settings, creator);

  const videoRes = await fetch(params.videoUrl);
  if (!videoRes.ok) throw new Error(`Failed to fetch video for TikTok upload: ${videoRes.status}`);
  const videoBuf = Buffer.from(await videoRes.arrayBuffer());
  const { chunkSize, totalChunks } = planChunks(videoBuf.byteLength);

  const s = params.settings;
  const initRes = await fetch(TT_INIT, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      post_info: {
        title: s.title.slice(0, TIKTOK_TITLE_MAX),
        privacy_level: s.privacy_level,
        disable_comment: !!s.disable_comment,
        disable_duet:    !!s.disable_duet,
        disable_stitch:  !!s.disable_stitch,
        ...(s.video_cover_timestamp_ms !== undefined ? { video_cover_timestamp_ms: s.video_cover_timestamp_ms } : {}),
        brand_content_toggle: !!s.brand_content_toggle,
        brand_organic_toggle: !!s.brand_organic_toggle,
        is_aigc: !!s.is_aigc,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoBuf.byteLength,
        chunk_size: chunkSize,
        total_chunk_count: totalChunks,
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

  try {
    await uploadChunks(uploadUrl, videoBuf, chunkSize, totalChunks);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logActivity({ source: "adapter:tiktok", source_type: "adapter", event_type: "post_failed", summary: msg.slice(0, 500), payload: { publish_id: publishId } });
    throw e;
  }

  // Return as soon as the bytes are accepted. The caller polls
  // fetchPublishStatus() so the UI can show progress — blocking here for a
  // minute made the publish request look hung and showed the user nothing.
  await logActivity({
    source: "adapter:tiktok", source_type: "adapter", event_type: "post_submitted",
    summary: `TikTok publish ${publishId} uploaded (${totalChunks} chunk${totalChunks === 1 ? "" : "s"})`,
    payload: { publish_id: publishId },
  });
  return { id: publishId, status: "PROCESSING_UPLOAD" };
}

export interface TikTokPublishStatus {
  status: string;
  fail_reason?: string;
  publicly_available_post_id?: string[];
}

/** Polls one publish. Callers drive the cadence so progress can be shown live. */
export async function fetchPublishStatus(workspaceId: string, publishId: string): Promise<TikTokPublishStatus> {
  const { token } = await getAccessToken(workspaceId);
  const res = await fetch(TT_STATUS, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ publish_id: publishId }),
  });
  const json = (await res.json()) as {
    data?: { status?: string; fail_reason?: string; publicly_available_post_id?: string[] };
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`TikTok status fetch failed: ${json.error?.message ?? JSON.stringify(json)}`);
  return {
    status: json.data?.status ?? "UNKNOWN",
    fail_reason: json.data?.fail_reason,
    publicly_available_post_id: json.data?.publicly_available_post_id,
  };
}

/**
 * Server-side wait used by the scheduler, which has no UI to poll from.
 * Does not hard-fail on timeout — the upload already succeeded and TikTok will
 * finish processing regardless.
 */
export async function waitForPublish(workspaceId: string, publishId: string, attempts = 20): Promise<string> {
  let last = "PROCESSING_UPLOAD";
  for (let i = 0; i < attempts; i++) {
    await sleep(3000);
    const s = await fetchPublishStatus(workspaceId, publishId).catch(() => null);
    if (!s) continue;
    last = s.status;
    if (last === "PUBLISH_COMPLETE") break;
    if (last === "FAILED") {
      await logActivity({ source: "adapter:tiktok", source_type: "adapter", event_type: "post_failed", summary: `publish failed: ${s.fail_reason ?? "unknown"}`, payload: { publish_id: publishId } });
      throw new Error(`TikTok publish failed: ${s.fail_reason ?? "unknown"}`);
    }
  }
  if (last !== "PUBLISH_COMPLETE") {
    await logActivity({ source: "adapter:tiktok", source_type: "adapter", event_type: "post_pending", summary: `TikTok publish ${publishId} still processing after poll timeout`, payload: { publish_id: publishId, last_status: last } });
  } else {
    await logActivity({ source: "adapter:tiktok", source_type: "adapter", event_type: "post_success", summary: `TikTok publish ${publishId}`, payload: { publish_id: publishId, status: last } });
  }
  return last;
}

// ── Disconnect ───────────────────────────────────────────────────────────────

/**
 * Revokes the stored token with TikTok and clears it locally. Required for
 * review: users must be able to sever the connection from inside the app.
 * Local state is cleared even if TikTok's revoke call fails, so a disconnect
 * never leaves a token the operator believes is gone.
 */
export async function revokeAccess(workspaceId: string): Promise<{ revoked: boolean }> {
  const { clientKey, clientSecret } = requireEnv();
  const auth = (await loadAuthState(workspaceId)).tokens;
  let revoked = false;
  if (auth?.access_token) {
    const res = await fetch(TT_REVOKE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, token: auth.access_token }),
    }).catch(() => null);
    revoked = !!res?.ok;
  }
  await writeAuthState(workspaceId, {}, { enabled: false, connected_at: null });
  await logActivity({
    source: "adapter:tiktok", source_type: "adapter", event_type: "oauth_disconnected",
    summary: revoked ? "TikTok account disconnected and token revoked" : "TikTok account disconnected (remote revoke not confirmed)",
    payload: { revoked },
  });
  return { revoked };
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
