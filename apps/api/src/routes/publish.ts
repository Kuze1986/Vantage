import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { recordGrowthEvent } from "../lib/growth.js";
import { assertMediaReady, withForceMedia } from "../lib/media-gate.js";
import { resolveCampaignIdForPiece } from "../lib/campaign-kpi.js";

// Adapters
import { postTweet } from "../adapters/x.js";
import { postLinkedIn } from "../adapters/linkedin.js";
import { postToSubreddit } from "../adapters/reddit.js";
import { postThread } from "../adapters/threads.js";
import { postBluesky } from "../adapters/bluesky.js";
import { sendEmail } from "../adapters/email.js";
import { postTikTokVideo } from "../adapters/tiktok.js";
import { postInstagramMedia } from "../adapters/instagram.js";
import { postFacebook } from "../adapters/facebook.js";

const bodySchema = z.object({
  content_piece_id: z.string().uuid(),
  // Manual-post channels supply the external URL after the human posts it
  external_post_url: z.string().url().optional(),
  force: z.boolean().optional(),
});

export const publishRoutes = new Hono();

publishRoutes.post("/:channel", async (c) => {
  const channel = c.req.param("channel");
  const json    = await c.req.json().catch(() => ({}));
  const parsed  = bodySchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  // external_post_url stays in the schema for API-compat but is no longer read —
  // no channel dispatches through the manual record-a-URL path anymore.
  const { content_piece_id, force } = parsed.data;
  const ws = c.get("workspaceId");
  const sb = getSupabaseAdmin();

  const { data: piece, error } = await sb
    .from("content_pieces")
    .select("id, channel_slug, format, content_payload, status, media_status, image_url, video_url")
    .eq("workspace_id", ws)
    .eq("id", content_piece_id).single();
  if (error || !piece) throw new HTTPException(404, { message: "Not found" });
  if (piece.status !== "approved" && piece.status !== "queued") {
    throw new HTTPException(400, { message: `Cannot publish from status ${piece.status}` });
  }

  let payload = withForceMedia(
    piece.content_payload as Record<string, unknown> | null,
    force === true,
  );
  try {
    assertMediaReady(
      {
        media_status: piece.media_status,
        image_url: piece.image_url,
        video_url: piece.video_url,
        content_payload: payload,
      },
      { force },
    );
  } catch (e) {
    throw new HTTPException(400, { message: e instanceof Error ? e.message : String(e) });
  }

  if (force === true) {
    await sb
      .from("content_pieces")
      .update({ content_payload: payload, updated_at: new Date().toISOString() })
      .eq("workspace_id", ws)
      .eq("id", content_piece_id);
  }

  // 2c: if the piece is queued, claim it atomically so this manual publish can't
  // race the cadence engine and double-publish. Approved pieces aren't picked up
  // by the engine, so no claim is needed there.
  if (piece.status === "queued") {
    const { data: claimed } = await sb.from("content_pieces")
      .update({ status: "publishing", locked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("workspace_id", ws).eq("id", content_piece_id).eq("status", "queued")
      .select("id");
    if (!claimed?.length) {
      throw new HTTPException(409, { message: "Piece is already being published by the cadence engine" });
    }
  }

  const slug = piece.channel_slug as string;
  const campaignId = await resolveCampaignIdForPiece(content_piece_id).catch(() => null);

  // Automated channels — no manual-post channels dispatch through this route
  // anymore now that tiktok/instagram/facebook all post for real. A workspace
  // that hasn't connected a channel yet still gets a clear "not connected"
  // error from the adapter itself, same as any other unconnected OAuth channel.
  let externalId: string;
  try {
    switch (slug) {
      case "x": {
        const body = String(payload.body ?? "");
        if (!body) throw new Error("Missing tweet body");
        ({ id: externalId } = await postTweet(ws, body));
        break;
      }
      case "linkedin": {
        const body     = String(payload.body ?? "");
        const headline = payload.headline ? String(payload.headline) : undefined;
        // 3A-3: pass image_url so LinkedIn can include an image card
        const imageUrl = typeof payload.image_url === "string" ? payload.image_url : undefined;
        ({ id: externalId } = await postLinkedIn(ws, body, headline, imageUrl));
        break;
      }
      case "reddit": {
        // Load subreddit from channel cadence_config, using round-robin index (3A-4)
        const { data: ch } = await sb.from("channels")
          .select("cadence_config").eq("workspace_id", ws).eq("slug", "reddit").single();
        const cadence = (ch?.cadence_config ?? {}) as { subreddits?: string[]; subreddit_index?: number };
        const subs: string[] = cadence.subreddits ?? [];
        if (!subs.length) throw new Error("No subreddits configured for Reddit channel");
        const idx        = (cadence.subreddit_index ?? 0) % subs.length;
        const subreddit  = subs[idx];
        const nextIndex  = (idx + 1) % subs.length;
        // Persist the updated index back to cadence_config
        await sb.from("channels").update({
          cadence_config: { ...cadence, subreddit_index: nextIndex },
        }).eq("workspace_id", ws).eq("slug", "reddit");
        ({ id: externalId } = await postToSubreddit(ws, {
          subreddit,
          title:        String(payload.title ?? payload.body ?? "").slice(0, 300),
          body:         String(payload.body ?? ""),
          is_link_post: payload.is_link_post === true,
        }));
        break;
      }
      case "threads": {
        const body = String(payload.body ?? "");
        if (!body) throw new Error("Missing Threads post body");
        ({ id: externalId } = await postThread(ws, body));
        break;
      }
      case "bluesky": {
        const body = String(payload.body ?? "");
        if (!body) throw new Error("Missing Bluesky post body");
        ({ id: externalId } = await postBluesky(ws, body));
        break;
      }
      case "tiktok": {
        const videoUrl = typeof payload.video_url === "string" ? payload.video_url : piece.video_url;
        if (!videoUrl) throw new Error("TikTok post requires a video");
        const title = String(payload.hook ?? payload.body ?? "").slice(0, 150);
        ({ id: externalId } = await postTikTokVideo(ws, { videoUrl, title }));
        break;
      }
      case "instagram": {
        const videoUrl = typeof payload.video_url === "string" ? payload.video_url : piece.video_url;
        const imageUrl = typeof payload.image_url === "string" ? payload.image_url : piece.image_url;
        const mediaUrl = videoUrl || imageUrl;
        if (!mediaUrl) throw new Error("Instagram post requires an image or video");
        const hashtags = Array.isArray(payload.hashtags)
          ? payload.hashtags.map((h) => `#${h}`).join(" ")
          : "";
        const caption = [String(payload.body ?? ""), hashtags].filter(Boolean).join("\n\n");
        ({ id: externalId } = await postInstagramMedia(ws, {
          mediaUrl,
          mediaType: videoUrl ? "VIDEO" : "IMAGE",
          caption,
        }));
        break;
      }
      case "facebook": {
        const imageUrl = typeof payload.image_url === "string" ? payload.image_url : piece.image_url;
        ({ id: externalId } = await postFacebook(ws, {
          message: String(payload.body ?? ""),
          imageUrl: imageUrl || undefined,
        }));
        break;
      }
      case "email": {
        // 3A-2: pass pieceId so UTM tags are applied to links in the HTML body
        ({ id: externalId } = await sendEmail(ws, {
          subject: String(payload.subject ?? "NEXUS Newsletter"),
          html:    String(payload.body ?? ""),
          pieceId: content_piece_id,
        }));
        break;
      }
      default:
        throw new HTTPException(400, { message: `Unknown channel: ${slug}` });
    }

    const now = new Date().toISOString();
    await sb.from("content_pieces").update({
      status:           "published",
      published_at:     now,
      external_post_id: externalId,
      locked_at:        null,
      updated_at:       now,
    }).eq("workspace_id", ws).eq("id", content_piece_id);

    await logActivity({
      source: `adapter:${slug}`, source_type: "adapter",
      event_type: "published",
      summary: `Published ${slug} piece → ${externalId}`,
      payload: { content_piece_id, external_post_id: externalId, channel: slug },
      workspace_id: ws,
    });
    // Growth OS — Loop A: a published piece is an acquisition impression.
    await recordGrowthEvent({
      loop: "acquisition", kind: "impression", channel: slug,
      meta: {
        content_piece_id, external_post_id: externalId, workspace_id: ws,
        ...(campaignId ? { campaign_id: campaignId } : {}),
      },
    });

    return c.json({ ok: true, external_post_id: externalId });
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("content_pieces").update({
      status: "failed", locked_at: null, audit_notes: msg, updated_at: new Date().toISOString(),
    }).eq("workspace_id", ws).eq("id", content_piece_id);
    await logActivity({
      source: `adapter:${slug}`, source_type: "adapter",
      event_type: "publish_failed",
      summary: msg.slice(0, 500),
      payload: { content_piece_id, channel: slug },
      workspace_id: ws,
    });
    throw new HTTPException(502, { message: msg });
  }
});
