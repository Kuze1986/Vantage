import { getSupabaseAdmin } from "../lib/supabase.js";
import { renderForAudit } from "../lib/audit-content.js";
import { logActivity } from "../lib/activity.js";
import { generateContent } from "./kuze.js";
import { auditContent } from "./ilita.js";
import { pickNextTopic } from "./source.js";
import { refreshTopicsFromPulse } from "./pulse.js";
import { pollRedditEngagement } from "./reddit-engagement.js";
import { pollBlueskyEngagement } from "./bluesky-engagement.js";
import { pollThreadsEngagement } from "./threads-engagement.js";
import { collectCompetitivePosts } from "./competitive-collector.js";
import { assignSegmentMembers } from "./segment-assignment.js";
import { generateInsightsForWorkspace } from "./insights-generator.js";
import { learnAndStorePreferences } from "./segment-preferences-learner.js";
import { loadSettings } from "../lib/settings.js";
import { listAllWorkspaceIds } from "../lib/workspace.js";
import { sendAlert } from "../lib/alert.js";
import { RateLimitError } from "../lib/rate-limit-error.js";
import { recordGrowthEvent } from "../lib/growth.js";
import { isMediaGated, mediaGateReason, withForceMedia } from "../lib/media-gate.js";
import { MANUAL_PUBLISH_CHANNELS } from "../lib/publish-pack.js";
import { resolveCampaignIdForPiece } from "../lib/campaign-kpi.js";
import { channelFormatMap } from "@vantage/prompts";
import type { ChannelSlug } from "@vantage/prompts";

// Adapter imports — each channel routes to its own adapter
import { postTweet } from "../adapters/x.js";
import { postLinkedIn } from "../adapters/linkedin.js";
import { postThread } from "../adapters/threads.js";
import { postBluesky } from "../adapters/bluesky.js";
import { sendEmail } from "../adapters/email.js";
import { postTikTokVideo } from "../adapters/tiktok.js";
import { postInstagramMedia, postInstagramCarousel } from "../adapters/instagram.js";
import { postFacebook, postFacebookPhotos } from "../adapters/facebook.js";
import { carouselUrlsForChannel } from "../lib/carousel.js";
import { pickPostingHour } from "../lib/posting-hours.js";

const TICK_MS               = 60_000;            // check queue every 60 seconds
const AUTO_GEN_TICK         = 300_000;           // check auto-generate every 5 minutes
const PULSE_TICK_MS         = 30 * 60_000;       // pulse reactor every 30 minutes
const REDDIT_ENGAGE_TICK_MS  = 2 * 60 * 60_000;  // Reddit engagement poll every 2 hours
// Bluesky's getPosts is unauthenticated and batched (25 posts/call), so it's cheap enough to
// poll tighter than Reddit's own interval — no OAuth token budget is consumed at all.
const BLUESKY_ENGAGE_TICK_MS = 1 * 60 * 60_000;  // Bluesky engagement poll every 1 hour
// Threads Insights has no bulk endpoint — cost scales linearly with published-post count per
// tick, and it's the poller most likely to need reconnect (see threads-engagement.ts), so it
// gets the most conservative interval of the three.
const THREADS_ENGAGE_TICK_MS = 3 * 60 * 60_000;  // Threads engagement poll every 3 hours
// Lower urgency than engagement polling (competitive_posts is decision-support, not a
// publish-blocking loop) and each new post costs an LLM analysis call, so this runs
// infrequently — enough to keep the table from sitting empty, not enough to run up cost.
const COMPETITIVE_COLLECT_TICK_MS = 4 * 60 * 60_000; // Competitive post collection every 4 hours
// Decision-support, not publish-blocking — runs infrequently to keep segment_members from
// sitting permanently empty without adding meaningful load.
const SEGMENT_ASSIGN_TICK_MS = 6 * 60 * 60_000; // Segment assignment every 6 hours
// One substantial LLM call per active campaign per run — daily is plenty for strategic
// insights, which don't need to react faster than a campaign's own daily KPI rollup does.
const INSIGHTS_GENERATE_TICK_MS = 24 * 60 * 60_000; // Insights generation every 24 hours
// Runs less often than segment-assign (6h) — preference learning is an LLM call per
// qualifying segment and depends on segment_members having had time to populate first.
const SEGMENT_PREFS_LEARN_TICK_MS = 12 * 60 * 60_000; // Segment preference learning every 12 hours

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
  media_status?: string | null;
  image_url?: string | null;
  video_url?: string | null;
};

// 3A-6: Exponential backoff delays — [0]=5m, [1]=15m, [2]=1h, then give up
const RETRY_DELAYS_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000];

// 2c: a piece left in 'publishing' longer than this is assumed orphaned by a
// crashed/restarted worker and re-queued by the reaper.
const PUBLISH_LOCK_STALE_MS = 10 * 60_000;

// ── Manual schedule: mark a piece queued with optional time ──────────────────
export async function scheduleContentPiece(
  workspaceId: string,
  contentPieceId: string,
  scheduledForIso?: string,
  opts?: { force?: boolean },
): Promise<void> {
  const sb = getSupabaseAdmin();
  const scheduledFor = scheduledForIso ?? new Date().toISOString();
  const force = opts?.force === true;

  const { data: piece, error: loadErr } = await sb
    .from("content_pieces")
    .select("id, status, media_status, image_url, video_url, content_payload")
    .eq("workspace_id", workspaceId)
    .eq("id", contentPieceId)
    .single();
  if (loadErr || !piece) throw new Error("Content piece not found");
  if (piece.status !== "approved") throw new Error(`Can only schedule approved pieces, got ${piece.status}`);

  const payload = withForceMedia(
    piece.content_payload as Record<string, unknown> | null,
    force,
  );
  const gatedPiece = {
    media_status: piece.media_status,
    image_url: piece.image_url,
    video_url: piece.video_url,
    content_payload: payload,
  };
  if (!force && isMediaGated(gatedPiece)) {
    throw new Error(mediaGateReason(gatedPiece));
  }

  const { error } = await sb.from("content_pieces").update({
    status: "queued",
    scheduled_for: scheduledFor,
    content_payload: payload,
    updated_at: new Date().toISOString(),
  }).eq("workspace_id", workspaceId).eq("id", contentPieceId);
  if (error) throw new Error(error.message);

  await logActivity({
    source: "scheduler", source_type: "system",
    event_type: "scheduled",
    summary: `Content piece ${contentPieceId} queued for ${scheduledFor}${force ? " (force)" : ""}`,
    payload: { content_piece_id: contentPieceId, scheduled_for: scheduledFor, force },
    workspace_id: workspaceId,
  });
}

// ── Publish one piece via its channel adapter ─────────────────────────────────
// Exported for unit tests (the publish state machine); not part of the public API.
export async function publishPiece(workspaceId: string, piece: ContentPieceRow, channelRow: ChannelRow): Promise<void> {
  const sb = getSupabaseAdmin();
  const slug = piece.channel_slug as ChannelSlug;
  const payload = piece.content_payload;
  let externalId: string;

  try {
    switch (slug) {
      case "x": {
        const body = String(payload.body ?? "");
        const { id } = await postTweet(workspaceId, body);
        externalId = id;
        break;
      }
      case "linkedin": {
        const body     = String(payload.body ?? "");
        const headline = payload.headline ? String(payload.headline) : undefined;
        // 3A-3: pass image_url for LinkedIn image card
        const imageUrl = typeof payload.image_url === "string" ? payload.image_url : undefined;
        const { id }   = await postLinkedIn(workspaceId, body, headline, imageUrl);
        externalId = id;
        break;
      }
      // No "reddit" case: it's in MANUAL_PUBLISH_CHANNELS and the tick skips it
      // before ever getting here. If one somehow reaches this switch, the default
      // below fails it loudly rather than silently posting nothing.
      case "threads": {
        const { id } = await postThread(workspaceId, String(payload.body ?? ""));
        externalId = id;
        break;
      }
      case "bluesky": {
        const { id } = await postBluesky(workspaceId, String(payload.body ?? ""));
        externalId = id;
        break;
      }
      case "tiktok": {
        const videoUrl = typeof payload.video_url === "string" ? payload.video_url : piece.video_url;
        if (!videoUrl) throw new Error("TikTok post requires a video");
        const title = String(payload.hook ?? payload.body ?? "").slice(0, 150);
        const { id } = await postTikTokVideo(workspaceId, { videoUrl, title });
        externalId = id;
        break;
      }
      case "instagram": {
        const videoUrl = typeof payload.video_url === "string" ? payload.video_url : piece.video_url;
        const imageUrl = typeof payload.image_url === "string" ? payload.image_url : piece.image_url;
        const hashtags = Array.isArray(payload.hashtags)
          ? payload.hashtags.map((h) => `#${h}`).join(" ")
          : "";
        const caption = [String(payload.body ?? ""), hashtags].filter(Boolean).join("\n\n");
        // A saved carousel posts as a real multi-image carousel rather than
        // just its first slide. Video still wins — that publishes as a Reel.
        const slides = carouselUrlsForChannel(slug, payload, videoUrl);
        if (slides.length) {
          const { id } = await postInstagramCarousel(workspaceId, { imageUrls: slides, caption });
          externalId = id;
          break;
        }
        const mediaUrl = videoUrl || imageUrl;
        if (!mediaUrl) throw new Error("Instagram post requires an image or video");
        const { id } = await postInstagramMedia(workspaceId, {
          mediaUrl,
          mediaType: videoUrl ? "VIDEO" : "IMAGE",
          caption,
        });
        externalId = id;
        break;
      }
      case "facebook": {
        const imageUrl = typeof payload.image_url === "string" ? payload.image_url : piece.image_url;
        const message  = String(payload.body ?? "");
        const slides   = carouselUrlsForChannel(slug, payload, piece.video_url);
        if (slides.length) {
          const { id } = await postFacebookPhotos(workspaceId, { message, imageUrls: slides });
          externalId = id;
          break;
        }
        const { id } = await postFacebook(workspaceId, {
          message,
          imageUrl: imageUrl || undefined,
        });
        externalId = id;
        break;
      }
      case "email": {
        // 3A-2: pass pieceId for UTM tagging
        const { id } = await sendEmail(workspaceId, {
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
      status: "published", published_at: now, external_post_id: externalId,
      locked_at: null, updated_at: now,
    }).eq("workspace_id", workspaceId).eq("id", piece.id);

    await logActivity({
      source: `adapter:${slug}`, source_type: "adapter",
      event_type: "cadence_published",
      summary: `Cadence published ${slug} piece ${piece.id} → ${externalId}`,
      payload: { content_piece_id: piece.id, external_post_id: externalId, channel: slug },
      workspace_id: workspaceId,
    });

    const campaignId = await resolveCampaignIdForPiece(piece.id).catch(() => null);
    await recordGrowthEvent({
      loop: "acquisition",
      kind: "impression",
      channel: slug,
      meta: {
        content_piece_id: piece.id,
        external_post_id: externalId,
        workspace_id: workspaceId,
        cadence: true,
        ...(campaignId ? { campaign_id: campaignId } : {}),
      },
    });
  } catch (e) {
    const msg        = e instanceof Error ? e.message : String(e);
    const now        = new Date();

    // 3B-4: Rate-limit errors reschedule without burning a retry slot
    if (e instanceof RateLimitError) {
      const retryAfter = e.retryAfter.toISOString();
      await sb.from("content_pieces").update({
        status:      "queued", // release the claim so the retry window can re-pick it
        locked_at:   null,
        retry_after: retryAfter,
        audit_notes: `Rate limited: ${msg.slice(0, 400)}`,
        updated_at:  now.toISOString(),
      }).eq("workspace_id", workspaceId).eq("id", piece.id);
      await logActivity({
        source: `adapter:${slug}`, source_type: "adapter",
        event_type: "rate_limit_rescheduled",
        summary: `Rate limited — rescheduled ${slug} piece ${piece.id} for ${retryAfter}`,
        payload: { content_piece_id: piece.id, channel: slug, retry_after: retryAfter },
        workspace_id: workspaceId,
      });
      throw e;
    }

    const retryCount   = piece.retry_count ?? 0;
    const delayMs      = RETRY_DELAYS_MS[retryCount];
    const willRetry    = delayMs !== undefined;

    if (willRetry) {
      // 3A-6: Schedule a retry with exponential backoff — keep status "queued"
      const retryAfter = new Date(now.getTime() + delayMs).toISOString();
      await sb.from("content_pieces").update({
        status:      "queued", // release the claim — keep it queued for the backoff retry
        locked_at:   null,
        retry_count: retryCount + 1,
        retry_after: retryAfter,
        audit_notes: `Retry ${retryCount + 1}: ${msg.slice(0, 400)}`,
        updated_at:  now.toISOString(),
      }).eq("workspace_id", workspaceId).eq("id", piece.id);
      await logActivity({
        source: `adapter:${slug}`, source_type: "adapter",
        event_type: "cadence_publish_retry",
        summary: `Retry ${retryCount + 1}/3 for ${slug} piece ${piece.id} — next at ${retryAfter}`,
        payload: { content_piece_id: piece.id, channel: slug, retry_count: retryCount + 1, retry_after: retryAfter },
        workspace_id: workspaceId,
      });
    } else {
      // Max retries exhausted — mark as failed permanently
      await sb.from("content_pieces").update({
        status:      "failed",
        locked_at:   null,
        audit_notes: `Failed after ${retryCount} retries: ${msg.slice(0, 400)}`,
        updated_at:  now.toISOString(),
      }).eq("workspace_id", workspaceId).eq("id", piece.id);
      await logActivity({
        source: `adapter:${slug}`, source_type: "adapter",
        event_type: "cadence_publish_failed",
        summary: `Permanently failed after ${retryCount} retries: ${msg.slice(0, 400)}`,
        payload: { content_piece_id: piece.id, channel: slug, retry_count: retryCount },
        workspace_id: workspaceId,
      });
      // 3B-1: Alert on permanent failure
      void sendAlert(
        `Publish failed: ${slug}`,
        `Piece ${piece.id} permanently failed after ${retryCount} retries.\n\nError: ${msg}`,
        `publish_fail_${slug}`,
      );
    }
    throw e;
  }
}

// ── Cadence tick: publish all pieces due now, per workspace ───────────────────
async function cadenceTick(): Promise<void> {
  for (const ws of await listAllWorkspaceIds()) {
    try {
      await cadenceTickForWorkspace(ws);
    } catch (e) {
      console.error(`[cadence] workspace ${ws} tick error:`, e instanceof Error ? e.message : e);
    }
  }
}

// Exported for unit tests (the claim-lock gating); not part of the public API.
export async function cadenceTickForWorkspace(workspaceId: string): Promise<void> {
  const sb  = getSupabaseAdmin();
  const now = new Date().toISOString();

  // 2c: Reap orphaned locks — pieces a crashed worker left mid-publish. Re-queue
  // them so they get retried instead of being stuck in 'publishing' forever.
  const staleBefore = new Date(Date.now() - PUBLISH_LOCK_STALE_MS).toISOString();
  await sb.from("content_pieces")
    .update({ status: "queued", locked_at: null, updated_at: now })
    .eq("workspace_id", workspaceId)
    .eq("status", "publishing")
    .lt("locked_at", staleBefore);

  // 3A-6: also check retry_after — only pick up pieces whose retry window has elapsed
  const { data: pieces, error } = await sb
    .from("content_pieces")
    .select("id, channel_slug, format, content_payload, retry_count, media_status, image_url, video_url")
    .eq("workspace_id", workspaceId)
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
  const { data: channels } = await sb.from("channels").select("slug, enabled, cadence_config")
    .eq("workspace_id", workspaceId).eq("enabled", true);
  const channelMap = Object.fromEntries((channels ?? []).map((c: ChannelRow) => [c.slug, c]));

  for (const piece of pieces as ContentPieceRow[]) {
    const channelRow = channelMap[piece.channel_slug] as ChannelRow | undefined;
    if (!channelRow) continue;

    if (isMediaGated(piece)) {
      await logActivity({
        source: "scheduler",
        source_type: "system",
        event_type: "media_gated_skip",
        summary: `Cadence skipped ${piece.id}: ${mediaGateReason(piece)}`,
        payload: {
          content_piece_id: piece.id,
          media_status: piece.media_status,
          reason: mediaGateReason(piece),
        },
        workspace_id: workspaceId,
      }).catch(() => {});
      continue;
    }

    // Manual channels (Reddit) can't be posted by a server at all, so skip them
    // BEFORE the claim below. Claiming would flip the piece to 'publishing',
    // publishPiece() would throw, and it would land in 'failed' — burying a
    // piece that is perfectly fine and just waiting on a human. Left untouched
    // in 'queued', it keeps showing its Publish Pack on the Queue page.
    if (MANUAL_PUBLISH_CHANNELS.has(piece.channel_slug)) continue;

    // 2c: Atomic claim — flip queued→publishing only if still queued. The WHERE
    // status='queued' makes this a compare-and-swap: a concurrent tick (or a
    // second instance) that already claimed this row updates zero rows here and
    // is skipped, so a piece can never be published twice.
    const { data: claimed } = await sb.from("content_pieces")
      .update({ status: "publishing", locked_at: now, updated_at: now })
      .eq("workspace_id", workspaceId)
      .eq("id", piece.id)
      .eq("status", "queued")
      .select("id");
    if (!claimed?.length) continue;

    try {
      await publishPiece(workspaceId, piece, channelRow);
    } catch {
      // Error already logged inside publishPiece
    }
  }
}

// ── Auto-generate tick: fill quota for enabled auto-approve channels ──────────
async function autoGenerateTick(): Promise<void> {
  for (const ws of await listAllWorkspaceIds()) {
    try {
      await autoGenerateTickForWorkspace(ws);
    } catch (e) {
      console.error(`[auto-gen] workspace ${ws} tick error:`, e instanceof Error ? e.message : e);
    }
  }
}

// Exported for unit tests (the audit-gating path); not part of the public API.
export async function autoGenerateTickForWorkspace(workspaceId: string): Promise<void> {
  const sb  = getSupabaseAdmin();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const { data: channels } = await sb
    .from("channels")
    .select("slug, enabled, cadence_config")
    .eq("workspace_id", workspaceId)
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
      .eq("workspace_id", workspaceId)
      .eq("channel_slug", ch.slug)
      .eq("status", "published")
      .gte("published_at", todayStart);

    const publishedToday = count ?? 0;
    const deficit        = postsPerDay - publishedToday;
    if (deficit <= 0) continue;

    // Load brand voice
    const { data: voices } = await sb.from("brand_voice").select("*").eq("workspace_id", workspaceId).limit(1);
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
      const topic = await pickNextTopic(workspaceId);
      if (!topic) break;

      try {
        // Generate
        const gen = await generateContent({
          workspace_id: workspaceId,
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
            workspace_id:    workspaceId,
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
        await sb.from("content_pieces").update({ content_payload: taggedPayload })
          .eq("workspace_id", workspaceId).eq("id", inserted.id);

        // Mark topic used
        await sb.from("topics").update({ used_at: new Date().toISOString() })
          .eq("workspace_id", workspaceId).eq("id", topic.id);

        await logActivity({
          source: "kuze", source_type: "agent",
          event_type: "auto_generated",
          summary: `Auto-generated ${format} for ${ch.slug}`,
          payload: { content_piece_id: inserted.id, topic_id: topic.id, channel: ch.slug },
          workspace_id: workspaceId,
        });

        // Audit it
        const auditResult = await auditContent({
          // Full payload — see lib/audit-content.ts. text_preview is a 200-char
          // slice of one field and is for display only.
          content:      renderForAudit(gen.content_payload),
          format,
          brand_voice:  brandVoiceStr,
          workspace_id: workspaceId,
        });

        if (auditResult.verdict === "pass") {
          // Auto-approve and queue it
          const hour = pickPostingHour(ch.cadence_config, i);
          const scheduledFor = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0)).toISOString();

          await sb.from("content_pieces").update({
            status: "queued",
            audit_notes: auditResult.feedback || null,
            scheduled_for: scheduledFor,
            updated_at: new Date().toISOString(),
          }).eq("workspace_id", workspaceId).eq("id", inserted.id);

          await logActivity({
            source: "ilita", source_type: "agent",
            event_type: "auto_approved_queued",
            summary: `Auto-approved + queued ${ch.slug} piece for ${scheduledFor}`,
            payload: { content_piece_id: inserted.id, scheduled_for: scheduledFor },
            workspace_id: workspaceId,
          });
        } else {
          // Regen once with feedback
          const regenTopic = `${topic.topic_text}\n\nIlita feedback (must address): ${auditResult.feedback}`;
          const gen2 = await generateContent({
            workspace_id: workspaceId,
            channel: ch.slug as ChannelSlug,
            topic_text: regenTopic,
            vertical: topic.vertical,
            brand_voice: brandVoiceStr,
          });
          const audit2 = await auditContent({ content: renderForAudit(gen2.content_payload), format: gen2.format, brand_voice: brandVoiceStr, workspace_id: workspaceId });
          const finalStatus = audit2.verdict === "pass" ? "approved" : "rejected";
          await sb.from("content_pieces").update({
            status: finalStatus,
            content_payload: gen2.content_payload,
            audit_notes: audit2.feedback,
            audit_category: audit2.verdict === "fail" ? audit2.category : null,
            audit_iterations: 1,
            updated_at: new Date().toISOString(),
          }).eq("workspace_id", workspaceId).eq("id", inserted.id);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await logActivity({
          source: "scheduler", source_type: "system",
          event_type: "auto_generate_error",
          summary: msg.slice(0, 300),
          payload: { channel: ch.slug, topic_id: topic.id },
          workspace_id: workspaceId,
        });
      }
    }
  }
}

// ── Pulse tick: ingest external signals every 30 min, per workspace ──────────
async function pulseTick(): Promise<void> {
  const sb = getSupabaseAdmin();
  for (const ws of await listAllWorkspaceIds()) {
    const { data: ch } = await sb
      .from("channels")
      .select("cadence_config")
      .eq("workspace_id", ws)
      .eq("slug", "reddit")
      .maybeSingle();
    const subreddits: string[] =
      (ch?.cadence_config as { subreddits?: string[] } | null)?.subreddits ?? [];

    try {
      const { inserted, scanned } = await refreshTopicsFromPulse(ws, subreddits);
      if (inserted > 0) {
        console.log(`[pulse] ws ${ws}: ${inserted} new signals inserted from ${scanned} scanned`);
      }
    } catch (e) {
      console.error(`[pulse] ws ${ws} tick error:`, e instanceof Error ? e.message : e);
    }
  }
}

// ── Reddit engagement poll: per workspace ────────────────────────────────────
async function redditEngageTick(): Promise<void> {
  for (const ws of await listAllWorkspaceIds()) {
    try {
      await pollRedditEngagement(ws);
    } catch (e) {
      console.error(`[reddit-engage] ws ${ws} poll error:`, e instanceof Error ? e.message : e);
    }
  }
}

// ── Bluesky/Threads engagement polls: per workspace ──────────────────────────
async function blueskyEngageTick(): Promise<void> {
  for (const ws of await listAllWorkspaceIds()) {
    try {
      await pollBlueskyEngagement(ws);
    } catch (e) {
      console.error(`[bluesky-engage] ws ${ws} poll error:`, e instanceof Error ? e.message : e);
    }
  }
}

async function threadsEngageTick(): Promise<void> {
  for (const ws of await listAllWorkspaceIds()) {
    try {
      await pollThreadsEngagement(ws);
    } catch (e) {
      console.error(`[threads-engage] ws ${ws} poll error:`, e instanceof Error ? e.message : e);
    }
  }
}

// ── Competitive post collection: per workspace ────────────────────────────────
async function competitiveCollectTick(): Promise<void> {
  for (const ws of await listAllWorkspaceIds()) {
    try {
      await collectCompetitivePosts(ws);
    } catch (e) {
      console.error(`[competitive-collect] ws ${ws} collect error:`, e instanceof Error ? e.message : e);
    }
  }
}

// ── Segment assignment: per workspace ─────────────────────────────────────────
async function segmentAssignTick(): Promise<void> {
  for (const ws of await listAllWorkspaceIds()) {
    try {
      await assignSegmentMembers(ws);
    } catch (e) {
      console.error(`[segment-assign] ws ${ws} assignment error:`, e instanceof Error ? e.message : e);
    }
  }
}

// ── Insights generation: per workspace ────────────────────────────────────────
async function insightsGenerateTick(): Promise<void> {
  for (const ws of await listAllWorkspaceIds()) {
    try {
      await generateInsightsForWorkspace(ws);
    } catch (e) {
      console.error(`[insights-generate] ws ${ws} generation error:`, e instanceof Error ? e.message : e);
    }
  }
}

// ── Segment preference learning: per workspace ────────────────────────────────
async function segmentPrefsLearnTick(): Promise<void> {
  for (const ws of await listAllWorkspaceIds()) {
    try {
      await learnAndStorePreferences(ws);
    } catch (e) {
      console.error(`[segment-prefs] ws ${ws} learn error:`, e instanceof Error ? e.message : e);
    }
  }
}

// ── Engine boot ───────────────────────────────────────────────────────────────
let cadenceTimer:            ReturnType<typeof setInterval> | null = null;
let autoGenTimer:            ReturnType<typeof setInterval> | null = null;
let pulseTimer:               ReturnType<typeof setInterval> | null = null;
let redditEngageTimer:        ReturnType<typeof setInterval> | null = null;
let blueskyEngageTimer:       ReturnType<typeof setInterval> | null = null;
let threadsEngageTimer:       ReturnType<typeof setInterval> | null = null;
let competitiveCollectTimer:  ReturnType<typeof setInterval> | null = null;
let segmentAssignTimer:       ReturnType<typeof setInterval> | null = null;
let insightsGenerateTimer:    ReturnType<typeof setInterval> | null = null;
let segmentPrefsLearnTimer:   ReturnType<typeof setInterval> | null = null;

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

  // Note: BioLoop runs as a Supabase Edge Function on a daily pg_cron schedule.
  // See supabase/functions/bioloop/index.ts and the 20260607000000 migration.

  // 3A-7: Reddit engagement poll every 2 hours (first run after startup)
  void redditEngageTick().catch((e) => console.error("[reddit-engage] initial poll error:", e));
  redditEngageTimer = setInterval(() => {
    void redditEngageTick().catch((e) => console.error("[reddit-engage] poll error:", e));
  }, REDDIT_ENGAGE_TICK_MS);

  // Bluesky engagement poll every 1 hour (first run after startup)
  void blueskyEngageTick().catch((e) => console.error("[bluesky-engage] initial poll error:", e));
  blueskyEngageTimer = setInterval(() => {
    void blueskyEngageTick().catch((e) => console.error("[bluesky-engage] poll error:", e));
  }, BLUESKY_ENGAGE_TICK_MS);

  // Threads engagement poll every 3 hours (first run after startup)
  void threadsEngageTick().catch((e) => console.error("[threads-engage] initial poll error:", e));
  threadsEngageTimer = setInterval(() => {
    void threadsEngageTick().catch((e) => console.error("[threads-engage] poll error:", e));
  }, THREADS_ENGAGE_TICK_MS);

  // Competitive post collection every 4 hours (first run after startup)
  void competitiveCollectTick().catch((e) => console.error("[competitive-collect] initial collect error:", e));
  competitiveCollectTimer = setInterval(() => {
    void competitiveCollectTick().catch((e) => console.error("[competitive-collect] collect error:", e));
  }, COMPETITIVE_COLLECT_TICK_MS);

  // Segment assignment every 6 hours (first run after startup)
  void segmentAssignTick().catch((e) => console.error("[segment-assign] initial assignment error:", e));
  segmentAssignTimer = setInterval(() => {
    void segmentAssignTick().catch((e) => console.error("[segment-assign] assignment error:", e));
  }, SEGMENT_ASSIGN_TICK_MS);

  // Insights generation every 24 hours (first run after startup)
  void insightsGenerateTick().catch((e) => console.error("[insights-generate] initial generation error:", e));
  insightsGenerateTimer = setInterval(() => {
    void insightsGenerateTick().catch((e) => console.error("[insights-generate] generation error:", e));
  }, INSIGHTS_GENERATE_TICK_MS);

  // Segment preference learning every 12 hours (first run after startup)
  void segmentPrefsLearnTick().catch((e) => console.error("[segment-prefs] initial learn error:", e));
  segmentPrefsLearnTimer = setInterval(() => {
    void segmentPrefsLearnTick().catch((e) => console.error("[segment-prefs] learn error:", e));
  }, SEGMENT_PREFS_LEARN_TICK_MS);

  console.log("[cadence] engine started — tick 60s | auto-gen 5m | pulse 30m | reddit-engage 2h | bluesky-engage 1h | threads-engage 3h | competitive-collect 4h | segment-assign 6h | insights-generate 24h | segment-prefs-learn 12h | bioloop via edge function");
}

export function stopCadenceEngine(): void {
  if (cadenceTimer)            { clearInterval(cadenceTimer);            cadenceTimer            = null; }
  if (autoGenTimer)            { clearInterval(autoGenTimer);            autoGenTimer            = null; }
  if (pulseTimer)              { clearInterval(pulseTimer);              pulseTimer              = null; }
  if (redditEngageTimer)       { clearInterval(redditEngageTimer);       redditEngageTimer       = null; }
  if (blueskyEngageTimer)      { clearInterval(blueskyEngageTimer);      blueskyEngageTimer      = null; }
  if (threadsEngageTimer)      { clearInterval(threadsEngageTimer);      threadsEngageTimer      = null; }
  if (competitiveCollectTimer) { clearInterval(competitiveCollectTimer); competitiveCollectTimer = null; }
  if (segmentAssignTimer)      { clearInterval(segmentAssignTimer);      segmentAssignTimer      = null; }
  if (insightsGenerateTimer)   { clearInterval(insightsGenerateTimer);   insightsGenerateTimer   = null; }
  if (segmentPrefsLearnTimer)  { clearInterval(segmentPrefsLearnTimer);  segmentPrefsLearnTimer  = null; }
}
