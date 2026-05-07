import { Hono } from "hono";
import { getSupabaseAdmin } from "../lib/supabase.js";

export const dashboardRoutes = new Hono();

dashboardRoutes.get("/overview", async (c) => {
  const sb = getSupabaseAdmin();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: activity, error: aErr } = await sb
    .schema("vantage")
    .from("activity_events")
    .select("id, source, source_type, event_type, summary, occurred_at")
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(100);
  if (aErr) throw new Error(aErr.message);

  const { data: pieces } = await sb.schema("vantage").from("content_pieces").select("status");
  const counts: Record<string, number> = {
    draft: 0,
    auditing: 0,
    approved: 0,
    rejected: 0,
    queued: 0,
    published: 0,
    failed: 0,
  };
  for (const row of pieces ?? []) {
    const s = row.status as string;
    if (s in counts) counts[s] += 1;
  }

  const { data: engagement, error: eErr } = await sb
    .schema("vantage")
    .from("engagement_events")
    .select("id, content_piece_id, event_type, occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(50);
  if (eErr) throw new Error(eErr.message);

  return c.json({
    activityLast24h: activity ?? [],
    queueDepth: counts,
    recentEngagement: engagement ?? [],
  });
});
