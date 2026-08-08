/**
 * Channel auth classification — one source of truth for "how does this channel
 * get credentials, and can the operator start an OAuth flow for it?"
 *
 * This used to live in three places that could disagree:
 *
 *   1. `vantage.channels.auth_method` — a database column written by
 *      seedDefaultChannels() and read by nothing. It goes stale silently: a
 *      workspace seeded before TikTok/Instagram/Facebook went live still reads
 *      'manual' for them today, because the seeding upsert uses
 *      ignoreDuplicates and never updates existing rows.
 *   2. `CHANNEL_META[slug].authMethod` in ChannelsPage.tsx — hard-coded in the
 *      browser, so the UI could claim a channel was manual while the publish
 *      route happily posted to it automatically.
 *   3. `MANUAL_PUBLISH_CHANNELS` in publish-pack.ts — the only one the pipeline
 *      actually obeys.
 *
 * Manual-ness is now *derived* from (3), which is definitionally correct: that
 * set is what the cadence engine, the publish route and the publish-pack
 * endpoint all key off. If a channel is not in it, the pipeline will post to
 * that channel automatically, and the UI must say so.
 *
 * The database column is deliberately NOT read here. Deriving instead of
 * reading means a stale row can never make the UI contradict the pipeline, and
 * no migration is needed to keep the two in step.
 */
import { MANUAL_PUBLISH_CHANNELS } from "./publish-pack.js";

export type ChannelAuthMethod = "oauth" | "api_key" | "manual";

/**
 * Channels that authenticate with a credential the operator supplies directly
 * rather than an OAuth redirect:
 *   - bluesky — handle + app password via POST /v1/channels/bluesky/connect
 *   - email   — server-side Resend env vars; nothing is stored on the row
 */
export const CREDENTIAL_CHANNELS = new Set<string>(["bluesky", "email"]);

/**
 * How a channel gets its credentials. Order matters: manual wins, because a
 * channel the pipeline refuses to auto-post to has nothing to connect even if
 * an OAuth implementation exists for it (Reddit is exactly this case — its
 * OAuth flow works, but its API blocks cloud egress, so posting is manual).
 */
export function channelAuthMethod(slug: string): ChannelAuthMethod {
  if (MANUAL_PUBLISH_CHANNELS.has(slug)) return "manual";
  if (CREDENTIAL_CHANNELS.has(slug)) return "api_key";
  return "oauth";
}

/**
 * Whether the UI should offer a "Connect via OAuth" button. True only for
 * channels that both use OAuth and are auto-postable — so Reddit, which has a
 * working OAuth implementation but is manual by external constraint, is false.
 */
export function supportsOAuthConnect(slug: string): boolean {
  return channelAuthMethod(slug) === "oauth";
}
