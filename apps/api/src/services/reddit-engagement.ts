/**
 * 3A-7: Reddit engagement polling
 *
 * Reddit has no push-webhook API. Instead, we poll the public JSON API for
 * every published Reddit piece to capture upvote scores and comment counts.
 *
 * Each poll round:
 *  1. Load all content_pieces with channel_slug='reddit' and status='published'
 *     that have an external_post_id (the Reddit post ID / fullname).
 *  2. Fetch https://www.reddit.com/by_id/t3_{postId}.json (public, no auth).
 *  3. Insert engagement_events with external_event_id = 'reddit_poll_{postId}_{hourEpoch}'
 *     so the unique index prevents duplicate rows for the same poll window.
 */

import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";

const REDDIT_BY_ID = "https://www.reddit.com/by_id";
const USER_AGENT   = "vantage-marketing-bot/1.0";
const POLL_HOUR_MS = 2 * 60 * 60_000; // 2-hour poll window for dedup key

type RedditChild = {
  data?: {
    id?: string;
    score?: number;
    num_comments?: number;
    upvote_ratio?: number;
    url?: string;
    subreddit?: string;
  };
};

type RedditListingResponse = {
  data?: {
    children?: RedditChild[];
  };
};

export async function pollRedditEngagement(): Promise<{ polled: number; inserted: number }> {
  const sb = getSupabaseAdmin();

  // Load all published Reddit pieces with an external_post_id
  const { data: pieces, error } = await sb
    .from("content_pieces")
    .select("id, external_post_id")
    .eq("channel_slug", "reddit")
    .eq("status", "published")
    .not("external_post_id", "is", null);

  if (error) {
    console.error("[reddit-engagement] load error:", error.message);
    return { polled: 0, inserted: 0 };
  }
  if (!pieces?.length) return { polled: 0, inserted: 0 };

  // De-duplicate post IDs (in case multiple pieces share one external post)
  const postIds = [...new Set(pieces.map((p) => p.external_post_id as string))];
  const pieceByPostId = new Map<string, string>();
  for (const p of pieces) {
    if (p.external_post_id) pieceByPostId.set(p.external_post_id as string, p.id as string);
  }

  // Build a comma-separated fullname list (max 25 per Reddit API limit)
  const CHUNK = 25;
  let totalInserted = 0;
  const hourEpoch = Math.floor(Date.now() / POLL_HOUR_MS); // changes every 2h

  for (let i = 0; i < postIds.length; i += CHUNK) {
    const chunk   = postIds.slice(i, i + CHUNK);
    const fullnames = chunk.map((id) => (id.startsWith("t3_") ? id : `t3_${id}`)).join(",");
    const url       = `${REDDIT_BY_ID}/${fullnames}.json`;

    let listing: RedditListingResponse;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!res.ok) {
        console.warn(`[reddit-engagement] fetch failed for chunk ${i}: ${res.status}`);
        continue;
      }
      listing = (await res.json()) as RedditListingResponse;
    } catch (fetchErr) {
      console.warn("[reddit-engagement] fetch error:", fetchErr);
      continue;
    }

    const children = listing.data?.children ?? [];
    for (const child of children) {
      const d = child.data;
      if (!d?.id) continue;

      const postId        = d.id; // short ID without "t3_" prefix
      const contentPieceId = pieceByPostId.get(postId) ?? pieceByPostId.get(`t3_${postId}`) ?? null;
      const externalEventId = `reddit_poll_${postId}_${hourEpoch}`;

      const eventPayload = {
        post_id:      postId,
        score:        d.score        ?? 0,
        num_comments: d.num_comments ?? 0,
        upvote_ratio: d.upvote_ratio ?? null,
        subreddit:    d.subreddit    ?? null,
        url:          d.url          ?? null,
        polled_at:    new Date().toISOString(),
      };

      // Insert one "score" event + one "comment" event per poll — deduplicated by hour
      const { error: insErr } = await sb.from("engagement_events").insert([
        {
          content_piece_id:  contentPieceId,
          event_type:        "reddit_score",
          event_payload:     eventPayload,
          external_event_id: `${externalEventId}_score`,
          occurred_at:       new Date().toISOString(),
        },
        {
          content_piece_id:  contentPieceId,
          event_type:        "reddit_comment_count",
          event_payload:     { post_id: postId, num_comments: d.num_comments ?? 0, polled_at: new Date().toISOString() },
          external_event_id: `${externalEventId}_comments`,
          occurred_at:       new Date().toISOString(),
        },
      ]);

      // Ignore unique-constraint conflicts (duplicate poll within same hour)
      if (insErr && !insErr.message.includes("unique") && !insErr.message.includes("duplicate")) {
        console.warn("[reddit-engagement] insert error:", insErr.message);
      } else if (!insErr) {
        totalInserted += 2;
      }
    }
  }

  if (totalInserted > 0) {
    await logActivity({
      source:      "reddit-engagement",
      source_type: "system",
      event_type:  "poll_complete",
      summary:     `Reddit engagement poll: ${totalInserted} events from ${postIds.length} posts`,
      payload:     { polled: postIds.length, inserted: totalInserted },
    });
  }

  return { polled: postIds.length, inserted: totalInserted };
}
