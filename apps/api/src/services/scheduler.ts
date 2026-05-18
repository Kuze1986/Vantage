import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { generateContent } from "./kuze.js";
import { auditContent } from "./ilita.js";
import { pickNextTopic } from "./source.js";
import { refreshTopicsFromPulse } from "./pulse.js";
import { runBioLoop } from "./bioloop.js";
import { pollRedditEngagement } from "./reddit-engagement.js";
import { loadSettings } from "../lib/settings.js";
import { channelFormatMap } from "@vantage/prompts";
import type { ChannelSlug } from "@vantage/prompts";

// Adapter imports — each channel routes to its own adapter
import { postTweet } from "../adapters/x.js";
import { postLinkedIn } from "../adapters/linkedin.js";
import { postToSubreddit } from "../adapters/reddit.js";
import { sendEmail } from "../adapters/email.js";

const TICK_MS               = 60_000;            // check queue every 60 seconds
const AUTO_GEN_TICK         = 300_000;           // check auto-generate every 5 minutes
const PULSE_TICK_MS         = 30 * 60_000;       // pulse reactor every 30 minutes
const BIOLOOP_TICK_MS       = 24 * 60 * 60_000;  // BioLoop weight update every 24 hours
const REDDIT_ENGAGE_TICK_MS = 2  * 60 * 60_000;  // Reddit engagement poll every 2 hours

type ChannelRow = {
  slug: string;
  enabled: boolean;
  cadence_config: {
    posts_per_day?: number;
    posts_per_week?: number;
    posting_hours?: number[];
    auto_approve?: boolean;
    subreddits?: string[];
  };
};

type ContentPieceRow = {
  id: string;
  channel_slug: string;
  format: string;
  content_payload: Record<string, unknown>;
  retry_count: number;
};

// 3A-6: Exponential backoff delays — [0]=5m, [1]=15m, [2]=1h, then give up
const RETRY_DELAYS_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000];

// ── Manual schedule: mark a piece queued with optional time ──────────────────
export async function scheduleContentPiece(contentPieceId: string, scheduledForIso?: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const scheduledFor = scheduledForIso ?? new Date().toISOString();

  const { data: piece, error: loadErr } = await sb
    .from("content_pieces")
    .select("id, status").eq("id", contentPieceId).single();
  if (loadErr || !piece) throw new Error("Content piece not found");
  if (piece.status !== "approved") throw new Error(`Can only schedule approved pieces, got ${piece.status}`);

  const { error } = await sb.from("content_pieces").update({
    status: "queued",
    scheduled_for: scheduledFor,
    updated_at: new Date().toISOString(),
  }).eq("id", contentPieceId);
  if (error) throw new Error(error.message);

  await logActivity({
    source: "scheduler", source_type: "system",
    event_type: "scheduled",
    summary: `Content piece ${contentPieceId} queued for ${scheduledFor}`,
    payload: { content_piece_id: contentPieceId, scheduled_for: scheduledFor },
  });
}

// ── Publish one piece via its channel adapter ─────────────────────────────────
async function publishPiece(piece: ContentPieceRow, channelRow: ChannelRow): Promise<void> {
  const sb = getSupabaseAdmin();
  const slug = piece.channel_slug as ChannelSlug;
  const payload = piece.content_payload;
  let externalId: string;

  try {
    switch (slug) {
      case "x": {
        const body = String(payload.body ?? "");
        const { id } = await postTweet(body);
        externalId = id;
        break;
      }
      case "linkedin": {
        const body     = String(payload.body ?? "");
        const headline = payload.headline ? String(payload.headline) : undefined;
        // 3A-3: pass image_url for LinkedIn image card
        const imageUrl = typeof payload.image_url === "string" ? payload.image_url : undefined;
        const { id }   = await postLinkedIn(body, headline, imageUrl);
        externalId = id;
        break;
      }
      case "reddit": {
        const cadence = channelRow.cadence_config as { subreddits?: string[]; subreddit_index?: number };
        const subs = cadence.subreddits ?? [];
        if (subs.length === 0) throw new Error("No subreddits configured for Reddit channel");
        // 3A-4: round-robin index instead of random
        const idx       = (cadence.subreddit_index ?? 0) % subs.length;
        const subreddit = subs[idx];
        const nextIndex = (idx + 1) % subs.length;
        const sbAdmin   = getSupabaseAdmin();
        await sbAdmin.from("channels").update({
          cadence_config: { ...cadence, subreddit_index: nextIndex },
        }).eq("slug", "reddit");
        const { id } = await postToSubreddit({
          subreddit,
          title: String(payload.title ?? payload.body ?? "").slice(0, 300),
          body:  String(payload.body ?? ""),
          is_link_post: payload.is_link_post === true,
        });
        externalId = id;
        break;
      }
      case "email": {
        // 3A-2: pass pieceId for UTM tagging
        const { id } = await sendEmail({
          subject: String(payload.subject ?? "NEXUS Newsletter"),
          html:    String(payload.body ?? ""),
          pieceId: piece.id,
        });
        externalId = id;
        break;
      }
      default:
        throw new Error(`Channel ${slug} requires manual posting — use the Queue page`);
    }

    const now = new Date().toISOString();
    await sb.from("content_pieces").update({
      status: "published", published_at: now, external_post_id: externalId, updated_at: now,
    }).eq("id", piece.id);

    await logActivity({
      source: `adapter:${slug}`, source_type: "adapter",
      event_type: "cadence_published",
      summary: `Cadence published ${slug} piece ${piece.id} → ${externalId}`,
      payload: { content_piece_id: piece.id, external_post_id: externalId, channel: slug },
    });
  } catch (e) {
    const msg          = e instanceof Error ? e.message : String(e);
    const retryCount   = piece.retry_count ?? 0;
    const delayMs      = RETRY_DELAYS_MS[retryCount];
    const willRetry    = delayMs !== undefined;
    const now          = new Date();

    if (willRetry) {
      // 3A-6: Schedule a retry with exponential backoff — keep status "queued"
      const retryAfter = new Date(now.getTime() + delayMs).toISOString();
      await sb.from("content_pieces").update({
        retry_count: retryCount + 1,
        retry_after: retryAfter,
        audit_notes: `Retry ${retryCount + 1}: ${msg.slice(0, 400)}`,
        updated_at:  now.toISOString(),
      }).eq("id", piece.id);
      await logActivity({
        source: `adapter:${slug}`, source_type: "adapter",
        event_type: "cadence_publish_retry",
        summary: `Retry ${retryCount + 1}/3 for ${slug} piece ${piece.id} — next at ${retryAfter}`,
        payload: { content_piece_id: piece.id, channel: slug, retry_count: retryCount + 1, retry_after: retryAfter },
      });
    } else {
      // Max retries exhausted — mark as failed
      await sb.from("content_pieces").update({
        status:      "failed",
        audit_notes: `Failed after ${retryCount} retries: ${msg.slice(0, 400)}`,
        updated_at:  now.toISOString(),
      }).eq("id", piece.id);
      await logActivity({
        source: `adapter:${slug}`, source_type: "adapter",
        event_type: "cadence_publish_failed",
        summary: `Permanently failed after ${retryCount} retries: ${msg.slice(0, 400)}`,
        payload: { content_piece_id: piece.id, channel: slug, retry_count: retryCount },
      });
    }
    throw e;
  }
}

// ── Cadence tick: publish all pieces due now ──────────────────────────────────
async function cadenceTick(): Promise<void> {
  const sb  = getSupabaseAdmin();
  const now = new Date().toISOString();

  // 3A-6: also check retry_after — only pick up pieces whose retry window has elapsed
  const { data: pieces, error } = await sb
    .from("content_pieces")
    .select("id, channel_slug, format, content_payload, retry_count")
    .eq("status", "queued")
    .lte("scheduled_for", now)
    .or(`retry_after.is.null,retry_after.lte.${now}`)
    .limit(20);

  if (error) {
    console.error("[cadence] queue query error:", error.message);
    return;
  }
  if (!pieces?.length) return;

  // Load enabled channel rows for routing
  const { data: channels } = await sb.from("channels").select("slug, enabled, cadence_config").eq("enabled", true);
  const channelMap = Object.fromEntries((channels ?? []).map((c: ChannelRow) => [c.slug, c]));

  for (const piece of pieces as ContentPieceRow[]) {
    const channelRow = channelMap[piece.channel_slug] as ChannelRow | undefined;
    if (!channelRow) continue;
    try {
      await publishPiece(piece, channelRow);
    } catch {
      // Error already logged inside publishPiece
    }
  }
}

// ── Auto-generate tick: fill quota for enabled auto-approve channels ──────────
async function autoGenerateTick(): Promise<void> {
  const sb  = getSupabaseAdmin();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const { data: channels } = await sb
    .from("channels")
    .select("slug, enabled, cadence_config")
    .eq("enabled", true);

  if (!channels?.length) return;

  for (const ch of channels as ChannelRow[]) {
    if (!ch.cadence_config.auto_approve) continue;

    const postsPerDay = ch.cadence_config.posts_per_day ?? 0;
    if (postsPerDay <= 0) continue;

    // Count how many pieces were published today for this channel
    const { count } = await sb
      .from("content_pieces")
      .select("*", { count: "exact", head: true })
      .eq("channel_slug", ch.slug)
      .eq("status", "published")
      .gte("published_at", todayStart);

    const publishedToday = count ?? 0;
    const deficit        = postsPerDay - publishedToday;
    if (deficit <= 0) continue;

    // Load brand voice
    const { data: voices } = await sb.from("brand_voice").select("*").limit(1);
    const voice = voices?.[0];
    if (!voice) continue;
    const brandVoiceStr = JSON.stringify({
      name: voice.name,
      description: voice.description,
      per_channel_tone: voice.per_channel_tone,
      off_topics: voice.off_topics,
    });

    // Generate one piece per deficit slot (up to a cap of 3 at a time)
    const slots = Math.min(deficit, 3);
    for (let i = 0; i < slots; i++) {
      const topic = await pickNextTopic();
      if (!topic) break;

      try {
        // Generate
        const gen = await generateContent({
          channel:     ch.slug as ChannelSlug,
          topic_text:  topic.topic_text,
          vertical:    topic.vertical,
          brand_voice: brandVoiceStr,
          extras: { subreddit: ch.cadence_config.subreddits?.[0] },
        });

        // Insert as 'auditing'
        const { data: inserted, error: insErr } = await sb
          .from("content_pieces")
          .insert({
            topic_id:        topic.id,
            channel_slug:    ch.slug,
            format:          gen.format,
            content_payload: gen.content_payload,
            status:          "auditing",
            audit_iterations: 0,
          }).select("id").single();

        if (insErr || !inserted) continue;

        // Update UTM tags now that we have the piece ID
        const { format, content_payload } = gen;
        const taggedPayload = { ...content_payload };
        const { tagUrls } = await import("../lib/utm.js");
        for (const [k, v] of Object.entries(taggedPayload)) {
          if (typeof v === "string") taggedPayload[k] = tagUrls(v, ch.slug, inserted.id);
        }
        await sb.from("content_pieces").update({ content_payload: taggedPayload }).eq("id", inserted.id);

        // Mark topic used
        await sb.from("topics").update({ used_at: new Date().toISOString() }).eq("id", topic.id);

        await logActivity({
          source: "kuze", source_type: "agent",
          event_type: "auto_generated",
          summary: `Auto-generated ${format} for ${ch.slug}`,
          payload: { content_piece_id: inserted.id, topic_id: topic.id, channel: ch.slug },
        });

        // Audit it
        const auditResult = await auditContent({
          content:     gen.text_preview || JSON.stringify(gen.content_payload),
          format,
          brand_voice: brandVoiceStr,
        });

        if (auditResult.verdict === "pass") {
          // Auto-approve and queue it
          const postingHours = ch.cadence_config.posting_hours ?? [9, 12, 17]; // default UTC hours
          const hour = postingHours[i % postingHours.length];
          const scheduledFor = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0)).toISOString();

          await sb.from("content_pieces").update({
            status: "queued",
            audit_notes: auditResult.feedback || null,
            scheduled_for: scheduledFor,
            updated_at: new Date().toISOString(),
          }).eq("id", inserted.id);

          await logActivity({
            source: "ilita", source_type: "agent",
            event_type: "auto_approved_queued",
            summary: `Auto-approved + queued ${ch.slug} piece for ${scheduledFor}`,
            payload: { content_piece_id: inserted.id, scheduled_for: scheduledFor },
          });
        } else {
          // Regen once with feedback
          const regenTopic = `${topic.topic_text}\n\nIlita feedback (must address): ${auditResult.feedback}`;
          const gen2 = await generateContent({
            channel: ch.slug as ChannelSlug,
            topic_text: regenTopic,
            vertical: topic.vertical,
            brand_voice: brandVoiceStr,
          });
          const audit2 = await auditContent({ content: gen2.text_preview, format: gen2.format, brand_voice: brandVoiceStr });
          const finalStatus = audit2.verdict === "pass" ? "approved" : "rejected";
          await sb.from("content_pieces").update({
            status: finalStatus,
            content_payload: gen2.content_payload,
            audit_notes: audit2.feedback,
            audit_iterations: 1,
            updated_at: new Date().toISOString(),
          }).eq("id", inserted.id);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await logActivity({
          source: "scheduler", source_type: "system",
          event_type: "auto_generate_error",
          summary: msg.slice(0, 300),
          payload: { channel: ch.slug, topic_id: topic.id },
        });
      }
    }
  }
}

// ── Pulse tick: ingest external signals every 30 min ─────────────────────────
async function pulseTick(): Promise<void> {
  const sb = getSupabaseAdmin();
  const { data: ch } = await sb
    .from("channels")
    .select("cadence_config")
    .eq("slug", "reddit")
    .maybeSingle();
  const subreddits: string[] =
    (ch?.cadence_config as { subreddits?: string[] } | null)?.subreddits ?? [];

  try {
    const { inserted, scanned } = await refreshTopicsFromPulse(subreddits);
    if (inserted > 0) {
      console.log(`[pulse] ${inserted} new signals inserted from ${scanned} scanned`);
    }
  } catch (e) {
    console.error("[pulse] tick error:", e instanceof Error ? e.message : e);
  }
}

// ── BioLoop tick: update generation weights daily ─────────────────────────────
async function biloopTick(): Promise<void> {
  try {
    const { bioloop_enabled } = await loadSettings();
    if (!bioloop_enabled) {
      console.log("[bioloop] skipped — disabled via settings");
      return;
    }
    const { analyzed, updated } = await runBioLoop();
    console.log(`[bioloop] tick complete — analyzed=${analyzed} updated=${updated}`);
  } catch (e) {
    console.error("[bioloop] tick error:", e instanceof Error ? e.message : e);
  }
}

// ── Engine boot ───────────────────────────────────────────────────────────────
let cadenceTimer:      ReturnType<typeof setInterval> | null = null;
let autoGenTimer:      ReturnType<typeof setInterval> | null = null;
let pulseTimer:        ReturnType<typeof setInterval> | null = null;
let biloopTimer:       ReturnType<typeof setInterval> | null = null;
let redditEngageTimer: ReturnType<typeof setInterval> | null = null;

export function startCadenceEngine(): void {
  if (cadenceTimer) return; // already running

  // Cadence: publish due pieces every 60s
  void cadenceTick().catch((e) => console.error("[cadence] tick error:", e));
  cadenceTimer = setInterval(() => {
    void cadenceTick().catch((e) => console.error("[cadence] tick error:", e));
  }, TICK_MS);

  // Auto-generate: fill quotas every 5m
  void autoGenerateTick().catch((e) => console.error("[auto-gen] tick error:", e));
  autoGenTimer = setInterval(() => {
    void autoGenerateTick().catch((e) => console.error("[auto-gen] tick error:", e));
  }, AUTO_GEN_TICK);

  // Pulse reactor: ingest external signals every 30m
  void pulseTick().catch((e) => console.error("[pulse] initial tick error:", e));
  pulseTimer = setInterval(() => {
    void pulseTick().catch((e) => console.error("[pulse] tick error:", e));
  }, PULSE_TICK_MS);

  // BioLoop: update generation weights daily (first run after 1h to let data accumulate)
  biloopTimer = setInterval(() => {
    void biloopTick();
  }, BIOLOOP_TICK_MS);

  // 3A-7: Reddit engagement poll every 2 hours (first run after startup)
  void pollRedditEngagement().catch((e) => console.error("[reddit-engage] initial poll error:", e));
  redditEngageTimer = setInterval(() => {
    void pollRedditEngagement().catch((e) => console.error("[reddit-engage] poll error:", e));
  }, REDDIT_ENGAGE_TICK_MS);

  console.log("[cadence] engine started — tick 60s | auto-gen 5m | pulse 30m | reddit-engage 2h | bioloop 24h");
}

export function stopCadenceEngine(): void {
  if (cadenceTimer)      { clearInterval(cadenceTimer);      cadenceTimer      = null; }
  if (autoGenTimer)      { clearInterval(autoGenTimer);      autoGenTimer      = null; }
  if (pulseTimer)        { clearInterval(pulseTimer);        pulseTimer        = null; }
  if (biloopTimer)       { clearInterval(biloopTimer);       biloopTimer       = null; }
  if (redditEngageTimer) { clearInterval(redditEngageTimer); redditEngageTimer = null; }
}
