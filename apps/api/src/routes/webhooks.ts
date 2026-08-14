import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createHmac } from "node:crypto";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { recordGrowthEvent, engagementKind } from "../lib/growth.js";
import { loadProductProfile } from "../lib/product-profile.js";
import { recordCampaignEngagement, recordCampaignConversion, resolveCampaignIdForPiece } from "../lib/campaign-kpi.js";
import { crcResponseToken } from "../adapters/x.js";
import type Stripe from "stripe";
import { getStripe, invoiceSubscriptionId } from "../lib/stripe.js";
import {
  alreadyProcessed,
  markProcessed,
  recordInvoice,
  resolveWorkspaceId,
  upsertCustomer,
  upsertSubscription,
} from "../lib/billing-webhook.js";

type StripeEvent = Stripe.Event;
type StripeCheckoutSession = Stripe.Checkout.Session;
type StripeSubscription = Stripe.Subscription;
type StripeInvoice = Stripe.Invoice;

async function afterEngagement(opts: {
  contentPieceId: string | null;
  channel: string;
  eventType: string;
  workspaceId: string;
  extraMeta?: Record<string, unknown>;
}): Promise<void> {
  const campaignId = opts.contentPieceId
    ? await resolveCampaignIdForPiece(opts.contentPieceId).catch(() => null)
    : null;
  if (opts.contentPieceId) {
    await recordCampaignEngagement({
      contentPieceId: opts.contentPieceId,
      channel: opts.channel,
      eventType: opts.eventType,
    });
  }
  const { default_product_id } = await loadProductProfile(opts.workspaceId);
  await recordGrowthEvent({
    loop: "acquisition",
    kind: engagementKind(opts.eventType),
    channel: opts.channel,
    product: default_product_id,
    meta: {
      event_type: opts.eventType,
      content_piece_id: opts.contentPieceId,
      workspace_id: opts.workspaceId,
      ...(campaignId ? { campaign_id: campaignId } : {}),
      ...opts.extraMeta,
    },
  });
}

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

  // Best-effort — X's webhook payload shape varies by subscription/event type and has
  // not been verified against real deliveries in this codebase. Extend/replace as real
  // payloads are observed; never assume presence.
  const actorExternalId =
    typeof (payload as { user?: { id_str?: string } }).user?.id_str === "string"
      ? (payload as { user: { id_str: string } }).user.id_str
      : typeof (payload as { favorited_by?: { id_str?: string } }).favorited_by?.id_str === "string"
        ? (payload as { favorited_by: { id_str: string } }).favorited_by.id_str
        : null;

  const { error } = await sb.from("engagement_events").insert({
    workspace_id:       workspaceId,
    content_piece_id:   contentPieceId,
    event_type:         eventType,
    event_payload:      payload,
    external_event_id:  externalEventId,
    actor_external_id:  actorExternalId,
    occurred_at:        new Date().toISOString(),
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
  await afterEngagement({
    contentPieceId,
    channel: "x",
    eventType,
    workspaceId,
    extraMeta: { tweet_id: tweetId },
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

  // Best-effort — unverified against real LinkedIn webhook deliveries.
  const actorExternalId =
    typeof (payload as { actor?: string }).actor === "string"
      ? (payload as { actor: string }).actor
      : null;

  await sb.from("engagement_events").insert({
    workspace_id:       workspaceId,
    content_piece_id:   contentPieceId,
    event_type:         eventType,
    event_payload:      payload,
    external_event_id:  externalEventId,
    actor_external_id:  actorExternalId,
    occurred_at:        new Date().toISOString(),
  });

  await logActivity({
    source: "adapter:linkedin", source_type: "adapter",
    event_type: "webhook_received",
    summary: `LinkedIn webhook: ${eventType}`,
    payload: { eventType, shareId },
    workspace_id: workspaceId,
  });
  await afterEngagement({
    contentPieceId,
    channel: "linkedin",
    eventType,
    workspaceId,
    extraMeta: { share_id: shareId },
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
  await afterEngagement({
    contentPieceId,
    channel: "reddit",
    eventType,
    workspaceId,
    extraMeta: { post_id: postId },
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

  // Previously missing entirely — this was the only engagement webhook handler with no
  // dedup key, so a redelivered Resend webhook would double-insert.
  const externalEventId = emailId ? `email_${eventType}_${emailId}` : null;

  // Resend's payload exposes the recipient under data.to[] (array) or data.email
  // depending on event type — extract if present, unverified beyond that.
  const emailData = (payload as { data?: { to?: string[]; email?: string } }).data;
  const actorExternalId =
    Array.isArray(emailData?.to) && typeof emailData.to[0] === "string"
      ? emailData.to[0]
      : typeof emailData?.email === "string"
        ? emailData.email
        : null;

  const { error: insErr } = await sb.from("engagement_events").insert({
    workspace_id:       workspaceId,
    content_piece_id:   contentPieceId,
    event_type:         eventType,
    event_payload:      payload,
    external_event_id:  externalEventId,
    actor_external_id:  actorExternalId,
    occurred_at:        new Date().toISOString(),
  });
  // Ignore conflict on external_event_id (duplicate delivery) — same posture as X/LinkedIn/Reddit.
  if (insErr && !insErr.message.includes("unique") && !insErr.message.includes("duplicate")) {
    await logActivity({
      source: "adapter:email", source_type: "adapter",
      event_type: "webhook_insert_error",
      summary: insErr.message,
      payload: { eventType },
      workspace_id: workspaceId,
    });
  }

  await logActivity({
    source: "adapter:email", source_type: "adapter",
    event_type: "webhook_received",
    summary: `Resend webhook: ${eventType}`,
    payload: { eventType },
    workspace_id: workspaceId,
  });

  await afterEngagement({
    contentPieceId,
    channel: "email",
    eventType,
    workspaceId,
    extraMeta: { email_id: emailId },
  });

  return c.json({ ok: true });
});

// ── Conversion reporting (sibling products, e.g. Shift) ───────────────────────
// tagUrls() (lib/utm.ts) embeds content_pieces.id as utm_content on every outbound link
// Kuze generates, but nothing previously read that value back — this closes the loop by
// giving any downstream product a way to report "this content piece led to a signup".
// Attribution is by piece_id directly (our own primary key, not a platform post id), since
// that's the identifier the downstream product actually received via the tagged URL.
webhooksRoutes.post("/conversion", async (c) => {
  const raw = await c.req.text();
  const secret = process.env.CONVERSION_WEBHOOK_SECRET;

  if (secret) {
    const sig = c.req.header("x-conversion-signature") ?? "";
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    if (sig !== expected) throw new HTTPException(401, { message: "invalid conversion webhook signature" });
  }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(raw) as Record<string, unknown>; }
  catch { throw new HTTPException(400, { message: "invalid json" }); }

  const pieceId = typeof payload.piece_id === "string" ? payload.piece_id : null;
  if (!pieceId) throw new HTTPException(400, { message: "piece_id is required" });

  const eventType = typeof payload.event_type === "string" ? payload.event_type : "signup";
  const value = typeof payload.value === "number" ? payload.value : undefined;
  const sourceSystem = typeof payload.source_system === "string" ? payload.source_system : "unknown";

  const sb = getSupabaseAdmin();
  const { data: piece } = await sb
    .from("content_pieces")
    .select("id, workspace_id, channel_slug")
    .eq("id", pieceId)
    .maybeSingle();

  if (!piece) return c.json({ ok: true, skipped: "unmatched" });

  const workspaceId = piece.workspace_id as string;
  const channel = piece.channel_slug as string;

  const campaignId = await recordCampaignConversion({ contentPieceId: pieceId, channel, value });

  const { default_product_id } = await loadProductProfile(workspaceId);
  await recordGrowthEvent({
    loop: "conversion",
    kind: eventType,
    channel,
    product: default_product_id,
    value: value ?? null,
    meta: { content_piece_id: pieceId, workspace_id: workspaceId, source_system: sourceSystem, ...(campaignId ? { campaign_id: campaignId } : {}) },
  });

  await logActivity({
    source: `conversion:${sourceSystem}`, source_type: "adapter",
    event_type: "conversion_reported",
    summary: `Conversion reported for piece ${pieceId} (${eventType})`,
    payload: { piece_id: pieceId, event_type: eventType, value: value ?? null, source_system: sourceSystem },
    workspace_id: workspaceId,
  });

  return c.json({ ok: true, campaign_id: campaignId });
});

// ── Stripe (4-7 Billing) ─────────────────────────────────────────────────────
// Unauthenticated like every other webhook; the signature is the auth. Must
// verify against the *raw* body — any reserialization changes the bytes and the
// signature no longer matches.
webhooksRoutes.post("/stripe", async (c) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new HTTPException(500, { message: "STRIPE_WEBHOOK_SECRET not configured" });

  const signature = c.req.header("stripe-signature");
  if (!signature) throw new HTTPException(400, { message: "missing stripe-signature" });

  const raw = await c.req.text();

  let event: StripeEvent;
  try {
    event = getStripe().webhooks.constructEvent(raw, signature, secret) as StripeEvent;
  } catch (err) {
    // Never echo the reason — an attacker probing the endpoint learns nothing.
    await logActivity({
      source: "billing", source_type: "system",
      event_type: "stripe_signature_invalid",
      summary: "Rejected a Stripe webhook with an invalid signature",
      payload: { error: err instanceof Error ? err.message : String(err) },
    });
    throw new HTTPException(401, { message: "invalid signature" });
  }

  // Replay is expected: Stripe redelivers on any non-2xx. Acknowledge and stop.
  if (await alreadyProcessed(event.id)) return c.json({ ok: true, duplicate: true });

  const stripe = getStripe();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as StripeCheckoutSession;
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
        const workspaceId = await resolveWorkspaceId({
          metadataWorkspaceId: session.metadata?.workspace_id ?? null,
          clientReferenceId: session.client_reference_id ?? null,
          stripeCustomerId: customerId,
        });

        if (!workspaceId || !customerId) {
          // Acknowledge rather than 500 — a retry cannot supply what the event
          // never carried, and repeated 500s would stall the whole endpoint.
          await logActivity({
            source: "billing", source_type: "system",
            event_type: "stripe_unattributable",
            summary: "checkout.session.completed had no resolvable workspace",
            payload: { session_id: session.id },
          });
          break;
        }

        await upsertCustomer({
          workspaceId,
          stripeCustomerId: customerId,
          email: session.customer_details?.email ?? session.customer_email ?? null,
        });

        if (session.subscription) {
          const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertSubscription(workspaceId, sub);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as StripeSubscription;
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
        const workspaceId = await resolveWorkspaceId({
          metadataWorkspaceId: sub.metadata?.workspace_id ?? null,
          stripeCustomerId: customerId,
        });
        if (!workspaceId) break;
        await upsertSubscription(workspaceId, sub);
        break;
      }

      case "invoice.paid":
      case "invoice.payment_failed": {
        const invoice = event.data.object as StripeInvoice;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
        const workspaceId = await resolveWorkspaceId({ stripeCustomerId: customerId });
        await recordInvoice(workspaceId, invoice);

        // No counter reset here: usage_counters is keyed by period_start, so a
        // new period is a new row. Nothing to clear, nothing to double-clear on
        // a replayed event.
        if (workspaceId) {
          const subId = invoiceSubscriptionId(invoice);
          if (subId) {
            const sub = await stripe.subscriptions.retrieve(subId);
            await upsertSubscription(workspaceId, sub);
          }
        }
        break;
      }

      default:
        break;
    }

    await markProcessed(event);
    return c.json({ ok: true });
  } catch (err) {
    // Let Stripe retry — the event is not marked processed.
    const message = err instanceof Error ? err.message : String(err);
    await logActivity({
      source: "billing", source_type: "system",
      event_type: "stripe_webhook_error",
      summary: message.slice(0, 300),
      payload: { event_id: event.id, type: event.type },
    });
    throw new HTTPException(500, { message: "webhook processing failed" });
  }
});
