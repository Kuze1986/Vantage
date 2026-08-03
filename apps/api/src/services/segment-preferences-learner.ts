/**
 * Segment-preferences learner
 *
 * learnSegmentPreferences() (lib/audience.ts) has existed since the audience-model
 * migration but was never called anywhere — segment_preferences has always been empty.
 * This wires it to real data, derived from the same segment_members + engagement_events
 * the segment-assignment engine populates.
 *
 * Honest limitation, not papered over: this codebase has no tone or topic tagging
 * anywhere on content_pieces. learnSegmentPreferences()'s input shape asks for both per
 * post; we pass an empty string / empty array rather than inventing values, which means
 * the LLM's `preferred_tones` and `topic_interests` output for this feature will be
 * lower-confidence than `preferred_content_types`/`preferred_formats`/posting-time
 * outputs (which are derived from real channel/timing/CTA/length signals). Worth
 * revisiting once tone/topic tagging exists on content_pieces.
 */

import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { learnSegmentPreferences } from "../lib/audience.js";

const MIN_MEMBERS = 3; // arbitrary-but-reasonable floor — avoid learning from n=1/2 noise
const MIN_ENGAGED_POSTS = 3;
const MAX_MEMBERS_PER_SEGMENT = 200; // bound event-lookup query size
const LOOKBACK_DAYS = 90;

const CTA_KEYWORDS = /\b(sign up|join|try|learn more|click|register|subscribe|download|get started)\b/i;

type SegmentRow = { id: string; name: string };
type MemberRow = { external_id: string; segment_id: string };
type EventRow = { content_piece_id: string | null; actor_external_id: string | null };
type PieceRow = {
  id: string;
  channel_slug: string;
  content_payload: Record<string, unknown> | null;
  published_at: string | null;
  image_url: string | null;
  video_url: string | null;
};

function extractText(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  const v = payload.body ?? payload.text ?? payload.hook ?? payload.title ?? "";
  return typeof v === "string" ? v : "";
}

export async function learnAndStorePreferences(
  workspaceId: string,
): Promise<{ segmentsProcessed: number; updated: number }> {
  const sb = getSupabaseAdmin();

  const { data: segments, error: segErr } = await sb
    .from("segments")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);
  if (segErr || !segments?.length) return { segmentsProcessed: 0, updated: 0 };

  const { data: members, error: memErr } = await sb
    .from("segment_members")
    .select("external_id, segment_id")
    .eq("workspace_id", workspaceId)
    .in("segment_id", (segments as SegmentRow[]).map((s) => s.id));
  if (memErr || !members?.length) return { segmentsProcessed: segments.length, updated: 0 };

  const membersBySegment = new Map<string, string[]>();
  for (const m of members as MemberRow[]) {
    const list = membersBySegment.get(m.segment_id) ?? [];
    if (list.length < MAX_MEMBERS_PER_SEGMENT) list.push(m.external_id);
    membersBySegment.set(m.segment_id, list);
  }

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let updated = 0;

  for (const segment of segments as SegmentRow[]) {
    const externalIds = membersBySegment.get(segment.id) ?? [];
    if (externalIds.length < MIN_MEMBERS) continue;

    const { data: events } = await sb
      .from("engagement_events")
      .select("content_piece_id, actor_external_id")
      .eq("workspace_id", workspaceId)
      .in("actor_external_id", externalIds)
      .gte("occurred_at", cutoff)
      .not("content_piece_id", "is", null);

    const pieceEngagementCount = new Map<string, number>();
    for (const e of (events ?? []) as EventRow[]) {
      if (!e.content_piece_id) continue;
      pieceEngagementCount.set(e.content_piece_id, (pieceEngagementCount.get(e.content_piece_id) ?? 0) + 1);
    }
    if (pieceEngagementCount.size < MIN_ENGAGED_POSTS) continue;

    const pieceIds = [...pieceEngagementCount.keys()];
    const { data: pieces } = await sb
      .from("content_pieces")
      .select("id, channel_slug, content_payload, published_at, image_url, video_url")
      .in("id", pieceIds);
    if (!pieces?.length) continue;

    const totalEngagements = [...pieceEngagementCount.values()].reduce((a, b) => a + b, 0);

    const enriched = (pieces as PieceRow[])
      .map((p) => {
        const text = extractText(p.content_payload);
        const count = pieceEngagementCount.get(p.id) ?? 0;
        return {
          piece: p,
          text,
          engagementCount: count,
          // A real share-of-segment-engagement fraction, not an impression-based rate —
          // no per-piece impression data exists to compute a true engagement rate.
          engagementRate: totalEngagements > 0 ? count / totalEngagements : 0,
          hasCTA: CTA_KEYWORDS.test(text),
          hasHashtag: text.includes("#"),
          hasVisual: Boolean(p.image_url || p.video_url),
        };
      })
      .sort((a, b) => b.engagementCount - a.engagementCount)
      .slice(0, 20);

    const topEngagedPosts = enriched.map((e) => ({
      contentType: e.piece.channel_slug,
      tone: "",
      format: e.piece.channel_slug,
      postedAt: e.piece.published_at ?? new Date().toISOString(),
      engagementRate: e.engagementRate,
      topics: [] as string[],
      postLength: e.text.length,
      hasCTA: e.hasCTA,
    }));

    let output;
    try {
      output = await learnSegmentPreferences({ topEngagedPosts, segmentName: segment.name });
    } catch (err) {
      console.warn(`[segment-preferences] learn failed for segment ${segment.id}:`, err instanceof Error ? err.message : err);
      continue;
    }

    const avgPreferredPostLength = Math.round(
      enriched.reduce((sum, e) => sum + e.text.length, 0) / enriched.length,
    );
    const visualFraction = enriched.filter((e) => e.hasVisual).length / enriched.length;
    const hashtagFraction = enriched.filter((e) => e.hasHashtag).length / enriched.length;

    const row = {
      preferred_content_types:  output.preferred_content_types,
      preferred_tones:          output.preferred_tones,
      preferred_formats:        output.preferred_formats,
      posting_schedule:         output.optimal_posting_times,
      avg_preferred_post_length: avgPreferredPostLength,
      prefers_visuals:          visualFraction > 0.5,
      prefers_hashtags:         hashtagFraction > 0.5,
      topic_interests:          output.topic_interests,
      preferred_cta_types:      output.preferred_cta_types,
      updated_at:               new Date().toISOString(),
    };

    const { data: existing } = await sb
      .from("segment_preferences")
      .select("id")
      .eq("segment_id", segment.id)
      .maybeSingle();

    if (existing?.id) {
      await sb.from("segment_preferences").update(row).eq("id", existing.id);
    } else {
      await sb.from("segment_preferences").insert({ segment_id: segment.id, ...row });
    }
    updated++;
  }

  if (updated > 0) {
    await logActivity({
      source:       "segment-preferences-learner",
      source_type:  "system",
      event_type:   "preferences_learned",
      summary:      `Learned preferences for ${updated} segment(s)`,
      payload:      { segments_processed: segments.length, updated },
      workspace_id: workspaceId,
    });
  }

  return { segmentsProcessed: segments.length, updated };
}
