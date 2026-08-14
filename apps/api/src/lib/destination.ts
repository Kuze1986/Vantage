/**
 * Cross-promotion destination links.
 *
 * The pipeline could tag URLs (utm.ts) but nothing ever put one into
 * generated content — no format schema has a link field, so every published
 * piece shipped with nothing to click. This resolves what a piece should
 * point at and appends it deterministically, never leaving it to the model:
 * an LLM asked to emit a URL will hallucinate or drop it, and a wrong link in
 * a published, mostly-uneditable post is worse than no link at all.
 */
import { CHANNEL_LINK_POLICY, type ChannelSlug, type LinkPolicy } from "@vantage/prompts";
import { getSupabaseAdmin } from "./supabase.js";
import { loadProductProfile } from "./product-profile.js";
import { checkTargetUrl } from "./target-url.js";

export type { LinkPolicy };

export interface Destination {
  /** Resolved link, or null when nothing is configured or it failed validation. */
  url: string | null;
  policy: LinkPolicy;
}

/**
 * Resolve the link a piece should promote, and how that link may reach the
 * audience on the given channel.
 *
 * Precedence: an active campaign's own `destination_url` wins — a campaign
 * can promote a different product than the workspace default, which is what
 * lets one Vantage instance promote three sibling products — otherwise the
 * workspace's `product_profile.product_base_url`. Neither may be set, in
 * which case `url` is null and nothing is appended.
 */
export async function resolveDestination(
  workspaceId: string,
  channel: ChannelSlug,
  campaignId?: string | null,
): Promise<Destination> {
  const policy = CHANNEL_LINK_POLICY[channel] ?? "inline";

  let url: string | null = null;
  if (campaignId) {
    const sb = getSupabaseAdmin();
    const { data } = await sb
      .from("campaigns")
      .select("destination_url")
      .eq("id", campaignId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const campaignUrl = data?.destination_url;
    if (typeof campaignUrl === "string" && campaignUrl.trim()) url = campaignUrl.trim();
  }
  if (!url) {
    const profile = await loadProductProfile(workspaceId);
    if (profile.product_base_url) url = profile.product_base_url;
  }
  if (!url) return { url: null, policy };

  // Degrade to no link rather than ship a typo'd URL inside a published post
  // that can't be edited on most platforms — the same check DemoForge uses
  // on its recording target, where the failure mode (comma for dot, wrong
  // subdomain) is identical.
  if (!checkTargetUrl(url).ok) return { url: null, policy };

  return { url, policy };
}

/**
 * Append the resolved destination to a generated piece's body, if the
 * channel's policy is `inline`.
 *
 * All formats that carry prose (tweet, linkedin_post, reddit_thread,
 * threads_post, bluesky_post, email_newsletter, facebook_post) key their
 * primary text on `body`, so a single field name covers every inline format.
 * `bio`-policy formats (tiktok_script, instagram_caption) are untouched —
 * captions aren't clickable, so the link belongs in the account bio, which
 * is standing per-workspace configuration rather than a per-piece field.
 *
 * The link is appended raw, with no UTM parameters — the existing
 * `tagUrls()` call at each insert site decorates whatever URLs are present
 * once the piece id is known, so this only needs to make sure a URL exists.
 */
export function appendDestination(
  payload: Record<string, unknown>,
  destination: Destination,
): Record<string, unknown> {
  if (destination.policy !== "inline" || !destination.url) return payload;
  const body = payload.body;
  if (typeof body !== "string" || !body.trim()) return payload;
  if (body.includes(destination.url)) return payload; // model already wrote it — don't double up
  return { ...payload, body: `${body.trim()}\n\n${destination.url}` };
}
