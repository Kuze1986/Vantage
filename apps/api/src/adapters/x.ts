import { createHash, createHmac, randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { RateLimitError, parseRetryAfter } from "../lib/rate-limit-error.js";

const X_AUTH = "https://twitter.com/i/oauth2/authorize";
const X_TOKEN = "https://api.twitter.com/2/oauth2/token";
const X_TWEETS = "https://api.twitter.com/2/tweets";

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthorizeUrl(params: { state: string; code_challenge: string }): string {
  const clientId = process.env.X_CLIENT_ID;
  const redirect = process.env.X_REDIRECT_URI;
  if (!clientId || !redirect) throw new Error("Missing X_CLIENT_ID or X_REDIRECT_URI");
  const u = new URL(X_AUTH);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("scope", "tweet.read tweet.write users.read offline.access");
  u.searchParams.set("state", params.state);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("code_challenge", params.code_challenge);
  return u.toString();
}

type XAuthState = {
  pending_oauth?: { state: string; code_verifier: string; created_at: string };
  tokens?: {
    access_token: string;
    refresh_token?: string;
    expires_at?: string;
  };
};

export async function savePendingOAuth(state: string, verifier: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const auth_state: XAuthState = {
    pending_oauth: { state, code_verifier: verifier, created_at: new Date().toISOString() },
  };
  const { error } = await sb
    
    .from("channels")
    .update({ auth_state })
    .eq("slug", "x");
  if (error) throw new Error(error.message);
}

export async function exchangeCodeForTokens(code: string, state: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const { data: row, error } = await sb.from("channels").select("auth_state").eq("slug", "x").single();
  if (error) throw new Error(error.message);
  const auth = (row?.auth_state ?? {}) as XAuthState;
  const pending = auth.pending_oauth;
  if (!pending || pending.state !== state) {
    throw new Error("Invalid OAuth state");
  }
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  const redirect = process.env.X_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirect) throw new Error("Missing X OAuth env");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
    code_verifier: pending.code_verifier,
    client_id: clientId,
  });

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(X_TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    await logActivity({
      source: "adapter:x",
      source_type: "adapter",
      event_type: "oauth_token_error",
      summary: JSON.stringify(json).slice(0, 500),
      payload: json,
    });
    throw new Error(`X token exchange failed: ${res.status}`);
  }
  const access_token = typeof json.access_token === "string" ? json.access_token : null;
  const refresh_token = typeof json.refresh_token === "string" ? json.refresh_token : undefined;
  const expires_in = typeof json.expires_in === "number" ? json.expires_in : 7200;
  if (!access_token) throw new Error("X token response missing access_token");

  const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();
  const next: XAuthState = {
    tokens: { access_token, refresh_token, expires_at },
  };
  const { error: upErr } = await sb
    
    .from("channels")
    .update({ auth_state: next, enabled: true })
    .eq("slug", "x");
  if (upErr) throw new Error(upErr.message);

  await logActivity({
    source: "adapter:x",
    source_type: "adapter",
    event_type: "oauth_connected",
    summary: "X account connected",
    payload: { expires_at },
  });
}

async function getAccessToken(): Promise<string> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("channels").select("auth_state").eq("slug", "x").single();
  if (error) throw new Error(error.message);
  const auth = (data?.auth_state ?? {}) as XAuthState;
  const token = auth.tokens?.access_token;
  if (!token) throw new Error("X channel not connected");
  const exp = auth.tokens?.expires_at ? Date.parse(auth.tokens.expires_at) : 0;
  if (exp && Date.now() > exp - 60_000 && auth.tokens?.refresh_token) {
    return refreshAccessToken(auth.tokens.refresh_token);
  }
  return token;
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing X OAuth env");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(X_TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`X refresh failed: ${res.status} ${JSON.stringify(json)}`);
  }
  const access_token = typeof json.access_token === "string" ? json.access_token : null;
  const new_refresh = typeof json.refresh_token === "string" ? json.refresh_token : refreshToken;
  const expires_in = typeof json.expires_in === "number" ? json.expires_in : 7200;
  if (!access_token) throw new Error("X refresh missing access_token");
  const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();
  const sb = getSupabaseAdmin();
  const next: XAuthState = { tokens: { access_token, refresh_token: new_refresh, expires_at } };
  const { error } = await sb.from("channels").update({ auth_state: next }).eq("slug", "x");
  if (error) throw new Error(error.message);
  return access_token;
}

export async function postTweet(text: string): Promise<{ id: string }> {
  const access = await getAccessToken();
  const res = await fetch(X_TWEETS, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  const json = (await res.json()) as {
    data?: { id: string };
    errors?: { detail?: string }[];
    title?: string;
    detail?: string;
  };
  if (!res.ok) {
    // 3B-4: surface rate limits as a typed error so the scheduler can reschedule
    if (res.status === 429) {
      const delayMs = parseRetryAfter(res.headers.get("retry-after"), 15 * 60_000);
      throw new RateLimitError(`X rate limit — retry after ${Math.round(delayMs / 60000)}m`, delayMs);
    }
    const detail = json.errors?.[0]?.detail ?? json.detail ?? JSON.stringify(json);
    await logActivity({
      source: "adapter:x",
      source_type: "adapter",
      event_type: "post_failed",
      summary: detail.slice(0, 500),
      payload: json as Record<string, unknown>,
    });
    throw new Error(`X post failed: ${detail}`);
  }
  const id = json.data?.id;
  if (!id) throw new Error("X post: missing tweet id");
  await logActivity({
    source: "adapter:x",
    source_type: "adapter",
    event_type: "post_success",
    summary: `Tweet ${id} published`,
    payload: { id },
  });
  return { id };
}

export function crcResponseToken(crcToken: string, consumerSecret: string): string {
  const hmac = createHmac("sha256", consumerSecret).update(crcToken).digest("base64");
  return `sha256=${hmac}`;
}
