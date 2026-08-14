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
import { recordGrowthEvent, engagementKind } from "../lib/growth.js";
import { loadProductProfile } from "../lib/product-profile.js";
import { recordCampaignEngagement } from "../lib/campaign-kpi.js";
import { redditFetch, redditUserAgent } from "../adapters/reddit.js";

const REDDIT_BY_ID = "https://www.reddit.com/by_id";
const POLL_HOUR_MS = 2 * 60 * 60_000; // 2-hour poll window for dedup key

/**
 * Reddit is a manual channel, so external_post_id is whatever permalink the
 * human pasted into the Queue page — not the bare post id the automated path
 * used to store. Pull the id back out of a permalink
 * (…/r/<sub>/comments/<id>/<slug>) so /by_id still resolves. Values that are
 * already an id or a t3_ fullname pass through untouched.
 */
export function toRedditPostId(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const fromPermalink = v.match(/\/comments\/([a-z0-9]+)/i);
  if (fromPermalink) return fromPermalink[1];
  if (/^t3_[a-z0-9]+$/i.test(v)) return v.slice(3);
  if (/^[a-z0-9]+$/i.test(v)) return v;
  // A URL we don't recognise — polling it would just 404 against /by_id.
  return null;
}

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

export async function pollRedditEngagement(workspaceId: string): Promise<{ polled: number; inserted: number }> {
  const sb = getSupabaseAdmin();

  // Load all published Reddit pieces with an external_post_id
  const { data: pieces, error } = await sb
    .from("content_pieces")
    .select("id, external_post_id")
    .eq("workspace_id", workspaceId)
    .eq("channel_slug", "reddit")
    .eq("status", "published")
    .not("external_post_id", "is", null);

  if (error) {
    console.error("[reddit-engagement] load error:", error.message);
    return { polled: 0, inserted: 0 };
  }
  if (!pieces?.length) return { polled: 0, inserted: 0 };

  // Hoisted above the loop below — workspaceId is fixed for this whole poll,
  // so this is one lookup per call rather than one per engagement event.
  const { default_product_id } = await loadProductProfile(workspaceId);

  // De-duplicate post IDs (in case multiple pieces share one external post).
  // Pieces whose external_post_id isn't resolvable to a Reddit id (e.g. someone
  // pasted a non-Reddit URL) are dropped here rather than poisoning a chunk.
  const pieceByPostId = new Map<string, string>();
  for (const p of pieces) {
    const id = toRedditPostId(String(p.external_post_id ?? ""));
    if (id) pieceByPostId.set(id, p.id as string);
  }
  const postIds = [...pieceByPostId.keys()];
  if (!postIds.length) return { polled: 0, inserted: 0 };

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
      // Shared with the adapter so this inherits the compliant User-Agent and
      // REDDIT_PROXY_URL routing — "vantage-marketing-bot/1.0" was exactly the
      // kind of generic UA Reddit's edge rejects.
      const res = await redditFetch(url, {
        headers: { "User-Agent": redditUserAgent() },
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
          workspace_id:      workspaceId,
          content_piece_id:  contentPieceId,
          event_type:        "reddit_score",
          event_payload:     eventPayload,
          external_event_id: `${externalEventId}_score`,
          occurred_at:       new Date().toISOString(),
        },
        {
          workspace_id:      workspaceId,
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
        if (contentPieceId) {
          await recordCampaignEngagement({
            contentPieceId,
            channel: "reddit",
            eventType: "reddit_score",
          });
          await recordCampaignEngagement({
            contentPieceId,
            channel: "reddit",
            eventType: "reddit_comment_count",
          });
          await recordGrowthEvent({
            loop: "acquisition",
            kind: engagementKind("reddit_score"),
            channel: "reddit",
            product: default_product_id,
            meta: {
              event_type: "reddit_score",
              content_piece_id: contentPieceId,
              workspace_id: workspaceId,
              polled: true,
            },
          });
        }
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
      workspace_id: workspaceId,
    });
  }

  return { polled: postIds.length, inserted: totalInserted };
}
