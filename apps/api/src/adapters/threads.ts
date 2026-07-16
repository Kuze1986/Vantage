import { createHash, randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { RateLimitError, parseRetryAfter } from "../lib/rate-limit-error.js";

// Meta Threads API (Graph-based). Authorize on threads.net, everything else on graph.threads.net.
const TH_AUTH    = "https://threads.net/oauth/authorize";
const TH_TOKEN   = "https://graph.threads.net/oauth/access_token";        // short-lived exchange
const TH_LONG    = "https://graph.threads.net/access_token";             // short → long-lived (60d)
const TH_REFRESH = "https://graph.threads.net/refresh_access_token";     // long-lived refresh
const TH_GRAPH   = "https://graph.threads.net/v1.0";

type ThreadsAuthState = {
  pending_oauth?: { state: string; created_at: string };
  tokens?: { access_token: string; expires_at?: string; user_id?: string };
};

function requireEnv(): { clientId: string; clientSecret: string; redirect: string } {
  const clientId     = process.env.THREADS_CLIENT_ID;
  const clientSecret = process.env.THREADS_CLIENT_SECRET;
  const redirect     = process.env.THREADS_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirect) {
    throw new Error("Threads OAuth not configured: set THREADS_CLIENT_ID, THREADS_CLIENT_SECRET, THREADS_REDIRECT_URI");
  }
  return { clientId, clientSecret, redirect };
}

export function buildAuthorizeUrl(stateToken: string): string {
  const { clientId, redirect } = requireEnv();
  const u = new URL(TH_AUTH);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", stateToken);
  u.searchParams.set("scope", "threads_basic,threads_content_publish");
  return u.toString();
}

export async function savePendingOAuth(workspaceId: string, state: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const auth_state: ThreadsAuthState = { pending_oauth: { state, created_at: new Date().toISOString() } };
  const { error } = await sb.from("channels").update({ auth_state }).eq("workspace_id", workspaceId).eq("slug", "threads");
  if (error) throw new Error(error.message);
}

export async function exchangeCodeForTokens(code: string, state: string): Promise<void> {
  const { clientId, clientSecret, redirect } = requireEnv();
  const sb = getSupabaseAdmin();

  // Unauthenticated callback — resolve the workspace by matching the pending state.
  const { data: rows } = await sb.from("channels").select("workspace_id, auth_state").eq("slug", "threads");
  const match = (rows ?? []).find(
    (r) => ((r.auth_state ?? {}) as ThreadsAuthState).pending_oauth?.state === state,
  );
  if (!match) throw new Error("Invalid OAuth state");
  const workspaceId = match.workspace_id as string;

  // Step 1: short-lived token (also returns the Threads user id)
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    redirect_uri: redirect,
    code,
  });
  const res = await fetch(TH_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Threads token exchange failed: ${JSON.stringify(json)}`);
  const shortToken = typeof json.access_token === "string" ? json.access_token : null;
  const userId = json.user_id != null ? String(json.user_id) : undefined;
  if (!shortToken) throw new Error("Threads token response missing access_token");

  // Step 2: exchange for a long-lived token (~60 days)
  const longUrl = new URL(TH_LONG);
  longUrl.searchParams.set("grant_type", "th_exchange_token");
  longUrl.searchParams.set("client_secret", clientSecret);
  longUrl.searchParams.set("access_token", shortToken);
  const longRes = await fetch(longUrl);
  const longJson = (await longRes.json()) as Record<string, unknown>;
  // Fall back to the short-lived token if the exchange fails — posting still works short-term.
  const access_token = typeof longJson.access_token === "string" ? longJson.access_token : shortToken;
  const expires_in = typeof longJson.expires_in === "number" ? longJson.expires_in : 5184000;
  const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();

  const next: ThreadsAuthState = { tokens: { access_token, expires_at, user_id: userId } };
  const { error } = await sb.from("channels").update({ auth_state: next, enabled: true }).eq("workspace_id", workspaceId).eq("slug", "threads");
  if (error) throw new Error(error.message);

  await logActivity({ source: "adapter:threads", source_type: "adapter", event_type: "oauth_connected", summary: "Threads account connected", payload: { user_id: userId } });
}

async function getAccessToken(workspaceId: string): Promise<{ token: string; userId: string }> {
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("channels").select("auth_state").eq("workspace_id", workspaceId).eq("slug", "threads").single();
  const auth = ((data?.auth_state ?? {}) as ThreadsAuthState).tokens;
  if (!auth?.access_token) throw new Error("Threads channel not connected");
  if (!auth.user_id) throw new Error("Threads user id missing — reconnect the channel");

  // Long-lived tokens are refreshable within their 60-day window; refresh when <7 days remain.
  const exp = auth.expires_at ? Date.parse(auth.expires_at) : 0;
  if (exp && Date.now() > exp - 7 * 24 * 60 * 60 * 1000) {
    try {
      const refUrl = new URL(TH_REFRESH);
      refUrl.searchParams.set("grant_type", "th_refresh_token");
      refUrl.searchParams.set("access_token", auth.access_token);
      const refRes = await fetch(refUrl);
      const refJson = (await refRes.json()) as Record<string, unknown>;
      if (refRes.ok && typeof refJson.access_token === "string") {
        const expires_in = typeof refJson.expires_in === "number" ? refJson.expires_in : 5184000;
        const next: ThreadsAuthState = {
          tokens: { access_token: refJson.access_token, expires_at: new Date(Date.now() + expires_in * 1000).toISOString(), user_id: auth.user_id },
        };
        await sb.from("channels").update({ auth_state: next }).eq("workspace_id", workspaceId).eq("slug", "threads");
        return { token: refJson.access_token, userId: auth.user_id };
      }
    } catch {
      // Non-fatal — fall through and use the existing token.
    }
  }
  return { token: auth.access_token, userId: auth.user_id };
}

export async function postThread(workspaceId: string, body: string): Promise<{ id: string }> {
  const { token, userId } = await getAccessToken(workspaceId);
  const text = body.slice(0, 500); // Threads post limit

  // Step 1: create a media container
  const createUrl = new URL(`${TH_GRAPH}/${userId}/threads`);
  createUrl.searchParams.set("media_type", "TEXT");
  createUrl.searchParams.set("text", text);
  createUrl.searchParams.set("access_token", token);
  const createRes = await fetch(createUrl, { method: "POST" });
  const createJson = (await createRes.json()) as Record<string, unknown>;
  if (createRes.status === 429) {
    throw new RateLimitError("Threads rate limit — retry later", parseRetryAfter(createRes.headers.get("retry-after"), 5 * 60_000));
  }
  const creationId = createJson.id != null ? String(createJson.id) : null;
  if (!createRes.ok || !creationId) {
    await logActivity({ source: "adapter:threads", source_type: "adapter", event_type: "post_failed", summary: JSON.stringify(createJson).slice(0, 500), payload: {} });
    throw new Error(`Threads container create failed: ${JSON.stringify(createJson).slice(0, 200)}`);
  }

  // Step 2: publish the container
  const pubUrl = new URL(`${TH_GRAPH}/${userId}/threads_publish`);
  pubUrl.searchParams.set("creation_id", creationId);
  pubUrl.searchParams.set("access_token", token);
  const pubRes = await fetch(pubUrl, { method: "POST" });
  const pubJson = (await pubRes.json()) as Record<string, unknown>;
  if (pubRes.status === 429) {
    throw new RateLimitError("Threads rate limit — retry later", parseRetryAfter(pubRes.headers.get("retry-after"), 5 * 60_000));
  }
  const id = pubJson.id != null ? String(pubJson.id) : createHash("sha256").update(body).digest("hex").slice(0, 12);
  if (!pubRes.ok) {
    await logActivity({ source: "adapter:threads", source_type: "adapter", event_type: "post_failed", summary: JSON.stringify(pubJson).slice(0, 500), payload: {} });
    throw new Error(`Threads publish failed: ${JSON.stringify(pubJson).slice(0, 200)}`);
  }
  await logActivity({ source: "adapter:threads", source_type: "adapter", event_type: "post_success", summary: `Threads post ${id}`, payload: { id } });
  return { id };
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}
