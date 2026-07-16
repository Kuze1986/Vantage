import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { RateLimitError, parseRetryAfter } from "../lib/rate-limit-error.js";

// Bluesky runs on the AT Protocol. Auth is credential-based (handle + app password),
// not an OAuth redirect — so this adapter exposes connect()/postBluesky() instead of
// the buildAuthorizeUrl/exchangeCodeForTokens shape the OAuth channels use.
const DEFAULT_PDS = "https://bsky.social";
const POST_LIMIT = 300; // graphemes; we approximate with chars

type BlueskyAuthState = {
  tokens?: { accessJwt: string; refreshJwt: string; did: string; handle: string; pds: string };
};

function pdsHost(): string {
  return process.env.BLUESKY_PDS_URL || DEFAULT_PDS;
}

/**
 * Connect a workspace's Bluesky account. The user generates an app password in
 * Bluesky Settings → App Passwords and pastes it here with their handle.
 */
export async function connect(workspaceId: string, handle: string, appPassword: string): Promise<{ did: string; handle: string }> {
  const pds = pdsHost();
  const res = await fetch(`${pds}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: handle.replace(/^@/, ""), password: appPassword }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof json.message === "string" ? json.message : JSON.stringify(json);
    throw new Error(`Bluesky sign-in failed: ${msg}`);
  }
  const accessJwt  = typeof json.accessJwt  === "string" ? json.accessJwt  : null;
  const refreshJwt = typeof json.refreshJwt === "string" ? json.refreshJwt : null;
  const did        = typeof json.did        === "string" ? json.did        : null;
  const resolvedHandle = typeof json.handle === "string" ? json.handle : handle;
  if (!accessJwt || !refreshJwt || !did) throw new Error("Bluesky session response missing tokens");

  const sb = getSupabaseAdmin();
  const auth_state: BlueskyAuthState = { tokens: { accessJwt, refreshJwt, did, handle: resolvedHandle, pds } };
  const { error } = await sb.from("channels").update({ auth_state, enabled: true }).eq("workspace_id", workspaceId).eq("slug", "bluesky");
  if (error) throw new Error(error.message);

  await logActivity({ source: "adapter:bluesky", source_type: "adapter", event_type: "oauth_connected", summary: `Bluesky account @${resolvedHandle} connected`, payload: { did } });
  return { did, handle: resolvedHandle };
}

async function loadTokens(workspaceId: string): Promise<NonNullable<BlueskyAuthState["tokens"]>> {
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("channels").select("auth_state").eq("workspace_id", workspaceId).eq("slug", "bluesky").single();
  const tokens = ((data?.auth_state ?? {}) as BlueskyAuthState).tokens;
  if (!tokens?.accessJwt) throw new Error("Bluesky channel not connected");
  return tokens;
}

/** Refresh the access JWT using the (long-lived, rotating) refresh JWT. */
async function refreshSession(workspaceId: string, tokens: NonNullable<BlueskyAuthState["tokens"]>): Promise<NonNullable<BlueskyAuthState["tokens"]>> {
  const res = await fetch(`${tokens.pds}/xrpc/com.atproto.server.refreshSession`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokens.refreshJwt}` },
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Bluesky session expired — reconnect the channel (${typeof json.message === "string" ? json.message : res.status})`);
  const next: NonNullable<BlueskyAuthState["tokens"]> = {
    accessJwt:  typeof json.accessJwt  === "string" ? json.accessJwt  : tokens.accessJwt,
    refreshJwt: typeof json.refreshJwt === "string" ? json.refreshJwt : tokens.refreshJwt,
    did:        typeof json.did        === "string" ? json.did        : tokens.did,
    handle:     typeof json.handle     === "string" ? json.handle     : tokens.handle,
    pds:        tokens.pds,
  };
  const sb = getSupabaseAdmin();
  await sb.from("channels").update({ auth_state: { tokens: next } }).eq("workspace_id", workspaceId).eq("slug", "bluesky");
  return next;
}

async function createPost(tokens: NonNullable<BlueskyAuthState["tokens"]>, text: string): Promise<Response> {
  const record = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
  };
  return fetch(`${tokens.pds}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokens.accessJwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ repo: tokens.did, collection: "app.bsky.feed.post", record }),
  });
}

export async function postBluesky(workspaceId: string, body: string): Promise<{ id: string; uri: string }> {
  let tokens = await loadTokens(workspaceId);
  const text = body.slice(0, POST_LIMIT);

  let res = await createPost(tokens, text);
  // Access JWT expired — refresh once and retry.
  if (res.status === 400 || res.status === 401) {
    tokens = await refreshSession(workspaceId, tokens);
    res = await createPost(tokens, text);
  }
  if (res.status === 429) {
    throw new RateLimitError("Bluesky rate limit — retry later", parseRetryAfter(res.headers.get("retry-after"), 5 * 60_000));
  }
  const json = (await res.json()) as { uri?: string; cid?: string; message?: string };
  if (!res.ok || !json.uri) {
    await logActivity({ source: "adapter:bluesky", source_type: "adapter", event_type: "post_failed", summary: (json.message ?? JSON.stringify(json)).slice(0, 500), payload: {} });
    throw new Error(`Bluesky post failed: ${(json.message ?? res.status).toString().slice(0, 200)}`);
  }
  // rkey (the trailing segment of the AT URI) is the stable post id.
  const id = json.uri.split("/").pop() ?? json.cid ?? "unknown";
  await logActivity({ source: "adapter:bluesky", source_type: "adapter", event_type: "post_success", summary: `Bluesky post ${id}`, payload: { id, uri: json.uri } });
  return { id, uri: json.uri };
}
