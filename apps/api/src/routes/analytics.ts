/**
 * 3B-3: Engagement Trend Charts
 *
 * GET /v1/analytics/engagement
 *   ?channel=x&vertical=healthcare&period=7d|30d|90d&group_by=day|channel|vertical
 *   Returns time-bucketed engagement counts
 *
 * GET /v1/analytics/posting-hours
 *   ?channel=x
 *   Returns engagement rate by UTC hour for each channel
 */

import { Hono } from "hono";
import { getSupabaseAdmin } from "../lib/supabase.js";

export const analyticsRoutes = new Hono();

// ── Engagement over time ──────────────────────────────────────────────────────
analyticsRoutes.get("/engagement", async (c) => {
  const sb      = getSupabaseAdmin();
  const period  = (c.req.query("period")   ?? "7d") as "7d" | "30d" | "90d";
  const groupBy = (c.req.query("group_by") ?? "day") as "day" | "channel" | "vertical";
  const channel  = c.req.query("channel");
  const vertical = c.req.query("vertical");

  const periodDays = period === "90d" ? 90 : period === "30d" ? 30 : 7;
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60_000).toISOString();

  // Load engagement events in the window
  const { data: events, error: evErr } = await sb
    .from("engagement_events")
    .select("id, content_piece_id, event_type, occurred_at")
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: true })
    .limit(5000);
  if (evErr) return c.json({ error: evErr.message }, 500);

  // Load content pieces for the event content_piece_ids to get channel_slug / topic vertical
  const pieceIds = [...new Set((events ?? [])
    .map((e) => e.content_piece_id as string | null)
    .filter(Boolean) as string[])];

  let pieceMap: Record<string, { channel_slug: string; topic_id: string | null }> = {};
  if (pieceIds.length > 0) {
    const { data: pieces } = await sb
      .from("content_pieces")
      .select("id, channel_slug, topic_id")
      .in("id", pieceIds);
    for (const p of pieces ?? []) {
      pieceMap[p.id as string] = { channel_slug: p.channel_slug as string, topic_id: p.topic_id as string | null };
    }
  }

  // Load topic verticals
  const topicIds = [...new Set(Object.values(pieceMap).map((p) => p.topic_id).filter(Boolean) as string[])];
  let topicVertical: Record<string, string | null> = {};
  if (topicIds.length > 0) {
    const { data: topics } = await sb.from("topics").select("id, vertical").in("id", topicIds);
    for (const t of topics ?? []) topicVertical[t.id as string] = t.vertical as string | null;
  }

  // Bucket events
  type Bucket = { label: string; count: number };
  const buckets = new Map<string, number>();

  for (const ev of events ?? []) {
    const piece     = pieceMap[ev.content_piece_id as string];
    const evChannel = piece?.channel_slug ?? "unknown";
    const evVertical = (piece?.topic_id ? topicVertical[piece.topic_id] : null) ?? "unknown";

    // Filter
    if (channel  && evChannel  !== channel)  continue;
    if (vertical && evVertical !== vertical) continue;

    let key: string;
    if (groupBy === "channel") {
      key = evChannel;
    } else if (groupBy === "vertical") {
      key = evVertical;
    } else {
      // day bucket: YYYY-MM-DD
      key = (ev.occurred_at as string).slice(0, 10);
    }

    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  // Sort by key
  const data: Bucket[] = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, count]) => ({ label, count }));

  return c.json({ period, group_by: groupBy, data });
});

// ── Engagement by posting hour ────────────────────────────────────────────────
analyticsRoutes.get("/posting-hours", async (c) => {
  const sb      = getSupabaseAdmin();
  const channel = c.req.query("channel");
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();

  // Load published pieces in last 30d
  let piecesQ = sb
    .from("content_pieces")
    .select("id, channel_slug, published_at")
    .eq("status", "published")
    .gte("published_at", since30d);
  if (channel) piecesQ = piecesQ.eq("channel_slug", channel);
  const { data: pieces } = await piecesQ.limit(2000);

  // Load engagement events for those pieces
  const pieceIds = (pieces ?? []).map((p) => p.id as string);
  const engageCount: Record<string, number> = {};
  if (pieceIds.length > 0) {
    const { data: evs } = await sb
      .from("engagement_events")
      .select("content_piece_id")
      .in("content_piece_id", pieceIds);
    for (const ev of evs ?? []) {
      const pid = ev.content_piece_id as string;
      engageCount[pid] = (engageCount[pid] ?? 0) + 1;
    }
  }

  // Aggregate: for each UTC hour, compute avg engagement rate
  const hourBuckets: Record<number, { total_engagement: number; piece_count: number }> = {};
  for (let h = 0; h < 24; h++) hourBuckets[h] = { total_engagement: 0, piece_count: 0 };

  for (const piece of pieces ?? []) {
    const hour = new Date(piece.published_at as string).getUTCHours();
    hourBuckets[hour].piece_count      += 1;
    hourBuckets[hour].total_engagement += engageCount[piece.id as string] ?? 0;
  }

  const data = Object.entries(hourBuckets).map(([hour, { total_engagement, piece_count }]) => ({
    hour:          Number(hour),
    piece_count,
    total_engagement,
    avg_engagement: piece_count > 0 ? parseFloat((total_engagement / piece_count).toFixed(2)) : 0,
  }));

  return c.json({ channel: channel ?? "all", data });
});
