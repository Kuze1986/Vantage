/**
 * BioLoop — Supabase Edge Function
 *
 * Runs daily via pg_cron. Analyzes content pieces published in the last 7 days,
 * extracts structural patterns, computes per-channel EWMA weights, and upserts
 * them into vantage.generation_weights. Also runs evergreen topic recycling over
 * the last 90 days.
 *
 * Invoke manually:
 *   supabase functions invoke bioloop --no-verify-jwt
 *
 * Scheduled via pg_cron (see migration 20260607000000_bioloop_edge_cron.sql).
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

// ── Pattern extraction ────────────────────────────────────────────────────────

const CTA_WORDS = [
  "try", "join", "click", "visit", "learn", "discover", "read",
  "get", "start", "sign up", "follow", "share", "comment", "subscribe",
  "apply", "enroll",
];

const EMOTIONAL_OPENERS = [
  "imagine", "what if", "ever wonder", "here's",
  "did you know", "the truth", "stop ", "warning:", "confession:",
];

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

  // Length buckets
  if      (body.length < 150) patterns.add("length_short");
  else if (body.length < 400) patterns.add("length_medium");
  else                        patterns.add("length_long");

  // Structural
  if (full.includes("?")) patterns.add("has_question");
  if (CTA_WORDS.some((w) => full.includes(w))) patterns.add("has_cta");
  if (/\d+%?/.test(full)) patterns.add("has_numbers");

  const hasHashtags =
    full.includes("#") ||
    (Array.isArray(payload.hashtags) && (payload.hashtags as string[]).length > 0);
  if (hasHashtags) patterns.add("has_hashtags");

  // Openers
  const opener = body.slice(0, 40).toLowerCase();
  if (EMOTIONAL_OPENERS.some((w) => opener.includes(w))) patterns.add("opener_emotional");
  if (/^(what|how|why|when|who|which|can |do |is |are |have |has )/i.test(body.trimStart())) {
    patterns.add("opener_question");
  }
  if (/^\d/.test(body.trimStart())) patterns.add("opener_number");

  // Format-specific
  if (format === "tweet"              && body.length < 120)   patterns.add("tweet_punchy");
  if (format === "linkedin_post"      && payload.headline)    patterns.add("linkedin_has_headline");
  if (format === "email_newsletter"   && payload.preview_text) patterns.add("email_has_preview_text");
  if (format === "tiktok_script"      && payload.hook)        patterns.add("tiktok_strong_hook");
  if (format === "reddit_thread"      && title.length < 80)   patterns.add("reddit_concise_title");
  if (format === "instagram_caption"  &&
      Array.isArray(payload.hashtags) &&
      (payload.hashtags as string[]).length >= 5)             patterns.add("instagram_hashtag_rich");

  // Content angles
  if (/tip|trick|hack|step\b|guide|how to/i.test(full))       patterns.add("angle_how_to");
  if (/stat|data|study|research|report|survey/i.test(full))   patterns.add("angle_data_driven");
  if (/story|personal|when i|my |i learned/i.test(full))      patterns.add("angle_personal_story");

  return [...patterns];
}

// ── Weight calculation (EWMA, alpha = 0.3) ────────────────────────────────────

const EWMA_ALPHA      = 0.3;
const MIN_SAMPLE_SIZE = 2;
const WEIGHT_FLOOR    = 0.50;
const WEIGHT_CEILING  = 2.00;

function ewma(newWeight: number, existingWeight: number | null): number {
  if (existingWeight === null) return newWeight;
  return EWMA_ALPHA * newWeight + (1 - EWMA_ALPHA) * existingWeight;
}

// ── Supabase client ───────────────────────────────────────────────────────────

function getClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    db:   { schema: "vantage" },
    auth: { persistSession: false },
  });
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function listWorkspaceIds(sb: ReturnType<typeof getClient>): Promise<string[]> {
  const { data } = await sb.from("workspaces").select("id");
  return (data ?? []).map((w) => w.id as string);
}

async function loadSettings(sb: ReturnType<typeof getClient>, workspaceId: string) {
  const { data } = await sb
    .from("settings")
    .select("key, value")
    .eq("workspace_id", workspaceId)
    .in("key", ["bioloop_enabled", "evergreen_threshold", "evergreen_recycle_days"]);

  const map: Record<string, string> = {};
  for (const row of data ?? []) map[row.key as string] = row.value as string;

  return {
    bioloop_enabled:       map.bioloop_enabled !== "false",
    evergreen_threshold:   parseInt(map.evergreen_threshold   ?? "3",  10),
    evergreen_recycle_days:parseInt(map.evergreen_recycle_days ?? "90", 10),
  };
}

// ── Activity logging ──────────────────────────────────────────────────────────

async function logActivity(
  sb: ReturnType<typeof getClient>,
  workspaceId: string,
  event_type: string,
  summary: string,
  payload: Record<string, unknown>,
) {
  await sb.from("activity_events").insert({
    source: "bioloop", source_type: "system",
    event_type, summary, payload,
    workspace_id: workspaceId,
    occurred_at: new Date().toISOString(),
  });
}

// ── runBioLoop ────────────────────────────────────────────────────────────────

async function runBioLoop(
  sb: ReturnType<typeof getClient>,
  workspaceId: string,
): Promise<{ analyzed: number; updated: number }> {
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Load published pieces from last 7 days
  const { data: pieces, error: pErr } = await sb
    .from("content_pieces")
    .select("id, channel_slug, format, content_payload")
    .eq("workspace_id", workspaceId)
    .eq("status", "published")
    .gte("published_at", since7d);

  if (pErr) throw new Error(`BioLoop DB error (pieces): ${pErr.message}`);

  if (!pieces?.length) {
    await logActivity(sb, workspaceId, "bioloop_skipped",
      "BioLoop skipped — no published pieces in last 7 days", {});
    return { analyzed: 0, updated: 0 };
  }

  // 2. Load engagement event counts
  const pieceIds = pieces.map((p) => p.id as string);
  const { data: events } = await sb
    .from("engagement_events")
    .select("content_piece_id")
    .eq("workspace_id", workspaceId)
    .in("content_piece_id", pieceIds);

  const engagementCount: Record<string, number> = {};
  for (const ev of events ?? []) {
    const id = ev.content_piece_id as string | null;
    if (id) engagementCount[id] = (engagementCount[id] ?? 0) + 1;
  }

  // 3. Build pattern stats per channel
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
    .select("channel_slug, pattern_key, weight")
    .eq("workspace_id", workspaceId);

  const existingMap: Record<string, number> = {};
  for (const row of existingWeights ?? []) {
    const key = `${row.channel_slug as string}::${row.pattern_key as string}`;
    existingMap[key] = row.weight as number;
  }

  // 5. Compute new weights and upsert
  let updatedCount = 0;

  for (const [channel, patterns] of Object.entries(patternStats)) {
    const channelPieces = pieces.filter((p) => p.channel_slug === channel);
    const engagedCount  = channelPieces.filter((p) => (engagementCount[p.id] ?? 0) > 0).length;
    const baseline      = channelPieces.length > 0
      ? Math.max(engagedCount / channelPieces.length, 0.1)
      : 0.3;

    for (const [patternKey, stat] of Object.entries(patterns)) {
      if (stat.total < MIN_SAMPLE_SIZE) continue;

      const rawRate   = stat.engaged / stat.total;
      const rawWeight = rawRate / baseline;
      const clamped   = Math.max(WEIGHT_FLOOR, Math.min(WEIGHT_CEILING, rawWeight));
      const mapKey    = `${channel}::${patternKey}`;
      const smoothed  = ewma(clamped, existingMap[mapKey] ?? null);

      const { error: uErr } = await sb
        .from("generation_weights")
        .upsert({
          workspace_id: workspaceId,
          channel_slug: channel,
          pattern_key:  patternKey,
          weight:       parseFloat(smoothed.toFixed(4)),
          sample_size:  stat.total,
          last_updated: new Date().toISOString(),
        }, { onConflict: "workspace_id,channel_slug,pattern_key" });

      if (!uErr) updatedCount++;
    }
  }

  await logActivity(sb, workspaceId, "bioloop_complete",
    `BioLoop: analyzed ${pieces.length} pieces, updated ${updatedCount} pattern weights`,
    { analyzed: pieces.length, updated: updatedCount },
  );

  console.log(`[bioloop] analyzed=${pieces.length} updated=${updatedCount}`);
  return { analyzed: pieces.length, updated: updatedCount };
}

// ── identifyEvergreenTopics ───────────────────────────────────────────────────

async function identifyEvergreenTopics(
  sb: ReturnType<typeof getClient>,
  workspaceId: string,
  evergreen_threshold: number,
  evergreen_recycle_days: number,
): Promise<{ scanned: number; marked: number }> {
  const since90d = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString();

  const { data: pieces, error } = await sb
    .from("content_pieces")
    .select("id, topic_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "published")
    .gte("published_at", since90d)
    .not("topic_id", "is", null);

  if (error || !pieces?.length) return { scanned: 0, marked: 0 };

  const pieceIds = pieces.map((p) => p.id as string);
  const { data: engagements } = await sb
    .from("engagement_events")
    .select("content_piece_id")
    .eq("workspace_id", workspaceId)
    .in("content_piece_id", pieceIds);

  const engageCount: Record<string, number> = {};
  for (const ev of engagements ?? []) {
    const pid = ev.content_piece_id as string;
    engageCount[pid] = (engageCount[pid] ?? 0) + 1;
  }

  const topicEngagement: Record<string, number> = {};
  for (const piece of pieces) {
    const tid = piece.topic_id as string;
    topicEngagement[tid] = (topicEngagement[tid] ?? 0) + (engageCount[piece.id as string] ?? 0);
  }

  const recycleAfter = new Date(
    Date.now() + evergreen_recycle_days * 24 * 60 * 60_000
  ).toISOString();

  let marked = 0;
  for (const [topicId, totalEng] of Object.entries(topicEngagement)) {
    if (totalEng >= evergreen_threshold) {
      await sb.from("topics").update({ recycle_after: recycleAfter, used_at: null })
        .eq("workspace_id", workspaceId).eq("id", topicId);
      marked++;
    }
  }

  if (marked > 0) {
    await logActivity(sb, workspaceId, "evergreen_recycled",
      `Evergreen: marked ${marked} high-performing topics for recycling in ${evergreen_recycle_days}d`,
      { scanned: pieces.length, marked, threshold: evergreen_threshold },
    );
  }

  return { scanned: Object.keys(topicEngagement).length, marked };
}

// ── Edge Function handler ─────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Only accept POST (pg_cron sends POST; allow GET for manual health checks)
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const sb = getClient();
    const workspaceIds = await listWorkspaceIds(sb);

    // Run the daily cycle once per workspace, each with its own settings.
    const results: Array<{
      workspace_id: string;
      skipped?: boolean;
      bioloop?: { analyzed: number; updated: number };
      evergreen?: { scanned: number; marked: number };
    }> = [];

    for (const ws of workspaceIds) {
      const settings = await loadSettings(sb, ws);
      if (!settings.bioloop_enabled) {
        results.push({ workspace_id: ws, skipped: true });
        continue;
      }
      const [bioloopResult, evergreenResult] = await Promise.all([
        runBioLoop(sb, ws),
        identifyEvergreenTopics(
          sb,
          ws,
          settings.evergreen_threshold,
          settings.evergreen_recycle_days,
        ),
      ]);
      results.push({ workspace_id: ws, bioloop: bioloopResult, evergreen: evergreenResult });
    }

    const body = { ok: true, workspaces: results.length, results };

    console.log("[bioloop] edge function complete", JSON.stringify(body));
    return Response.json(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[bioloop] edge function error:", message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
