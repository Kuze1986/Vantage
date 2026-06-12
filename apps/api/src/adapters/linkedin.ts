import { createHash, randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { RateLimitError, parseRetryAfter } from "../lib/rate-limit-error.js";

const LI_AUTH   = "https://www.linkedin.com/oauth/v2/authorization";
const LI_TOKEN  = "https://www.linkedin.com/oauth/v2/accessToken";
const LI_ME     = "https://api.linkedin.com/v2/userinfo";
const LI_POSTS  = "https://api.linkedin.com/v2/ugcPosts";
const LI_ASSETS = "https://api.linkedin.com/v2/assets?action=registerUpload";

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

export async function savePendingOAuth(workspaceId: string, state: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const auth_state: LinkedInAuthState = {
    pending_oauth: { state, created_at: new Date().toISOString() },
  };
  const { error } = await sb.from("channels").update({ auth_state }).eq("workspace_id", workspaceId).eq("slug", "linkedin");
  if (error) throw new Error(error.message);
}

export async function exchangeCodeForTokens(code: string, state: string): Promise<void> {
  const { clientId, clientSecret, redirect } = requireEnv();
  const sb = getSupabaseAdmin();

  // Unauthenticated callback — resolve the workspace by matching the pending state.
  const { data: rows } = await sb.from("channels").select("workspace_id, auth_state").eq("slug", "linkedin");
  const match = (rows ?? []).find(
    (r) => ((r.auth_state ?? {}) as LinkedInAuthState).pending_oauth?.state === state,
  );
  if (!match) throw new Error("Invalid OAuth state");
  const workspaceId = match.workspace_id as string;

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
  const { error } = await sb.from("channels").update({ auth_state: next, enabled: true }).eq("workspace_id", workspaceId).eq("slug", "linkedin");
  if (error) throw new Error(error.message);

  await logActivity({ source: "adapter:linkedin", source_type: "adapter", event_type: "oauth_connected", summary: "LinkedIn account connected", payload: { person_urn } });
}

async function getAccessToken(workspaceId: string): Promise<{ token: string; personUrn: string }> {
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("channels").select("auth_state").eq("workspace_id", workspaceId).eq("slug", "linkedin").single();
  const auth = ((data?.auth_state ?? {}) as LinkedInAuthState).tokens;
  if (!auth?.access_token) throw new Error("LinkedIn channel not connected");
  const personUrn = auth.person_urn ?? "";
  if (!personUrn) throw new Error("LinkedIn person URN missing — reconnect the channel");
  return { token: auth.access_token, personUrn };
}

// ── 3A-3: Upload an image URL to LinkedIn and return the asset URN ────────────
async function uploadImageToLinkedIn(imageUrl: string, token: string, personUrn: string): Promise<string> {
  // Step 1: Register the upload
  const registerBody = {
    registerUploadRequest: {
      recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
      owner: personUrn,
      serviceRelationships: [{ relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" }],
    },
  };
  const regRes = await fetch(LI_ASSETS, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Restli-Protocol-Version": "2.0.0" },
    body: JSON.stringify(registerBody),
  });
  const regJson = (await regRes.json()) as {
    value?: { uploadMechanism?: { "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"?: { uploadUrl?: string } }; asset?: string }
  };
  const uploadUrl = regJson.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]?.uploadUrl;
  const assetUrn  = regJson.value?.asset;
  if (!uploadUrl || !assetUrn) {
    throw new Error("LinkedIn media register failed: missing uploadUrl or asset URN");
  }

  // Step 2: Download the source image and re-upload to LinkedIn's URL
  const imgRes  = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Failed to fetch image for LinkedIn upload: ${imgRes.status}`);
  const imgBuf  = await imgRes.arrayBuffer();
  const putRes  = await fetch(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": imgRes.headers.get("content-type") ?? "image/jpeg" },
    body: imgBuf,
  });
  if (!putRes.ok) {
    throw new Error(`LinkedIn image upload PUT failed: ${putRes.status}`);
  }

  return assetUrn;
}

export async function postLinkedIn(workspaceId: string, body: string, _headline?: string, imageUrl?: string): Promise<{ id: string }> {
  const { token, personUrn } = await getAccessToken(workspaceId);

  // 3A-3: Include image media if provided
  let shareMedia: unknown[] = [];
  let shareMediaCategory = "NONE";
  if (imageUrl) {
    try {
      const assetUrn = await uploadImageToLinkedIn(imageUrl, token, personUrn);
      shareMedia = [{ status: "READY", description: { text: "" }, media: assetUrn, title: { text: "" } }];
      shareMediaCategory = "IMAGE";
    } catch (imgErr) {
      // Log but don't fail the post — fall back to text-only
      await logActivity({ source: "adapter:linkedin", source_type: "adapter", event_type: "image_upload_failed", summary: String(imgErr), payload: { imageUrl } });
    }
  }

  const payload = {
    author: personUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: body },
        shareMediaCategory,
        ...(shareMedia.length > 0 ? { media: shareMedia } : {}),
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
    // 3B-4: rate limit detection
    if (res.status === 429) {
      const delayMs = parseRetryAfter(res.headers.get("retry-after") ?? res.headers.get("x-li-retry-after"), 5 * 60_000);
      throw new RateLimitError(`LinkedIn rate limit — retry after ${Math.round(delayMs / 60000)}m`, delayMs);
    }
    await logActivity({ source: "adapter:linkedin", source_type: "adapter", event_type: "post_failed", summary: text.slice(0, 500), payload: {} });
    throw new Error(`LinkedIn post failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const id = res.headers.get("x-restli-id") ?? createHash("sha256").update(body).digest("hex").slice(0, 12);
  await logActivity({ source: "adapter:linkedin", source_type: "adapter", event_type: "post_success", summary: `LinkedIn post ${id}`, payload: { id, hasImage: !!imageUrl } });
  return { id };
}

export async function generateState(): Promise<string> {
  return randomBytes(16).toString("hex");
}
