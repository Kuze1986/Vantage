/**
 * Competitive-post collector
 *
 * monitoring_sources stores handles/keywords to watch, but nothing previously read it —
 * competitive_posts started empty and stayed empty unless hand-fed via POST /v1/intelligence/posts.
 * This closes that gap for Reddit sources.
 *
 * Reddit only: X and LinkedIn have no read-capable adapter in this codebase — both
 * adapters/x.ts and adapters/linkedin.ts only implement OAuth *posting* for our own
 * account, not the search/timeline reads needed to watch a competitor's account. Reading
 * arbitrary accounts on either platform requires an elevated API tier/partnership this
 * app isn't provisioned for. X/LinkedIn monitoring_sources rows are accepted and stored
 * (the schema already allows them) but silently skipped by this collector — logged once
 * per tick, not treated as an error.
 *
 * Each collection round, per active Reddit monitoring_source:
 *  - source_type='keyword'  → reddit.com/search.json?q={identifier}
 *  - otherwise (competitor/influencer/industry_leader/partner) → treats source_identifier
 *    as a Reddit username, fetches reddit.com/user/{identifier}/submitted.json
 * New posts (deduped against existing competitive_posts by post_id) are analyzed via the
 * same analyzeCompetitivePost() the manual POST /v1/intelligence/posts endpoint uses, then
 * inserted. LLM analysis is capped per tick (MAX_ANALYZED_PER_TICK) to bound cost; excess
 * new posts are still inserted with neutral/empty analysis fields.
 *
 * NOT populating viral_signals: analyzeVirality() (lib/bioloop.ts) needs real impression
 * counts to compute an engagement-rate multiplier against platform baselines. Reddit's
 * public JSON API exposes no impression/view data — feeding it impressions=0 would force
 * every post to score as non-viral regardless of actual performance, which is worse than
 * not scoring it at all. viral_signals remains manual-only (POST /v1/bioloop/analyze)
 * until a platform with real impression data is added to this collector.
 */

import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { analyzeCompetitivePost } from "../lib/intelligence.js";

const USER_AGENT = "vantage-intelligence-collector/1.0";
const MAX_ANALYZED_PER_TICK = 15; // bounds LLM spend per workspace per tick
const POSTS_PER_SOURCE = 15;

type MonitoringSource = {
  id: string;
  source_type: "competitor" | "influencer" | "industry_leader" | "partner" | "keyword";
  source_platform: "x" | "linkedin" | "reddit";
  source_identifier: string;
};

type RedditPostData = {
  id?: string;
  title?: string;
  selftext?: string;
  ups?: number;
  num_comments?: number;
  created_utc?: number;
  author?: string;
  permalink?: string;
};

async function fetchRedditSourcePosts(source: MonitoringSource): Promise<RedditPostData[]> {
  const url = source.source_type === "keyword"
    ? `https://www.reddit.com/search.json?q=${encodeURIComponent(source.source_identifier)}&sort=new&limit=${POSTS_PER_SOURCE}&raw_json=1`
    : `https://www.reddit.com/user/${encodeURIComponent(source.source_identifier)}/submitted.json?limit=${POSTS_PER_SOURCE}&raw_json=1`;

  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { children?: { data: RedditPostData }[] } };
    return (json.data?.children ?? []).map((c) => c.data);
  } catch {
    return [];
  }
}

export async function collectCompetitivePosts(workspaceId: string): Promise<{ scanned: number; inserted: number }> {
  const sb = getSupabaseAdmin();

  const { data: sources, error } = await sb
    .from("monitoring_sources")
    .select("id, source_type, source_platform, source_identifier")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);

  if (error) {
    console.error("[competitive-collector] load error:", error.message);
    return { scanned: 0, inserted: 0 };
  }
  if (!sources?.length) return { scanned: 0, inserted: 0 };

  const redditSources = (sources as MonitoringSource[]).filter((s) => s.source_platform === "reddit");
  const skipped = sources.length - redditSources.length;
  if (skipped > 0) {
    console.warn(`[competitive-collector] ws ${workspaceId}: skipping ${skipped} x/linkedin source(s) — no read API access configured`);
  }
  if (!redditSources.length) return { scanned: 0, inserted: 0 };

  const fetched = await Promise.all(
    redditSources.map((source) => fetchRedditSourcePosts(source).then((posts) => ({ source, posts }))),
  );

  const candidates = fetched.flatMap(({ source, posts }) =>
    posts.filter((p) => p.id && p.title).map((post) => ({ source, post })),
  );

  // Highest-engagement posts get analyzed first — bounds LLM spend per tick.
  candidates.sort((a, b) => {
    const ea = (a.post.ups ?? 0) + (a.post.num_comments ?? 0);
    const eb = (b.post.ups ?? 0) + (b.post.num_comments ?? 0);
    return eb - ea;
  });

  let inserted = 0;
  let analyzed = 0;
  const scanned = candidates.length;

  for (const { post } of candidates) {
    const postId = post.id as string;

    const { data: existing } = await sb
      .from("competitive_posts")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("source_platform", "reddit")
      .eq("post_id", postId)
      .maybeSingle();
    if (existing) continue;

    const ups = post.ups ?? 0;
    const numComments = post.num_comments ?? 0;
    const engagements = ups + numComments;
    const author = post.author ?? "unknown";
    const postedAt = post.created_utc ? new Date(post.created_utc * 1000).toISOString() : new Date().toISOString();
    const postContent = (post.title ?? "") + (post.selftext ? `\n${post.selftext}` : "");

    let analysis: Awaited<ReturnType<typeof analyzeCompetitivePost>> | null = null;
    if (analyzed < MAX_ANALYZED_PER_TICK) {
      try {
        analysis = await analyzeCompetitivePost({
          id: postId,
          source_platform: "reddit",
          source_account_name: author,
          post_content: postContent.slice(0, 2000),
          posted_at: postedAt,
          impressions: 0, // Reddit's public API exposes no impression/view data
          engagements,
          likes: ups,
          reposts: 0,
          replies: numComments,
          follows: 0,
        });
        analyzed++;
      } catch (err) {
        console.warn("[competitive-collector] analysis failed:", err instanceof Error ? err.message : err);
      }
    }

    const { error: insErr } = await sb.from("competitive_posts").insert({
      workspace_id:        workspaceId,
      source_platform:     "reddit",
      source_account_id:   author,
      source_account_name: author,
      source_account_url:  `https://www.reddit.com/user/${author}`,
      post_id:             postId,
      post_url:            post.permalink ? `https://www.reddit.com${post.permalink}` : `https://www.reddit.com/comments/${postId}`,
      post_title:          post.title ?? null,
      post_content:        post.selftext || null,
      posted_at:           postedAt,
      impressions:         0,
      engagements,
      likes:                ups,
      reposts:              0,
      replies:              numComments,
      follows:              0,
      content_themes:       analysis?.themes ?? [],
      sentiment:            analysis?.sentiment ?? "neutral",
      virality_indicators:  analysis?.virality_indicators ?? null,
      relevance_score:      (analysis?.engagement_potential ?? 0).toFixed(2),
    });

    if (!insErr) {
      inserted++;
    } else if (!insErr.message.includes("unique") && !insErr.message.includes("duplicate")) {
      console.warn("[competitive-collector] insert error:", insErr.message);
    }
  }

  if (inserted > 0) {
    await logActivity({
      source:       "competitive-collector",
      source_type:  "system",
      event_type:   "collect_complete",
      summary:      `Competitive post collection: ${inserted} new posts from ${redditSources.length} Reddit source(s) (${scanned} scanned)`,
      payload:      { scanned, inserted, sources: redditSources.length, skipped_non_reddit: skipped },
      workspace_id: workspaceId,
    });
  }

  return { scanned, inserted };
}
