import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { postTweet } from "../adapters/x.js";

const bodySchema = z.object({
  content_piece_id: z.string().uuid(),
});

export const publishRoutes = new Hono();

publishRoutes.post("/:channel", async (c) => {
  const channel = c.req.param("channel");
  if (channel !== "x") throw new HTTPException(400, { message: "Phase 0 supports x only" });
  const json = await c.req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const sb = getSupabaseAdmin();
  const { content_piece_id } = parsed.data;
  const { data: piece, error } = await sb
    .schema("vantage")
    .from("content_pieces")
    .select("id, content_payload, status, channel_slug")
    .eq("id", content_piece_id)
    .single();
  if (error || !piece) throw new HTTPException(404, { message: "Not found" });
  if (piece.status !== "approved" && piece.status !== "queued") {
    throw new HTTPException(400, { message: `Cannot publish from status ${piece.status}` });
  }
  const body = (piece.content_payload as { body?: string })?.body;
  if (!body) throw new HTTPException(400, { message: "Missing body" });

  try {
    const { id: externalId } = await postTweet(body);
    const now = new Date().toISOString();
    const { error: upErr } = await sb
      .schema("vantage")
      .from("content_pieces")
      .update({
        status: "published",
        published_at: now,
        external_post_id: externalId,
        updated_at: now,
      })
      .eq("id", content_piece_id);
    if (upErr) throw new Error(upErr.message);
    await logActivity({
      source: "adapter:x",
      source_type: "adapter",
      event_type: "published",
      summary: `Published tweet ${externalId}`,
      payload: { content_piece_id, external_post_id: externalId },
    });
    return c.json({ ok: true, external_post_id: externalId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb
      .schema("vantage")
      .from("content_pieces")
      .update({ status: "failed", audit_notes: msg, updated_at: new Date().toISOString() })
      .eq("id", content_piece_id);
    await logActivity({
      source: "adapter:x",
      source_type: "adapter",
      event_type: "publish_failed",
      summary: msg.slice(0, 500),
      payload: { content_piece_id },
    });
    throw new HTTPException(502, { message: msg });
  }
});
