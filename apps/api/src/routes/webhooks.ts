import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { crcResponseToken } from "../adapters/x.js";

export const webhooksRoutes = new Hono();

webhooksRoutes.get("/x", async (c) => {
  const crc = c.req.query("crc_token");
  if (!crc) throw new HTTPException(400, { message: "missing crc_token" });
  const secret = process.env.X_WEBHOOK_SECRET ?? process.env.X_CLIENT_SECRET;
  if (!secret) throw new HTTPException(500, { message: "Missing X_WEBHOOK_SECRET or X_CLIENT_SECRET" });
  const response_token = crcResponseToken(crc, secret);
  return c.json({ response_token });
});

webhooksRoutes.post("/x", async (c) => {
  const raw = await c.req.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new HTTPException(400, { message: "invalid json" });
  }

  const sb = getSupabaseAdmin();
  const eventType =
    (typeof payload.event_type === "string" && payload.event_type) ||
    (typeof payload.type === "string" && payload.type) ||
    "unknown";

  let contentPieceId: string | null = null;
  const tweetId =
    typeof (payload as { tweet_id?: string }).tweet_id === "string"
      ? (payload as { tweet_id: string }).tweet_id
      : typeof (payload as { data?: { id?: string } }).data?.id === "string"
        ? (payload as { data: { id: string } }).data.id
        : null;

  if (tweetId) {
    const { data: piece } = await sb
      
      .from("content_pieces")
      .select("id")
      .eq("external_post_id", tweetId)
      .maybeSingle();
    contentPieceId = piece?.id ?? null;
  }

  const { error } = await sb.from("engagement_events").insert({
    content_piece_id: contentPieceId,
    event_type: eventType,
    event_payload: payload,
    occurred_at: new Date().toISOString(),
  });
  if (error) {
    await logActivity({
      source: "adapter:x",
      source_type: "adapter",
      event_type: "webhook_insert_error",
      summary: error.message,
      payload: { eventType },
    });
    throw new HTTPException(500, { message: error.message });
  }

  await logActivity({
    source: "adapter:x",
    source_type: "adapter",
    event_type: "webhook_received",
    summary: `X webhook ${eventType}`,
    payload: { eventType, tweetId },
  });

  return c.json({ ok: true });
});
