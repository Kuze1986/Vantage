/**
 * Bluesky engagement polling
 *
 * Bluesky has no push-webhook API for engagement. Instead, we poll the public,
 * unauthenticated AT Protocol AppView for every published Bluesky piece to
 * capture like/repost/reply counts.
 *
 * Each poll round:
 *  1. Load all content_pieces with channel_slug='bluesky' and status='published'
 *     that have an external_post_id (the post's rkey — see adapters/bluesky.ts
 *     postBluesky(), which stores only the trailing AT URI segment, not the full URI).
 *  2. Reconstruct the full AT URI (at://{did}/app.bsky.feed.post/{rkey}) using the
 *     workspace's connected DID, then batch-call app.bsky.feed.getPosts (public,
 *     no auth — counts only, no per-engager identity is ever available from this
 *     endpoint, so actor_external_id is always null here).
 *  3. Insert engagement_events with external_event_id = 'bluesky_poll_{rkey}_{hourEpoch}_{metric}'
 *     so the unique index prevents duplicate rows for the same poll window.
 */

import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { recordGrowthEvent, engagementKind } from "../lib/growth.js";
import { recordCampaignEngagement } from "../lib/campaign-kpi.js";
import { getBlueskyDid } from "../adapters/bluesky.js";

function publicAppView(): string {
  return process.env.BLUESKY_PUBLIC_APPVIEW_URL || "https://public.api.bsky.app";
}

const POLL_HOUR_MS = 60 * 60_000; // 1-hour poll window for dedup key, matches the tick interval

type BlueskyPost = {
  uri?: string;
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
};

type GetPostsResponse = {
  posts?: BlueskyPost[];
};

export async function pollBlueskyEngagement(workspaceId: string): Promise<{ polled: number; inserted: number }> {
  const sb = getSupabaseAdmin();

  const { data: pieces, error } = await sb
    .from("content_pieces")
    .select("id, external_post_id")
    .eq("workspace_id", workspaceId)
    .eq("channel_slug", "bluesky")
    .eq("status", "published")
    .not("external_post_id", "is", null);

  if (error) {
    console.error("[bluesky-engagement] load error:", error.message);
    return { polled: 0, inserted: 0 };
  }
  if (!pieces?.length) return { polled: 0, inserted: 0 };

  let did: string;
  try {
    did = await getBlueskyDid(workspaceId);
  } catch {
    // Channel not connected — nothing to poll.
    return { polled: 0, inserted: 0 };
  }

  const rkeys = [...new Set(pieces.map((p) => p.external_post_id as string))];
  const pieceByRkey = new Map<string, string>();
  for (const p of pieces) {
    if (p.external_post_id) pieceByRkey.set(p.external_post_id as string, p.id as string);
  }

  const CHUNK = 25; // app.bsky.feed.getPosts limit
  let totalInserted = 0;
  const hourEpoch = Math.floor(Date.now() / POLL_HOUR_MS);

  for (let i = 0; i < rkeys.length; i += CHUNK) {
    const chunk = rkeys.slice(i, i + CHUNK);
    const uris  = chunk.map((rkey) => `at://${did}/app.bsky.feed.post/${rkey}`);
    const url   = new URL(`${publicAppView()}/xrpc/app.bsky.feed.getPosts`);
    for (const uri of uris) url.searchParams.append("uris", uri);

    let listing: GetPostsResponse;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[bluesky-engagement] fetch failed for chunk ${i}: ${res.status}`);
        continue;
      }
      listing = (await res.json()) as GetPostsResponse;
    } catch (fetchErr) {
      console.warn("[bluesky-engagement] fetch error:", fetchErr);
      continue;
    }

    for (const post of listing.posts ?? []) {
      if (!post.uri) continue;
      const rkey = post.uri.split("/").pop();
      if (!rkey) continue;
      const contentPieceId = pieceByRkey.get(rkey) ?? null;
      if (!contentPieceId) continue;

      const externalEventBase = `bluesky_poll_${rkey}_${hourEpoch}`;
      const events = [
        { event_type: "bluesky_like_count",   value: post.likeCount   ?? 0, suffix: "like" },
        { event_type: "bluesky_repost_count", value: post.repostCount ?? 0, suffix: "repost" },
        { event_type: "bluesky_reply_count",  value: post.replyCount  ?? 0, suffix: "reply" },
      ];

      const { error: insErr } = await sb.from("engagement_events").insert(
        events.map((e) => ({
          workspace_id:       workspaceId,
          content_piece_id:   contentPieceId,
          event_type:         e.event_type,
          event_payload:      { rkey, uri: post.uri, count: e.value, polled_at: new Date().toISOString() },
          external_event_id:  `${externalEventBase}_${e.suffix}`,
          actor_external_id:  null, // aggregate counts only — no per-engager identity from this endpoint
          occurred_at:        new Date().toISOString(),
        })),
      );

      // Ignore unique-constraint conflicts (duplicate poll within same hour)
      if (insErr && !insErr.message.includes("unique") && !insErr.message.includes("duplicate")) {
        console.warn("[bluesky-engagement] insert error:", insErr.message);
      } else if (!insErr) {
        totalInserted += events.length;
        for (const e of events) {
          await recordCampaignEngagement({ contentPieceId, channel: "bluesky", eventType: e.event_type });
          await recordGrowthEvent({
            loop: "acquisition",
            kind: engagementKind(e.event_type),
            channel: "bluesky",
            meta: { event_type: e.event_type, content_piece_id: contentPieceId, workspace_id: workspaceId, polled: true },
          });
        }
      }
    }
  }

  if (totalInserted > 0) {
    await logActivity({
      source:       "bluesky-engagement",
      source_type:  "system",
      event_type:   "poll_complete",
      summary:      `Bluesky engagement poll: ${totalInserted} events from ${rkeys.length} posts`,
      payload:      { polled: rkeys.length, inserted: totalInserted },
      workspace_id: workspaceId,
    });
  }

  return { polled: rkeys.length, inserted: totalInserted };
}
