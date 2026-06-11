import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getSupabaseAdmin } from "../lib/supabase.js";

export const dashboardRoutes = new Hono();

dashboardRoutes.get("/overview", async (c) => {
  const ws = c.get("workspaceId");
  const sb = getSupabaseAdmin();
  const now = new Date();
  const since24h   = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d    = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const [activityRes, piecesRes, engagementRes, channelsRes, topPiecesRes, verticalRes] = await Promise.all([
    sb.from("activity_events")
      .select("id, source, source_type, event_type, summary, occurred_at")
      .eq("workspace_id", ws)
      .gte("occurred_at", since24h)
      .order("occurred_at", { ascending: false })
      .limit(100),

    sb.from("content_pieces").select("id, status, channel_slug, published_at").eq("workspace_id", ws),

    sb.from("engagement_events")
      .select("id, content_piece_id, event_type, occurred_at")
      .eq("workspace_id", ws)
      .gte("occurred_at", since7d)
      .order("occurred_at", { ascending: false })
      .limit(200),

    sb.from("channels")
      .select("slug, enabled, access_token_hash, cadence_config")
      .eq("workspace_id", ws),

    // Top published pieces in last 7d for engagement ranking
    sb.from("content_pieces")
      .select("id, channel_slug, content_payload, published_at")
      .eq("workspace_id", ws)
      .eq("status", "published")
      .gte("published_at", since7d)
      .order("published_at", { ascending: false })
      .limit(100),

    // 3A-8: Per-vertical breakdown — join content_pieces → topics
    sb.from("content_pieces")
      .select("id, status, published_at, topics!inner(vertical)")
      .eq("workspace_id", ws)
      .not("topics.vertical", "is", null)
      .gte("published_at", since7d),
  ]);

  if (activityRes.error)   throw new HTTPException(500, { message: activityRes.error.message });
  if (engagementRes.error) throw new HTTPException(500, { message: engagementRes.error.message });
  // verticalRes errors are non-fatal — just produce an empty breakdown

  // Queue depth by status
  const queueDepth: Record<string, number> = {
    draft: 0, auditing: 0, approved: 0, rejected: 0, queued: 0, published: 0, failed: 0,
  };
  // Published today per channel
  const publishedToday: Record<string, number> = {};
  // Per-channel breakdown accumulators
  const channelStats: Record<string, {
    published_today: number;
    published_7d: number;
    auditing: number;
    queued: number;
  }> = {};

  const ensureChannel = (slug: string) => {
    if (!channelStats[slug]) channelStats[slug] = { published_today: 0, published_7d: 0, auditing: 0, queued: 0 };
  };

  for (const row of piecesRes.data ?? []) {
    const s  = row.status as string;
    const ch = row.channel_slug as string;
    ensureChannel(ch);

    if (s in queueDepth) queueDepth[s] += 1;

    if (s === "published") {
      channelStats[ch].published_7d += 1;
      if (row.published_at >= todayStart) {
        publishedToday[ch] = (publishedToday[ch] ?? 0) + 1;
        channelStats[ch].published_today += 1;
      }
    }
    if (s === "auditing") channelStats[ch].auditing += 1;
    if (s === "queued" || s === "approved") channelStats[ch].queued += 1;
  }

  // Engagement counts per content_piece_id (last 7d)
  const engagementCount: Record<string, number> = {};
  for (const ev of engagementRes.data ?? []) {
    if (ev.content_piece_id) {
      engagementCount[ev.content_piece_id] = (engagementCount[ev.content_piece_id] ?? 0) + 1;
    }
  }

  // Top 5 pieces by engagement in last 7d
  const topPieces = (topPiecesRes.data ?? [])
    .map((p) => ({
      id:              p.id,
      channel_slug:    p.channel_slug,
      published_at:    p.published_at,
      engagement_count: engagementCount[p.id] ?? 0,
      preview:         (() => {
        const cp = p.content_payload as Record<string, unknown> | null;
        if (!cp) return "";
        const t = cp.text ?? cp.body ?? cp.subject ?? cp.title ?? "";
        return String(t).slice(0, 120);
      })(),
    }))
    .sort((a, b) => b.engagement_count - a.engagement_count)
    .slice(0, 5);

  // Channel connection status (merge with channelStats)
  const channelStatus = (channelsRes.data ?? []).map((ch: Record<string, unknown>) => {
    const slug = ch.slug as string;
    const stats = channelStats[slug] ?? { published_today: 0, published_7d: 0, auditing: 0, queued: 0 };
    return {
      slug,
      enabled:           ch.enabled,
      connected:         !!ch.access_token_hash,
      posts_per_day:     (ch.cadence_config as { posts_per_day?: number })?.posts_per_day ?? 0,
      published_today:   stats.published_today,
      published_7d:      stats.published_7d,
      auditing:          stats.auditing,
      queued:            stats.queued,
    };
  });

  // channelBreakdown: same data keyed by slug for easy frontend lookup
  const channelBreakdown = Object.fromEntries(
    channelStatus.map((ch) => [ch.slug, {
      published_today: ch.published_today,
      published_7d:    ch.published_7d,
      auditing:        ch.auditing,
      queued:          ch.queued,
    }]),
  );

  // 3A-8: Per-vertical breakdown — aggregate published counts by vertical for last 7d
  type VerticalStats = { published_7d: number; published_today: number };
  const verticalBreakdown: Record<string, VerticalStats> = {};
  for (const row of (verticalRes.data ?? []) as unknown as { status: string; published_at: string | null; topics: { vertical: string }[] }[]) {
    const vertical = row.topics?.[0]?.vertical;
    if (!vertical) continue;
    if (!verticalBreakdown[vertical]) verticalBreakdown[vertical] = { published_7d: 0, published_today: 0 };
    if (row.status === "published") {
      verticalBreakdown[vertical].published_7d += 1;
      if (row.published_at && row.published_at >= todayStart) {
        verticalBreakdown[vertical].published_today += 1;
      }
    }
  }

  return c.json({
    activityLast24h:   activityRes.data ?? [],
    queueDepth,
    publishedToday,
    channelStatus,
    channelBreakdown,
    topPieces,
    recentEngagement:  engagementRes.data ?? [],
    verticalBreakdown,
  });
});
