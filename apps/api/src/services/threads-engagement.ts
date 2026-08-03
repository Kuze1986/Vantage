/**
 * Threads engagement polling
 *
 * Threads has no push-webhook API for engagement. Instead, we poll the Meta
 * Graph Insights API per published Threads piece.
 *
 * Each poll round:
 *  1. Load all content_pieces with channel_slug='threads' and status='published'
 *     that have an external_post_id (the Threads media id — see adapters/threads.ts
 *     postThread(), which stores the published media id directly).
 *  2. Call GET /{media-id}/insights?metric=views,likes,replies,reposts,quotes for
 *     each piece sequentially (Threads has no bulk Insights endpoint). Insights
 *     returns aggregate metrics only, never per-engager identity, so
 *     actor_external_id is always null here.
 *  3. Insert engagement_events with external_event_id = 'threads_poll_{mediaId}_{hourEpoch}_{metric}'
 *     so the unique index prevents duplicate rows for the same poll window.
 *
 * NOTE: this requires the threads_manage_insights OAuth scope. The adapter's
 * current authorize request only asks for threads_basic,threads_content_publish
 * (adapters/threads.ts buildAuthorizeUrl()) — until that scope is added and
 * already-connected workspaces reconnect, Insights calls will fail per-post and
 * this poller will silently skip them (see the per-post try/catch below).
 */

import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { recordGrowthEvent, engagementKind } from "../lib/growth.js";
import { recordCampaignEngagement } from "../lib/campaign-kpi.js";
import { getThreadsAccessToken } from "../adapters/threads.js";

const TH_GRAPH = "https://graph.threads.net/v1.0";
const POLL_HOUR_MS = 3 * 60 * 60_000; // 3-hour poll window for dedup key, matches the tick interval

const METRICS = ["views", "likes", "replies", "reposts", "quotes"] as const;
type Metric = (typeof METRICS)[number];

type InsightsResponse = {
  data?: { name?: string; values?: { value?: number }[] }[];
  error?: { message?: string };
};

export async function pollThreadsEngagement(workspaceId: string): Promise<{ polled: number; inserted: number }> {
  const sb = getSupabaseAdmin();

  const { data: pieces, error } = await sb
    .from("content_pieces")
    .select("id, external_post_id")
    .eq("workspace_id", workspaceId)
    .eq("channel_slug", "threads")
    .eq("status", "published")
    .not("external_post_id", "is", null);

  if (error) {
    console.error("[threads-engagement] load error:", error.message);
    return { polled: 0, inserted: 0 };
  }
  if (!pieces?.length) return { polled: 0, inserted: 0 };

  let token: string;
  try {
    ({ token } = await getThreadsAccessToken(workspaceId));
  } catch {
    // Channel not connected — nothing to poll.
    return { polled: 0, inserted: 0 };
  }

  const mediaIds = [...new Set(pieces.map((p) => p.external_post_id as string))];
  const pieceByMediaId = new Map<string, string>();
  for (const p of pieces) {
    if (p.external_post_id) pieceByMediaId.set(p.external_post_id as string, p.id as string);
  }

  let totalInserted = 0;
  const hourEpoch = Math.floor(Date.now() / POLL_HOUR_MS);

  // No bulk endpoint exists — poll sequentially, one Graph call per post.
  for (const mediaId of mediaIds) {
    const contentPieceId = pieceByMediaId.get(mediaId) ?? null;
    if (!contentPieceId) continue;

    const url = new URL(`${TH_GRAPH}/${mediaId}/insights`);
    url.searchParams.set("metric", METRICS.join(","));
    url.searchParams.set("access_token", token);

    let json: InsightsResponse;
    try {
      const res = await fetch(url);
      json = (await res.json()) as InsightsResponse;
      if (!res.ok || json.error) {
        console.warn(`[threads-engagement] insights failed for ${mediaId}:`, json.error?.message ?? res.status);
        continue;
      }
    } catch (fetchErr) {
      console.warn("[threads-engagement] fetch error:", fetchErr);
      continue;
    }

    const metricValues = new Map<string, number>();
    for (const m of json.data ?? []) {
      if (m.name && m.values?.[0]?.value != null) metricValues.set(m.name, m.values[0].value);
    }
    if (metricValues.size === 0) continue;

    const externalEventBase = `threads_poll_${mediaId}_${hourEpoch}`;
    const events = METRICS.filter((m) => metricValues.has(m)).map((m) => ({
      event_type: `threads_${m}` as const,
      value: metricValues.get(m) ?? 0,
      suffix: m as Metric,
    }));
    if (events.length === 0) continue;

    const { error: insErr } = await sb.from("engagement_events").insert(
      events.map((e) => ({
        workspace_id:       workspaceId,
        content_piece_id:   contentPieceId,
        event_type:         e.event_type,
        event_payload:      { media_id: mediaId, metric: e.suffix, value: e.value, polled_at: new Date().toISOString() },
        external_event_id:  `${externalEventBase}_${e.suffix}`,
        actor_external_id:  null, // Insights returns aggregate metrics only — no per-engager identity
        occurred_at:        new Date().toISOString(),
      })),
    );

    if (insErr && !insErr.message.includes("unique") && !insErr.message.includes("duplicate")) {
      console.warn("[threads-engagement] insert error:", insErr.message);
    } else if (!insErr) {
      totalInserted += events.length;
      for (const e of events) {
        await recordCampaignEngagement({ contentPieceId, channel: "threads", eventType: e.event_type });
        await recordGrowthEvent({
          loop: "acquisition",
          kind: engagementKind(e.event_type),
          channel: "threads",
          meta: { event_type: e.event_type, content_piece_id: contentPieceId, workspace_id: workspaceId, polled: true },
        });
      }
    }
  }

  if (totalInserted > 0) {
    await logActivity({
      source:       "threads-engagement",
      source_type:  "system",
      event_type:   "poll_complete",
      summary:      `Threads engagement poll: ${totalInserted} events from ${mediaIds.length} posts`,
      payload:      { polled: mediaIds.length, inserted: totalInserted },
      workspace_id: workspaceId,
    });
  }

  return { polled: mediaIds.length, inserted: totalInserted };
}
