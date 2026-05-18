/**
 * BioLoop — engagement-driven generation weight updater.
 *
 * Runs daily. Looks at content pieces published in the last 7 days, extracts
 * structural patterns from each piece's content_payload, then computes a weight
 * for each pattern based on whether pieces exhibiting that pattern received
 * engagement events. Weights are stored in vantage.generation_weights and are
 * loaded by Kuze on every generation call to bias prompts toward high-performers.
 */
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";

// ── Pattern extraction ────────────────────────────────────────────────────────

const CTA_WORDS = ["try", "join", "click", "visit", "learn", "discover", "read",
  "get", "start", "sign up", "follow", "share", "comment", "subscribe", "apply", "enroll"];

const EMOTIONAL_OPENERS = ["imagine", "what if", "ever wonder", "here's",
  "did you know", "the truth", "stop ", "warning:", "confession:"];

function extractPatterns(
  format: string,
  payload: Record<string, unknown>,
): string[] {
  const patterns = new Set<string>();

  const body    = String(payload.body    ?? payload.text   ?? payload.hook ??
                         payload.caption ?? payload.script ?? "");
  const subject = String(payload.subject ?? "");
  const title   = String(payload.title   ?? "");
  const full    = `${subject} ${title} ${body}`.trim().toLowerCase();

  // Length buckets (based on body length)
  if      (body.length < 150) patterns.add("length_short");
  else if (body.length < 400) patterns.add("length_medium");
  else                        patterns.add("length_long");

  // Question present
  if (full.includes("?")) patterns.add("has_question");

  // CTA present
  if (CTA_WORDS.some((w) => full.includes(w))) patterns.add("has_cta");

  // Numbers / stats
  if (/\d+%?/.test(full)) patterns.add("has_numbers");

  // Hashtags
  const hasHashtags =
    full.includes("#") ||
    (Array.isArray(payload.hashtags) && (payload.hashtags as string[]).length > 0);
  if (hasHashtags) patterns.add("has_hashtags");

  // Emotional opener (first 40 chars of body)
  const opener = body.slice(0, 40).toLowerCase();
  if (EMOTIONAL_OPENERS.some((w) => opener.includes(w))) patterns.add("opener_emotional");

  // Question opener (body starts with interrogative)
  if (/^(what|how|why|when|who|which|can |do |is |are |have |has )/i.test(body.trimStart())) {
    patterns.add("opener_question");
  }

  // Stat / number opener
  if (/^\d/.test(body.trimStart())) patterns.add("opener_number");

  // Format-specific
  if (format === "tweet" && body.length < 120)             patterns.add("tweet_punchy");
  if (format === "linkedin_post" && payload.headline)      patterns.add("linkedin_has_headline");
  if (format === "email_newsletter" && payload.preview_text) patterns.add("email_has_preview_text");
  if (format === "tiktok_script" && payload.hook)          patterns.add("tiktok_strong_hook");
  if (format === "reddit_thread"  && title.length < 80)    patterns.add("reddit_concise_title");
  if (format === "instagram_caption" &&
      Array.isArray(payload.hashtags) &&
      (payload.hashtags as string[]).length >= 5)          patterns.add("instagram_hashtag_rich");

  // Content angle signals
  if (/tip|trick|hack|step\b|guide|how to/i.test(full))  patterns.add("angle_how_to");
  if (/stat|data|study|research|report|survey/i.test(full)) patterns.add("angle_data_driven");
  if (/story|personal|when i|my |i learned/i.test(full)) patterns.add("angle_personal_story");

  return [...patterns];
}

// ── Weight calculation (EWMA, alpha = 0.3) ────────────────────────────────────

const EWMA_ALPHA      = 0.3;
const MIN_SAMPLE_SIZE = 2;     // patterns with < 2 pieces are skipped
const WEIGHT_FLOOR    = 0.50;
const WEIGHT_CEILING  = 2.00;

function ewma(newWeight: number, existingWeight: number | null): number {
  if (existingWeight === null) return newWeight;
  return EWMA_ALPHA * newWeight + (1 - EWMA_ALPHA) * existingWeight;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runBioLoop(): Promise<{ analyzed: number; updated: number }> {
  const sb     = getSupabaseAdmin();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Load published pieces from last 7 days
  const { data: pieces, error: pErr } = await sb
    .from("content_pieces")
    .select("id, channel_slug, format, content_payload")
    .eq("status", "published")
    .gte("published_at", since7d);

  if (pErr) throw new Error(`BioLoop DB error (pieces): ${pErr.message}`);

  if (!pieces?.length) {
    await logActivity({
      source: "bioloop", source_type: "system",
      event_type: "bioloop_skipped",
      summary: "BioLoop skipped — no published pieces in last 7 days",
      payload: {},
    });
    return { analyzed: 0, updated: 0 };
  }

  // 2. Load engagement event counts for those pieces
  const pieceIds = pieces.map((p) => p.id as string);
  const { data: events } = await sb
    .from("engagement_events")
    .select("content_piece_id")
    .in("content_piece_id", pieceIds);

  const engagementCount: Record<string, number> = {};
  for (const ev of events ?? []) {
    const id = ev.content_piece_id as string | null;
    if (id) engagementCount[id] = (engagementCount[id] ?? 0) + 1;
  }

  // 3. Build pattern stats per channel
  // patternStats[channel][pattern] = { engaged: n_pieces_with_engagement, total: n_pieces }
  type Stat = { engaged: number; total: number };
  const patternStats: Record<string, Record<string, Stat>> = {};

  for (const piece of pieces as {
    id: string; channel_slug: string; format: string;
    content_payload: Record<string, unknown>
  }[]) {
    const ch = piece.channel_slug;
    if (!patternStats[ch]) patternStats[ch] = {};

    const patterns = extractPatterns(piece.format, piece.content_payload);
    const engaged  = (engagementCount[piece.id] ?? 0) > 0;

    for (const p of patterns) {
      if (!patternStats[ch][p]) patternStats[ch][p] = { engaged: 0, total: 0 };
      patternStats[ch][p].total  += 1;
      if (engaged) patternStats[ch][p].engaged += 1;
    }
  }

  // 4. Load existing weights for EWMA
  const { data: existingWeights } = await sb
    .from("generation_weights")
    .select("channel_slug, pattern_key, weight");

  const existingMap: Record<string, number> = {};
  for (const row of existingWeights ?? []) {
    const key = `${row.channel_slug as string}::${row.pattern_key as string}`;
    existingMap[key] = row.weight as number;
  }

  // 5. Compute new weights and upsert
  let updatedCount = 0;

  for (const [channel, patterns] of Object.entries(patternStats)) {
    // Channel-level engagement baseline
    const channelPieces  = pieces.filter((p) => p.channel_slug === channel);
    const engagedCount   = channelPieces.filter((p) => (engagementCount[p.id] ?? 0) > 0).length;
    const baseline       = channelPieces.length > 0
      ? Math.max(engagedCount / channelPieces.length, 0.1)
      : 0.3;

    for (const [patternKey, stat] of Object.entries(patterns)) {
      if (stat.total < MIN_SAMPLE_SIZE) continue;

      const rawRate    = stat.engaged / stat.total;
      const rawWeight  = rawRate / baseline;
      const clamped    = Math.max(WEIGHT_FLOOR, Math.min(WEIGHT_CEILING, rawWeight));
      const mapKey     = `${channel}::${patternKey}`;
      const smoothed   = ewma(clamped, existingMap[mapKey] ?? null);

      const { error: uErr } = await sb
        .from("generation_weights")
        .upsert({
          channel_slug: channel,
          pattern_key:  patternKey,
          weight:       parseFloat(smoothed.toFixed(4)),
          sample_size:  stat.total,
          last_updated: new Date().toISOString(),
        }, { onConflict: "channel_slug,pattern_key" });

      if (!uErr) updatedCount++;
    }
  }

  await logActivity({
    source: "bioloop", source_type: "system",
    event_type: "bioloop_complete",
    summary: `BioLoop: analyzed ${pieces.length} pieces, updated ${updatedCount} pattern weights`,
    payload: { analyzed: pieces.length, updated: updatedCount },
  });

  console.log(`[bioloop] analyzed=${pieces.length} updated=${updatedCount}`);
  return { analyzed: pieces.length, updated: updatedCount };
}
