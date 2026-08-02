/**
 * Campaign KPI sync — roll engagement_events into campaign_kpi_tracking
 * via topic → campaign linkage (source_ref / context_payload.campaign_id).
 */

import { getSupabaseAdmin } from "./supabase.js";

const ENGAGEMENT_TYPES = new Set([
  "like",
  "reply",
  "comment",
  "retweet",
  "repost",
  "quote",
  "share",
  "reaction",
  "upvote",
]);
const SHARE_TYPES = new Set(["retweet", "repost", "quote", "share"]);
const CLICK_TYPES = new Set(["click", "link_click", "open"]);
const FOLLOW_TYPES = new Set(["follow", "subscribe"]);
const IMPRESSION_TYPES = new Set(["impression", "view", "reach"]);

/** Matches campaign_kpi_tracking.source CHECK (email excluded). */
const KPI_SOURCES = new Set([
  "x",
  "linkedin",
  "reddit",
  "threads",
  "bluesky",
  "tiktok",
  "instagram",
  "facebook",
  "all",
]);

export async function resolveCampaignIdForPiece(
  contentPieceId: string,
): Promise<string | null> {
  const sb = getSupabaseAdmin();
  const { data: piece } = await sb
    .from("content_pieces")
    .select("topic_id")
    .eq("id", contentPieceId)
    .maybeSingle();
  if (!piece?.topic_id) return null;

  const { data: topic } = await sb
    .from("topics")
    .select("source_product, source_ref, context_payload")
    .eq("id", piece.topic_id)
    .maybeSingle();
  if (!topic) return null;

  const ctx = topic.context_payload;
  if (ctx && typeof ctx === "object" && !Array.isArray(ctx)) {
    const cid = (ctx as { campaign_id?: unknown }).campaign_id;
    if (typeof cid === "string" && cid.length > 0) return cid;
  }
  if (topic.source_product === "campaign" && typeof topic.source_ref === "string") {
    return topic.source_ref;
  }
  return null;
}

function bumpCounters(
  row: {
    impressions: number;
    clicks: number;
    engagements: number;
    shares: number;
    follows: number;
  },
  eventType: string,
): void {
  const t = eventType.toLowerCase();
  if (IMPRESSION_TYPES.has(t)) {
    row.impressions += 1;
    return;
  }
  if (CLICK_TYPES.has(t)) {
    row.clicks += 1;
    row.engagements += 1;
    return;
  }
  if (FOLLOW_TYPES.has(t)) {
    row.follows += 1;
    row.engagements += 1;
    return;
  }
  if (SHARE_TYPES.has(t)) {
    row.shares += 1;
    row.engagements += 1;
    return;
  }
  if (ENGAGEMENT_TYPES.has(t) || t.length > 0) {
    row.engagements += 1;
  }
}

/**
 * Increment KPI rows for one engagement event (channel + all rollups).
 */
export async function recordCampaignEngagement(opts: {
  contentPieceId: string;
  channel: string;
  eventType: string;
  occurredAt?: string | Date;
}): Promise<void> {
  try {
    const campaignId = await resolveCampaignIdForPiece(opts.contentPieceId);
    if (!campaignId) return;

    const sb = getSupabaseAdmin();
    const dateTracked = (opts.occurredAt
      ? new Date(opts.occurredAt)
      : new Date()
    )
      .toISOString()
      .slice(0, 10);

    const sources = KPI_SOURCES.has(opts.channel)
      ? [opts.channel, "all"]
      : ["all"];
    for (const source of sources) {
      const { data: existing } = await sb
        .from("campaign_kpi_tracking")
        .select("id, impressions, clicks, engagements, shares, follows")
        .eq("campaign_id", campaignId)
        .eq("date_tracked", dateTracked)
        .eq("source", source)
        .maybeSingle();

      const next = {
        impressions: existing?.impressions ?? 0,
        clicks: existing?.clicks ?? 0,
        engagements: existing?.engagements ?? 0,
        shares: existing?.shares ?? 0,
        follows: existing?.follows ?? 0,
      };
      bumpCounters(next, opts.eventType);

      if (existing?.id) {
        await sb
          .from("campaign_kpi_tracking")
          .update({ ...next, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        await sb.from("campaign_kpi_tracking").insert({
          campaign_id: campaignId,
          date_tracked: dateTracked,
          source,
          ...next,
        });
      }
    }
  } catch (err) {
    console.warn(
      `[campaign-kpi] record failed piece=${opts.contentPieceId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Recompute KPI rows for a campaign from engagement_events (backfill).
 */
export async function syncCampaignKpis(campaignId: string): Promise<number> {
  const sb = getSupabaseAdmin();

  const { data: topics } = await sb
    .from("topics")
    .select("id, context_payload, source_product, source_ref")
    .or(`source_ref.eq.${campaignId},context_payload->>campaign_id.eq.${campaignId}`);

  const topicIds = (topics ?? [])
    .filter((t) => {
      if (t.source_product === "campaign" && t.source_ref === campaignId) return true;
      const ctx = t.context_payload;
      return (
        ctx &&
        typeof ctx === "object" &&
        !Array.isArray(ctx) &&
        (ctx as { campaign_id?: string }).campaign_id === campaignId
      );
    })
    .map((t) => t.id);

  if (!topicIds.length) return 0;

  const { data: pieces } = await sb
    .from("content_pieces")
    .select("id, channel_slug")
    .in("topic_id", topicIds);
  if (!pieces?.length) return 0;

  const pieceChannel = new Map(pieces.map((p) => [p.id, p.channel_slug as string]));
  const pieceIds = pieces.map((p) => p.id);

  const { data: events } = await sb
    .from("engagement_events")
    .select("content_piece_id, event_type, created_at")
    .in("content_piece_id", pieceIds)
    .limit(5000);

  // Clear existing rows then rebuild
  await sb.from("campaign_kpi_tracking").delete().eq("campaign_id", campaignId);

  type Acc = {
    impressions: number;
    clicks: number;
    engagements: number;
    shares: number;
    follows: number;
  };
  const buckets = new Map<string, Acc>();

  for (const ev of events ?? []) {
    const pid = ev.content_piece_id as string;
    const channel = pieceChannel.get(pid) ?? "all";
    const day = String(ev.created_at).slice(0, 10);
    for (const source of [channel, "all"]) {
      const key = `${day}|${source}`;
      const acc = buckets.get(key) ?? {
        impressions: 0,
        clicks: 0,
        engagements: 0,
        shares: 0,
        follows: 0,
      };
      bumpCounters(acc, String(ev.event_type ?? ""));
      buckets.set(key, acc);
    }
  }

  const rows = [...buckets.entries()].map(([key, acc]) => {
    const [date_tracked, source] = key.split("|");
    return { campaign_id: campaignId, date_tracked, source, ...acc };
  });

  if (rows.length) {
    await sb.from("campaign_kpi_tracking").insert(rows);
  }
  return rows.length;
}
