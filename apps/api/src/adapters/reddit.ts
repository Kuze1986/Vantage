import { randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { RateLimitError, parseRetryAfter } from "../lib/rate-limit-error.js";

const REDDIT_AUTH  = "https://www.reddit.com/api/v1/authorize";
const REDDIT_TOKEN = "https://www.reddit.com/api/v1/access_token";
const REDDIT_API   = "https://oauth.reddit.com";
// Reddit blocks generic/non-compliant User-Agents (403). Format Reddit expects:
// "<platform>:<app id>:<version> (by /u/<your reddit username>)". Set REDDIT_USER_AGENT
// in the API env with your real username for best results.
// .trim(): a stray leading/trailing space (easy to introduce in a Railway env value)
// makes the header malformed and Reddit's edge 403s it.
const USER_AGENT   = (process.env.REDDIT_USER_AGENT ?? "web:vantage:1.0.0 (by /u/vantage-app)").trim();

type RedditAuthState = {
  pending_oauth?: { state: string; created_at: string };
  tokens?: { access_token: string; refresh_token?: string; expires_at?: string };
};

function requireEnv(): { clientId: string; clientSecret: string; redirect: string } {
  const clientId     = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const redirect     = process.env.REDDIT_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirect) {
    throw new Error("Reddit OAuth not configured: set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_REDIRECT_URI");
  }
  return { clientId, clientSecret, redirect };
}

export function buildAuthorizeUrl(stateToken: string): string {
  const { clientId, redirect } = requireEnv();
  const u = new URL(REDDIT_AUTH);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", stateToken);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("duration", "permanent");
  u.searchParams.set("scope", "submit identity read");
  return u.toString();
}

export async function savePendingOAuth(workspaceId: string, state: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const auth_state: RedditAuthState = { pending_oauth: { state, created_at: new Date().toISOString() } };
  const { error } = await sb.from("channels").update({ auth_state }).eq("workspace_id", workspaceId).eq("slug", "reddit");
  if (error) throw new Error(error.message);
}

export async function exchangeCodeForTokens(code: string, state: string): Promise<void> {
  const { clientId, clientSecret, redirect } = requireEnv();
  const sb = getSupabaseAdmin();
  // Unauthenticated callback — resolve the workspace by matching the pending state.
  const { data: rows } = await sb.from("channels").select("workspace_id, auth_state").eq("slug", "reddit");
  const match = (rows ?? []).find(
    (r) => ((r.auth_state ?? {}) as RedditAuthState).pending_oauth?.state === state,
  );
  if (!match) throw new Error("Invalid OAuth state");
  const workspaceId = match.workspace_id as string;

  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect });
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(REDDIT_TOKEN, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    // Diagnostic: surfaces whether the UA change is live and whether Reddit's edge
    // (Fastly) is blocking — distinguishes a bad User-Agent from a datacenter-IP block.
    const diag = [
      `status=${res.status}`,
      `ua=${JSON.stringify(USER_AGENT)}`,
      `via=${res.headers.get("via") ?? ""}`,
      `x-served-by=${res.headers.get("x-served-by") ?? ""}`,
      `retry-after=${res.headers.get("retry-after") ?? ""}`,
    ].join("; ");
    throw new Error(`Reddit token exchange failed: ${JSON.stringify(json)} [${diag}]`);
  }

  const access_token  = typeof json.access_token  === "string" ? json.access_token  : null;
  const refresh_token = typeof json.refresh_token === "string" ? json.refresh_token : undefined;
  if (!access_token) throw new Error("Reddit token response missing access_token");
  const expires_in = typeof json.expires_in === "number" ? json.expires_in : 3600;
  const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();

  const next: RedditAuthState = { tokens: { access_token, refresh_token, expires_at } };
  const { error } = await sb.from("channels").update({ auth_state: next, enabled: true }).eq("workspace_id", workspaceId).eq("slug", "reddit");
  if (error) throw new Error(error.message);

  await logActivity({ source: "adapter:reddit", source_type: "adapter", event_type: "oauth_connected", summary: "Reddit account connected", payload: {} });
}

async function getAccessToken(workspaceId: string): Promise<string> {
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("channels").select("auth_state").eq("workspace_id", workspaceId).eq("slug", "reddit").single();
  const auth = ((data?.auth_state ?? {}) as RedditAuthState).tokens;
  if (!auth?.access_token) throw new Error("Reddit channel not connected");
  const exp = auth.expires_at ? Date.parse(auth.expires_at) : 0;
  if (exp && Date.now() > exp - 60_000 && auth.refresh_token) {
    return refreshAccessToken(workspaceId, auth.refresh_token);
  }
  return auth.access_token;
}

async function refreshAccessToken(workspaceId: string, refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = requireEnv();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  const res = await fetch(REDDIT_TOKEN, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Reddit refresh failed: ${JSON.stringify(json)}`);
  const access_token = typeof json.access_token === "string" ? json.access_token : null;
  if (!access_token) throw new Error("Reddit refresh missing access_token");
  const expires_in = typeof json.expires_in === "number" ? json.expires_in : 3600;
  const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();
  const sb = getSupabaseAdmin();
  const cur = await sb.from("channels").select("auth_state").eq("workspace_id", workspaceId).eq("slug", "reddit").single();
  const prev = ((cur.data?.auth_state ?? {}) as RedditAuthState).tokens;
  await sb.from("channels").update({
    auth_state: { tokens: { access_token, refresh_token: prev?.refresh_token ?? refreshToken, expires_at } }
  }).eq("workspace_id", workspaceId).eq("slug", "reddit");
  return access_token;
}

export async function postToSubreddit(workspaceId: string, params: {
  subreddit: string;
  title: string;
  body: string;
  is_link_post?: boolean;
  url?: string;
}): Promise<{ id: string; permalink: string }> {
  const token = await getAccessToken(workspaceId);
  const formBody = new URLSearchParams({
    api_type:  "json",
    sr:        params.subreddit,
    title:     params.title,
    kind:      params.is_link_post && params.url ? "link" : "self",
    ...(params.is_link_post && params.url ? { url: params.url } : { text: params.body }),
    resubmit:  "true",
    nsfw:      "false",
  });
  const res = await fetch(`${REDDIT_API}/api/submit`, {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body: formBody,
  });
  const json = (await res.json()) as { json?: { data?: { id?: string; url?: string }; errors?: [string, string, string][] } };
  // 3B-4: rate limit detection (Reddit uses x-ratelimit-remaining header too)
  if (res.status === 429) {
    const delayMs = parseRetryAfter(res.headers.get("retry-after"), 5 * 60_000);
    throw new RateLimitError(`Reddit rate limit — retry after ${Math.round(delayMs / 60000)}m`, delayMs);
  }
  const errors = json.json?.errors;
  if (errors && errors.length > 0) {
    const detail = errors.map(([_code, msg]) => msg).join("; ");
    await logActivity({ source: "adapter:reddit", source_type: "adapter", event_type: "post_failed", summary: detail, payload: json as Record<string, unknown> });
    throw new Error(`Reddit post error: ${detail}`);
  }
  const id = json.json?.data?.id ?? "unknown";
  const permalink = json.json?.data?.url ?? `https://reddit.com/r/${params.subreddit}`;
  await logActivity({ source: "adapter:reddit", source_type: "adapter", event_type: "post_success", summary: `Reddit post ${id} in r/${params.subreddit}`, payload: { id, permalink } });
  return { id, permalink };
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}
