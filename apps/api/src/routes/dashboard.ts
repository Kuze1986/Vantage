import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getSupabaseAdmin } from "../lib/supabase.js";

export const dashboardRoutes = new Hono();

dashboardRoutes.get("/overview", async (c) => {
  const sb = getSupabaseAdmin();
  const now = new Date();
  const since24h    = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const todayStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const [activityRes, piecesRes, engagementRes, channelsRes] = await Promise.all([
    sb.from("activity_events")
      .select("id, source, source_type, event_type, summary, occurred_at")
      .gte("occurred_at", since24h)
      .order("occurred_at", { ascending: false })
      .limit(100),

    sb.from("content_pieces").select("status, channel_slug, published_at"),

    sb.from("engagement_events")
      .select("id, content_piece_id, event_type, occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(50),

    sb.from("channels")
      .select("slug, enabled, access_token_hash, cadence_config"),
  ]);

  if (activityRes.error)   throw new HTTPException(500, { message: activityRes.error.message });
  if (engagementRes.error) throw new HTTPException(500, { message: engagementRes.error.message });

  // Queue depth by status
  const queueDepth: Record<string, number> = {
    draft: 0, auditing: 0, approved: 0, rejected: 0, queued: 0, published: 0, failed: 0,
  };
  // Published today per channel
  const publishedToday: Record<string, number> = {};

  for (const row of piecesRes.data ?? []) {
    const s = row.status as string;
    if (s in queueDepth) queueDepth[s] += 1;
    if (s === "published" && row.published_at >= todayStart) {
      const ch = row.channel_slug as string;
      publishedToday[ch] = (publishedToday[ch] ?? 0) + 1;
    }
  }

  // Channel connection status
  const channelStatus = (channelsRes.data ?? []).map((ch: Record<string, unknown>) => ({
    slug:          ch.slug,
    enabled:       ch.enabled,
    connected:     !!ch.access_token_hash,
    posts_per_day: (ch.cadence_config as { posts_per_day?: number })?.posts_per_day ?? 0,
  }));

  return c.json({
    activityLast24h:  activityRes.data ?? [],
    queueDepth,
    publishedToday,
    channelStatus,
    recentEngagement: engagementRes.data ?? [],
  });
});
