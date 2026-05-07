import type { Context } from "hono";
import { exchangeCodeForTokens } from "../adapters/x.js";

export async function oauthCallbackGet(c: Context) {
  const slug = c.req.param("slug");
  if (slug !== "x") return c.text("unsupported channel", 400);
  const code = c.req.query("code");
  const state = c.req.query("state");
  const err = c.req.query("error");
  if (err) return c.html(`<p>OAuth error: ${err}</p><p><a href="/">Back to Vantage</a></p>`, 400);
  if (!code || !state) return c.text("missing code or state", 400);
  try {
    await exchangeCodeForTokens(code, state);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.html(`<p>Token exchange failed: ${msg}</p>`, 500);
  }
  const spa = process.env.CORS_ORIGIN ?? "http://localhost:5173";
  return c.redirect(`${spa}/channels?connected=x`);
}
