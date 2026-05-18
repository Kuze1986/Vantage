import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createHmac } from "node:crypto";
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

// ── LinkedIn webhooks ─────────────────────────────────────────────────────────
// LinkedIn sends a challenge on subscription; verify with LINKEDIN_WEBHOOK_SECRET
webhooksRoutes.get("/linkedin", (c) => {
  const challenge = c.req.query("challengeCode");
  if (!challenge) throw new HTTPException(400, { message: "missing challengeCode" });
  return c.json({ challengeCode: challenge });
});

webhooksRoutes.post("/linkedin", async (c) => {
  const raw = await c.req.text();
  const secret = process.env.LINKEDIN_WEBHOOK_SECRET;

  // Verify signature if secret is configured
  if (secret) {
    const sig = c.req.header("x-li-signature") ?? "";
    const expected = createHmac("sha256", secret).update(raw).digest("base64");
    if (sig !== expected) throw new HTTPException(401, { message: "invalid signature" });
  }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new HTTPException(400, { message: "invalid json" }); }

  const sb = getSupabaseAdmin();
  const eventType = typeof payload.eventType === "string" ? payload.eventType : "linkedin_event";

  // Map LinkedIn share ID to a content piece if possible
  const shareId: string | null =
    typeof (payload as { shareId?: string }).shareId === "string"
      ? (payload as { shareId: string }).shareId
      : null;

  let contentPieceId: string | null = null;
  if (shareId) {
    const { data: piece } = await sb
      .from("content_pieces")
      .select("id")
      .eq("external_post_id", shareId)
      .maybeSingle();
    contentPieceId = piece?.id ?? null;
  }

  await sb.from("engagement_events").insert({
    content_piece_id: contentPieceId,
    event_type: eventType,
    event_payload: payload,
    occurred_at: new Date().toISOString(),
  });

  await logActivity({
    source: "adapter:linkedin", source_type: "adapter",
    event_type: "webhook_received",
    summary: `LinkedIn webhook: ${eventType}`,
    payload: { eventType, shareId },
  });

  return c.json({ ok: true });
});

// ── Reddit webhooks (poll-based — no native push) ─────────────────────────────
// Reddit has no push webhook API. This endpoint accepts manually forwarded events
// or events from third-party Reddit monitoring services. Engagement data is
// primarily collected via pollRedditEngagement() in the scheduler.
webhooksRoutes.post("/reddit", async (c) => {
  let payload: Record<string, unknown>;
  try { payload = await c.req.json() as Record<string, unknown>; }
  catch { throw new HTTPException(400, { message: "invalid json" }); }

  const sb = getSupabaseAdmin();
  const eventType = typeof payload.event_type === "string" ? payload.event_type : "reddit_event";
  const postId: string | null =
    typeof (payload as { post_id?: string }).post_id === "string"
      ? (payload as { post_id: string }).post_id
      : null;

  let contentPieceId: string | null = null;
  if (postId) {
    const { data: piece } = await sb
      .from("content_pieces")
      .select("id")
      .eq("external_post_id", postId)
      .maybeSingle();
    contentPieceId = piece?.id ?? null;
  }

  await sb.from("engagement_events").insert({
    content_piece_id: contentPieceId,
    event_type: eventType,
    event_payload: payload,
    occurred_at: new Date().toISOString(),
  });

  await logActivity({
    source: "adapter:reddit", source_type: "adapter",
    event_type: "webhook_received",
    summary: `Reddit event: ${eventType}`,
    payload: { eventType, postId },
  });

  return c.json({ ok: true });
});

// ── Resend (email) delivery webhooks ─────────────────────────────────────────
webhooksRoutes.post("/email", async (c) => {
  const raw = await c.req.text();
  const secret = process.env.RESEND_WEBHOOK_SECRET;

  if (secret) {
    const sig = c.req.header("svix-signature") ?? "";
    const ts  = c.req.header("svix-timestamp") ?? "";
    const expected = createHmac("sha256", secret)
      .update(`${ts}.${raw}`)
      .digest("hex");
    // Svix sends multiple signatures; accept if any matches
    const valid = sig.split(" ").some((s) => s.replace(/^v1,/, "") === expected);
    if (!valid) throw new HTTPException(401, { message: "invalid svix signature" });
  }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new HTTPException(400, { message: "invalid json" }); }

  const sb = getSupabaseAdmin();
  const eventType = typeof payload.type === "string" ? payload.type : "email_event";

  await sb.from("engagement_events").insert({
    content_piece_id: null, // email events don't map 1:1 to pieces easily
    event_type: eventType,
    event_payload: payload,
    occurred_at: new Date().toISOString(),
  });

  await logActivity({
    source: "adapter:email", source_type: "adapter",
    event_type: "webhook_received",
    summary: `Resend webhook: ${eventType}`,
    payload: { eventType },
  });

  return c.json({ ok: true });
});
