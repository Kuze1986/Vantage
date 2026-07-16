import type { Context } from "hono";
import { logActivity } from "../lib/activity.js";
import { exchangeCodeForTokens as exchangeX } from "../adapters/x.js";
import { exchangeCodeForTokens as exchangeLinkedIn } from "../adapters/linkedin.js";
import { exchangeCodeForTokens as exchangeReddit } from "../adapters/reddit.js";
import { exchangeCodeForTokens as exchangeThreads } from "../adapters/threads.js";

// OAuth redirect channels and their token-exchange handlers. Credential channels
// (e.g. Bluesky) connect via POST /v1/channels/:slug/connect, not this callback.
const EXCHANGERS: Record<string, (code: string, state: string) => Promise<void>> = {
  x:        exchangeX,
  linkedin: exchangeLinkedIn,
  reddit:   exchangeReddit,
  threads:  exchangeThreads,
};

export async function oauthCallbackGet(c: Context) {
  const slug = c.req.param("slug") ?? "";
  const exchange = EXCHANGERS[slug];
  if (!exchange) return c.text("unsupported channel", 400);
  const code = c.req.query("code");
  const state = c.req.query("state");
  const err = c.req.query("error");
  if (err) {
    // The provider itself rejected the authorization (denied consent, bad client, etc.)
    const errDesc = c.req.query("error_description") ?? "";
    await logActivity({
      source: `adapter:${slug}`, source_type: "adapter", event_type: "oauth_denied",
      summary: `${slug} OAuth denied: ${err}${errDesc ? ` — ${errDesc}` : ""}`.slice(0, 500), payload: { error: err },
    }).catch(() => {});
    return c.html(`<p>OAuth error: ${err}</p><p><a href="/">Back to Vantage</a></p>`, 400);
  }
  if (!code || !state) return c.text("missing code or state", 400);
  try {
    await exchange(code, state);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Previously swallowed — log so token-exchange failures are diagnosable in activity_events.
    await logActivity({
      source: `adapter:${slug}`, source_type: "adapter", event_type: "oauth_callback_failed",
      summary: `${slug} token exchange failed: ${msg}`.slice(0, 500), payload: {},
    }).catch(() => {});
    return c.html(`<p>Token exchange failed: ${msg}</p>`, 500);
  }
  const spa = process.env.CORS_ORIGIN ?? "http://localhost:5173";
  return c.redirect(`${spa}/channels?connected=${slug}`);
}
