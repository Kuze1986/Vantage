import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { recordGrowthEvent } from "../lib/growth.js";
import { loadProductProfile } from "../lib/product-profile.js";
import { assertMediaReady, withForceMedia } from "../lib/media-gate.js";
import { resolveCampaignIdForPiece } from "../lib/campaign-kpi.js";
import { MANUAL_PUBLISH_CHANNELS } from "../lib/publish-pack.js";

// Adapters
import { postTweet } from "../adapters/x.js";
import { postLinkedIn } from "../adapters/linkedin.js";
import { postThread } from "../adapters/threads.js";
import { postBluesky } from "../adapters/bluesky.js";
import { sendEmail } from "../adapters/email.js";
import { postTikTokVideo, waitForPublish, type TikTokPostSettings } from "../adapters/tiktok.js";
import { postInstagramMedia, postInstagramCarousel } from "../adapters/instagram.js";
import { postFacebook, postFacebookPhotos } from "../adapters/facebook.js";
import { carouselUrlsForChannel } from "../lib/carousel.js";

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

  // external_post_url is read again for manual channels (Reddit): the human posts
  // it, then pastes the permalink back so the piece can reach 'published' with a
  // real external id that engagement polling can key off.
  const { content_piece_id, external_post_url, force } = parsed.data;
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

  // Manual channels record the URL the human posted instead of calling an
  // adapter. Reddit is here because its API refuses cloud egress entirely, so
  // there is no server-side call to make — see lib/publish-pack.ts.
  let externalId: string;
  try {
    // Manual channels all share one branch regardless of slug, so they're
    // dispatched as a pseudo-case rather than nesting the whole switch.
    switch (MANUAL_PUBLISH_CHANNELS.has(slug) ? "__manual__" : slug) {
      case "__manual__": {
        if (!external_post_url) {
          throw new HTTPException(400, {
            message: `${slug} is a manual channel — post it yourself, then supply external_post_url to mark it published`,
          });
        }
        externalId = external_post_url;
        break;
      }
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
      // "reddit" is handled by the __manual__ case above — Reddit's API refuses
      // requests from cloud egress ranges, so there is no server-side post to make.
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

        // Direct Post settings are captured in the compose UI against a live
        // creator_info response and stored on the piece. There is deliberately
        // NO fallback: TikTok's guidelines forbid a default privacy level, so a
        // piece without settings must not be posted rather than be posted
        // with an assumed one. See docs/tiktok-app-review.md §3c.
        const stored = payload.tiktok_post_settings as TikTokPostSettings | undefined;
        if (!stored || !stored.privacy_level) {
          throw new Error(
            "TikTok posts require Direct Post settings (privacy level, interaction and disclosure choices). " +
            "Open the piece and complete the TikTok posting form before publishing.",
          );
        }
        const settings: TikTokPostSettings = {
          ...stored,
          title: stored.title || String(payload.hook ?? payload.body ?? ""),
        };
        const result = await postTikTokVideo(ws, { videoUrl, settings });
        externalId = result.id;
        // No UI is attached to a scheduler-driven publish, so wait here for a
        // terminal status. Interactive publishes poll the status route instead.
        await waitForPublish(ws, result.id);
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
          ({ id: externalId } = await postInstagramCarousel(ws, { imageUrls: slides, caption }));
          break;
        }
        const mediaUrl = videoUrl || imageUrl;
        if (!mediaUrl) throw new Error("Instagram post requires an image or video");
        ({ id: externalId } = await postInstagramMedia(ws, {
          mediaUrl,
          mediaType: videoUrl ? "VIDEO" : "IMAGE",
          caption,
        }));
        break;
      }
      case "facebook": {
        const imageUrl = typeof payload.image_url === "string" ? payload.image_url : piece.image_url;
        const message  = String(payload.body ?? "");
        const slides   = carouselUrlsForChannel(slug, payload, piece.video_url);
        if (slides.length) {
          ({ id: externalId } = await postFacebookPhotos(ws, { message, imageUrls: slides }));
          break;
        }
        ({ id: externalId } = await postFacebook(ws, {
          message,
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
    // product identifies which NEXUS product this workspace is publishing
    // for (recordGrowthEvent defaults to "vantage" when omitted, which is
    // wrong for every non-Vantage workspace — e.g. ws-shift).
    const { default_product_id } = await loadProductProfile(ws);
    await recordGrowthEvent({
      loop: "acquisition", kind: "impression", channel: slug, product: default_product_id,
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
