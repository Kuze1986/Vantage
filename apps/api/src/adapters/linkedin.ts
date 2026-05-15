import { createHash, randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";

const LI_AUTH   = "https://www.linkedin.com/oauth/v2/authorization";
const LI_TOKEN  = "https://www.linkedin.com/oauth/v2/accessToken";
const LI_ME     = "https://api.linkedin.com/v2/userinfo";
const LI_POSTS  = "https://api.linkedin.com/v2/ugcPosts";

type LinkedInAuthState = {
  pending_oauth?: { state: string; created_at: string };
  tokens?: { access_token: string; expires_at?: string; person_urn?: string };
};

function requireEnv(): { clientId: string; clientSecret: string; redirect: string } {
  const clientId     = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirect     = process.env.LINKEDIN_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirect) {
    throw new Error("LinkedIn OAuth not configured: set LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_REDIRECT_URI");
  }
  return { clientId, clientSecret, redirect };
}

export function buildAuthorizeUrl(stateToken: string): string {
  const { clientId, redirect } = requireEnv();
  const u = new URL(LI_AUTH);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("state", stateToken);
  u.searchParams.set("scope", "openid profile w_member_social");
  return u.toString();
}

export async function savePendingOAuth(state: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const auth_state: LinkedInAuthState = {
    pending_oauth: { state, created_at: new Date().toISOString() },
  };
  const { error } = await sb.schema("vantage").from("channels").update({ auth_state }).eq("slug", "linkedin");
  if (error) throw new Error(error.message);
}

export async function exchangeCodeForTokens(code: string, state: string): Promise<void> {
  const { clientId, clientSecret, redirect } = requireEnv();
  const sb = getSupabaseAdmin();

  const { data: row } = await sb.schema("vantage").from("channels").select("auth_state").eq("slug", "linkedin").single();
  const pending = ((row?.auth_state ?? {}) as LinkedInAuthState).pending_oauth;
  if (!pending || pending.state !== state) throw new Error("Invalid OAuth state");

  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: clientId, client_secret: clientSecret });
  const res = await fetch(LI_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`LinkedIn token exchange failed: ${JSON.stringify(json)}`);

  const access_token = typeof json.access_token === "string" ? json.access_token : null;
  if (!access_token) throw new Error("LinkedIn token response missing access_token");
  const expires_in = typeof json.expires_in === "number" ? json.expires_in : 5184000;
  const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();

  // Fetch the member URN (needed to author posts)
  const meRes = await fetch(LI_ME, { headers: { Authorization: `Bearer ${access_token}` } });
  const me = (await meRes.json()) as Record<string, unknown>;
  const person_urn = typeof me.sub === "string" ? `urn:li:person:${me.sub}` : undefined;

  const next: LinkedInAuthState = { tokens: { access_token, expires_at, person_urn } };
  const { error } = await sb.schema("vantage").from("channels").update({ auth_state: next, enabled: true }).eq("slug", "linkedin");
  if (error) throw new Error(error.message);

  await logActivity({ source: "adapter:linkedin", source_type: "adapter", event_type: "oauth_connected", summary: "LinkedIn account connected", payload: { person_urn } });
}

async function getAccessToken(): Promise<{ token: string; personUrn: string }> {
  const sb = getSupabaseAdmin();
  const { data } = await sb.schema("vantage").from("channels").select("auth_state").eq("slug", "linkedin").single();
  const auth = ((data?.auth_state ?? {}) as LinkedInAuthState).tokens;
  if (!auth?.access_token) throw new Error("LinkedIn channel not connected");
  const personUrn = auth.person_urn ?? "";
  if (!personUrn) throw new Error("LinkedIn person URN missing — reconnect the channel");
  return { token: auth.access_token, personUrn };
}

export async function postLinkedIn(body: string, _headline?: string): Promise<{ id: string }> {
  const { token, personUrn } = await getAccessToken();
  const payload = {
    author: personUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: body },
        shareMediaCategory: "NONE",
      },
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
  };
  const res = await fetch(LI_POSTS, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Restli-Protocol-Version": "2.0.0" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    await logActivity({ source: "adapter:linkedin", source_type: "adapter", event_type: "post_failed", summary: text.slice(0, 500), payload: {} });
    throw new Error(`LinkedIn post failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const id = res.headers.get("x-restli-id") ?? createHash("sha256").update(body).digest("hex").slice(0, 12);
  await logActivity({ source: "adapter:linkedin", source_type: "adapter", event_type: "post_success", summary: `LinkedIn post ${id}`, payload: { id } });
  return { id };
}

export async function generateState(): Promise<string> {
  return randomBytes(16).toString("hex");
}
