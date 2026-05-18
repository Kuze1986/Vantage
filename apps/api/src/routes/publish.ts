import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";

// Adapters
import { postTweet } from "../adapters/x.js";
import { postLinkedIn } from "../adapters/linkedin.js";
import { postToSubreddit } from "../adapters/reddit.js";
import { sendEmail } from "../adapters/email.js";

const bodySchema = z.object({
  content_piece_id: z.string().uuid(),
  // Manual-post channels supply the external URL after the human posts it
  external_post_url: z.string().url().optional(),
});

export const publishRoutes = new Hono();

publishRoutes.post("/:channel", async (c) => {
  const channel = c.req.param("channel");
  const json    = await c.req.json().catch(() => ({}));
  const parsed  = bodySchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const { content_piece_id, external_post_url } = parsed.data;
  const sb = getSupabaseAdmin();

  const { data: piece, error } = await sb
    .from("content_pieces")
    .select("id, channel_slug, format, content_payload, status")
    .eq("id", content_piece_id).single();
  if (error || !piece) throw new HTTPException(404, { message: "Not found" });
  if (piece.status !== "approved" && piece.status !== "queued") {
    throw new HTTPException(400, { message: `Cannot publish from status ${piece.status}` });
  }

  const payload = piece.content_payload as Record<string, unknown>;
  const slug    = piece.channel_slug as string;

  // Manual-post channels: just record the external URL
  if (["tiktok", "instagram", "facebook"].includes(slug)) {
    if (!external_post_url) {
      throw new HTTPException(400, {
        message: `${slug} requires manual posting. Post the content, then submit the external_post_url.`,
      });
    }
    const now = new Date().toISOString();
    await sb.from("content_pieces").update({
      status:           "published",
      published_at:     now,
      external_post_id: external_post_url,
      updated_at:       now,
    }).eq("id", content_piece_id);
    await logActivity({
      source: `adapter:${slug}`, source_type: "adapter",
      event_type: "published_manual",
      summary: `Manual publish recorded for ${slug} piece ${content_piece_id}`,
      payload: { content_piece_id, external_post_url, channel: slug },
    });
    return c.json({ ok: true, external_post_id: external_post_url, manual: true });
  }

  // Automated channels
  let externalId: string;
  try {
    switch (slug) {
      case "x": {
        const body = String(payload.body ?? "");
        if (!body) throw new Error("Missing tweet body");
        ({ id: externalId } = await postTweet(body));
        break;
      }
      case "linkedin": {
        const body     = String(payload.body ?? "");
        const headline = payload.headline ? String(payload.headline) : undefined;
        // 3A-3: pass image_url so LinkedIn can include an image card
        const imageUrl = typeof payload.image_url === "string" ? payload.image_url : undefined;
        ({ id: externalId } = await postLinkedIn(body, headline, imageUrl));
        break;
      }
      case "reddit": {
        // Load subreddit from channel cadence_config, using round-robin index (3A-4)
        const { data: ch } = await sb.from("channels")
          .select("cadence_config").eq("slug", "reddit").single();
        const cadence = (ch?.cadence_config ?? {}) as { subreddits?: string[]; subreddit_index?: number };
        const subs: string[] = cadence.subreddits ?? [];
        if (!subs.length) throw new Error("No subreddits configured for Reddit channel");
        const idx        = (cadence.subreddit_index ?? 0) % subs.length;
        const subreddit  = subs[idx];
        const nextIndex  = (idx + 1) % subs.length;
        // Persist the updated index back to cadence_config
        await sb.from("channels").update({
          cadence_config: { ...cadence, subreddit_index: nextIndex },
        }).eq("slug", "reddit");
        ({ id: externalId } = await postToSubreddit({
          subreddit,
          title:        String(payload.title ?? payload.body ?? "").slice(0, 300),
          body:         String(payload.body ?? ""),
          is_link_post: payload.is_link_post === true,
        }));
        break;
      }
      case "email": {
        // 3A-2: pass pieceId so UTM tags are applied to links in the HTML body
        ({ id: externalId } = await sendEmail({
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
      updated_at:       now,
    }).eq("id", content_piece_id);

    await logActivity({
      source: `adapter:${slug}`, source_type: "adapter",
      event_type: "published",
      summary: `Published ${slug} piece → ${externalId}`,
      payload: { content_piece_id, external_post_id: externalId, channel: slug },
    });

    return c.json({ ok: true, external_post_id: externalId });
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("content_pieces").update({
      status: "failed", audit_notes: msg, updated_at: new Date().toISOString(),
    }).eq("id", content_piece_id);
    await logActivity({
      source: `adapter:${slug}`, source_type: "adapter",
      event_type: "publish_failed",
      summary: msg.slice(0, 500),
      payload: { content_piece_id, channel: slug },
    });
    throw new HTTPException(502, { message: msg });
  }
});
