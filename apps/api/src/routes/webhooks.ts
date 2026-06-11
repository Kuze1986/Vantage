import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createHmac } from "node:crypto";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { recordGrowthEvent, engagementKind } from "../lib/growth.js";
import { crcResponseToken } from "../adapters/x.js";

export const webhooksRoutes = new Hono();

webhooksRoutes.get("/x", async (c) => {
  const crc = c.req.query("crc_token");
  if (!crc) throw new HTTPException(400, { message: "missing crc_token" });

  // X CRC challenge must be signed with the Consumer Secret (API Key Secret),
  // not the OAuth 2.0 Client Secret — they are different credentials.
  // Set X_CONSUMER_SECRET in Railway (value from: Developer Portal → App →
  // Keys and Tokens → Consumer Keys → API Key Secret).
  const secret =
    process.env.X_CONSUMER_SECRET ??
    process.env.X_WEBHOOK_SECRET ??
    process.env.X_CLIENT_SECRET;

  if (!secret) {
    throw new HTTPException(503, {
      message:
        "X webhook not configured. Set X_CONSUMER_SECRET in Railway " +
        "(API Key Secret from Twitter Developer Portal → your app → Keys and Tokens → Consumer Keys).",
    });
  }

  const response_token = crcResponseToken(crc, secret);
  return c.json({ response_token });
});

webhooksRoutes.post("/x", async (c) => {
  const raw = await c.req.text();

  // ── 3A-1: Verify HMAC-SHA256 signature ──────────────────────────────────
  const secret =
    process.env.X_CONSUMER_SECRET ??
    process.env.X_WEBHOOK_SECRET ??
    process.env.X_CLIENT_SECRET;
  if (secret) {
    const sigHeader = c.req.header("x-twitter-webhooks-signature") ?? "";
    // Header format: "sha256=<base64>"
    const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("base64");
    if (sigHeader !== expected) {
      throw new HTTPException(401, { message: "invalid X webhook signature" });
    }
  }

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
  let workspaceId: string | null = null;
  const tweetId =
    typeof (payload as { tweet_id?: string }).tweet_id === "string"
      ? (payload as { tweet_id: string }).tweet_id
      : typeof (payload as { data?: { id?: string } }).data?.id === "string"
        ? (payload as { data: { id: string } }).data.id
        : null;

  if (tweetId) {
    const { data: piece } = await sb
      .from("content_pieces")
      .select("id, workspace_id")
      .eq("external_post_id", tweetId)
      .maybeSingle();
    contentPieceId = piece?.id ?? null;
    workspaceId = (piece?.workspace_id as string | undefined) ?? null;
  }

  // Engagement events are workspace-scoped; skip if we can't attribute the piece.
  if (!workspaceId) return c.json({ ok: true, skipped: "unmatched" });

  // ── 3A-5: Derive external_event_id for deduplication ────────────────────
  const externalEventId = tweetId
    ? `x_${eventType}_${tweetId}`
    : null;

  const { error } = await sb.from("engagement_events").insert({
    workspace_id:      workspaceId,
    content_piece_id:  contentPieceId,
    event_type:        eventType,
    event_payload:     payload,
    external_event_id: externalEventId,
    occurred_at:       new Date().toISOString(),
  });
  // Ignore conflict on external_event_id (duplicate delivery)
  if (error && !error.message.includes("unique") && !error.message.includes("duplicate")) {
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
    workspace_id: workspaceId,
  });
  // Growth OS — Loop A: engagement on a published piece.
  await recordGrowthEvent({
    loop: "acquisition", kind: engagementKind(eventType), channel: "x",
    meta: { event_type: eventType, tweet_id: tweetId, content_piece_id: contentPieceId, workspace_id: workspaceId },
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
  let workspaceId: string | null = null;
  if (shareId) {
    const { data: piece } = await sb
      .from("content_pieces")
      .select("id, workspace_id")
      .eq("external_post_id", shareId)
      .maybeSingle();
    contentPieceId = piece?.id ?? null;
    workspaceId = (piece?.workspace_id as string | undefined) ?? null;
  }

  if (!workspaceId) return c.json({ ok: true, skipped: "unmatched" });

  // 3A-5: external_event_id for deduplication
  const liEventId = typeof payload.eventId === "string" ? payload.eventId : null;
  const externalEventId = liEventId
    ? `linkedin_${eventType}_${liEventId}`
    : shareId ? `linkedin_${eventType}_${shareId}` : null;

  await sb.from("engagement_events").insert({
    workspace_id:      workspaceId,
    content_piece_id:  contentPieceId,
    event_type:        eventType,
    event_payload:     payload,
    external_event_id: externalEventId,
    occurred_at:       new Date().toISOString(),
  });

  await logActivity({
    source: "adapter:linkedin", source_type: "adapter",
    event_type: "webhook_received",
    summary: `LinkedIn webhook: ${eventType}`,
    payload: { eventType, shareId },
    workspace_id: workspaceId,
  });
  // Growth OS — Loop A: engagement on a published piece.
  await recordGrowthEvent({
    loop: "acquisition", kind: engagementKind(eventType), channel: "linkedin",
    meta: { event_type: eventType, share_id: shareId, content_piece_id: contentPieceId, workspace_id: workspaceId },
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
  let workspaceId: string | null = null;
  if (postId) {
    const { data: piece } = await sb
      .from("content_pieces")
      .select("id, workspace_id")
      .eq("external_post_id", postId)
      .maybeSingle();
    contentPieceId = piece?.id ?? null;
    workspaceId = (piece?.workspace_id as string | undefined) ?? null;
  }

  if (!workspaceId) return c.json({ ok: true, skipped: "unmatched" });

  // 3A-5: external_event_id for deduplication
  const redditExternalId = postId ? `reddit_${eventType}_${postId}` : null;

  await sb.from("engagement_events").insert({
    workspace_id:      workspaceId,
    content_piece_id:  contentPieceId,
    event_type:        eventType,
    event_payload:     payload,
    external_event_id: redditExternalId,
    occurred_at:       new Date().toISOString(),
  });

  await logActivity({
    source: "adapter:reddit", source_type: "adapter",
    event_type: "webhook_received",
    summary: `Reddit event: ${eventType}`,
    payload: { eventType, postId },
    workspace_id: workspaceId,
  });
  // Growth OS — Loop A: engagement on a published piece.
  await recordGrowthEvent({
    loop: "acquisition", kind: engagementKind(eventType), channel: "reddit",
    meta: { event_type: eventType, post_id: postId, content_piece_id: contentPieceId, workspace_id: workspaceId },
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

  // Attribute to a workspace via Resend's email_id → our external_post_id.
  const emailId =
    typeof (payload as { data?: { email_id?: string } }).data?.email_id === "string"
      ? (payload as { data: { email_id: string } }).data.email_id
      : null;
  let contentPieceId: string | null = null;
  let workspaceId: string | null = null;
  if (emailId) {
    const { data: piece } = await sb
      .from("content_pieces")
      .select("id, workspace_id")
      .eq("external_post_id", emailId)
      .maybeSingle();
    contentPieceId = piece?.id ?? null;
    workspaceId = (piece?.workspace_id as string | undefined) ?? null;
  }

  if (!workspaceId) return c.json({ ok: true, skipped: "unmatched" });

  await sb.from("engagement_events").insert({
    workspace_id:     workspaceId,
    content_piece_id: contentPieceId,
    event_type: eventType,
    event_payload: payload,
    occurred_at: new Date().toISOString(),
  });

  await logActivity({
    source: "adapter:email", source_type: "adapter",
    event_type: "webhook_received",
    summary: `Resend webhook: ${eventType}`,
    payload: { eventType },
    workspace_id: workspaceId,
  });

  return c.json({ ok: true });
});
