import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { buildPublishPack, MANUAL_PUBLISH_CHANNELS } from "../lib/publish-pack.js";
import { logActivity } from "../lib/activity.js";
import { scheduleContentPiece } from "../services/scheduler.js";
import { maybeAutoQueuePiece } from "../lib/auto-queue.js";

export const queueRoutes = new Hono();

const REMOVABLE_STATUSES = new Set([
  "draft",
  "auditing",
  "approved",
  "rejected",
  "queued",
  "failed",
  "published",
]);

/** Best-effort scrub of campaign timeline JSON refs after a piece is deleted. */
async function scrubCampaignPublishedPieces(
  sb: ReturnType<typeof getSupabaseAdmin>,
  workspaceId: string,
  pieceId: string,
): Promise<void> {
  const { data: campaigns } = await sb
    .from("campaigns")
    .select("id")
    .eq("workspace_id", workspaceId);
  if (!campaigns?.length) return;

  const { data: days } = await sb
    .from("campaign_timeline")
    .select("id, published_pieces")
    .in(
      "campaign_id",
      campaigns.map((c) => c.id),
    );
  if (!days?.length) return;

  for (const day of days) {
    const pubs = Array.isArray(day.published_pieces) ? day.published_pieces : [];
    const next = pubs.filter(
      (p) =>
        !(p && typeof p === "object" && (p as { content_piece_id?: string }).content_piece_id === pieceId),
    );
    if (next.length === pubs.length) continue;
    await sb
      .from("campaign_timeline")
      .update({ published_pieces: next, updated_at: new Date().toISOString() })
      .eq("id", day.id);
  }
}

// 3B-2: Calendar endpoint — pieces with scheduled_for in a date range
queueRoutes.get("/calendar", async (c) => {
  const ws   = c.get("workspaceId");
  const sb   = getSupabaseAdmin();
  const from = c.req.query("from"); // ISO date string
  const to   = c.req.query("to");   // ISO date string
  const campaignId = c.req.query("campaign_id");
  if (!from || !to) return c.json({ error: "from and to query params are required" }, 400);

  // Without campaign filter, skip the topics join
  if (!campaignId) {
    const { data, error } = await sb
      .from("content_pieces")
      .select("id, status, channel_slug, format, content_payload, scheduled_for, published_at")
      .eq("workspace_id", ws)
      .in("status", ["queued", "published"])
      .gte("scheduled_for", from)
      .lte("scheduled_for", to)
      .order("scheduled_for", { ascending: true })
      .limit(500);
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ pieces: data ?? [] });
  }

  const { data, error } = await sb
    .from("content_pieces")
    .select("id, status, channel_slug, format, content_payload, scheduled_for, published_at, topic_id, topics!inner(source_ref, context_payload, source_product)")
    .eq("workspace_id", ws)
    .in("status", ["queued", "published", "approved"])
    .gte("scheduled_for", from)
    .lte("scheduled_for", to)
    .order("scheduled_for", { ascending: true })
    .limit(500);
  if (error) return c.json({ error: error.message }, 500);

  type TopicJoin = { source_ref?: string; source_product?: string; context_payload?: unknown };
  const pieces = (data ?? [])
    .filter((row) => {
      const topics = (row as { topics?: TopicJoin | TopicJoin[] }).topics;
      const t = Array.isArray(topics) ? topics[0] : topics;
      if (!t) return false;
      if (t.source_product === "campaign" && t.source_ref === campaignId) return true;
      const ctx = t.context_payload;
      return (
        ctx &&
        typeof ctx === "object" &&
        !Array.isArray(ctx) &&
        (ctx as { campaign_id?: string }).campaign_id === campaignId
      );
    })
    .map((row) => {
      const { topics: _t, topic_id: _tid, ...rest } = row as Record<string, unknown>;
      return rest;
    });

  return c.json({ pieces });
});

// POST /v1/queue/bulk-schedule — schedule many approved pieces at once
queueRoutes.post("/bulk-schedule", async (c) => {
  const ws = c.get("workspaceId");
  const json = await c.req.json().catch(() => ({}));
  const schema = z.object({
    content_piece_ids: z.array(z.string().uuid()).min(1).max(100),
    scheduled_for: z.string().optional(),
    force: z.boolean().optional(),
  });
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of parsed.data.content_piece_ids) {
    try {
      await scheduleContentPiece(ws, id, parsed.data.scheduled_for, { force: parsed.data.force });
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return c.json({
    ok: results.every((r) => r.ok),
    scheduled: results.filter((r) => r.ok).length,
    results,
  });
});

queueRoutes.get("/", async (c) => {
  const ws = c.get("workspaceId");
  const limit = Math.min(Number(c.req.query("limit") ?? "100"), 500);
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("content_pieces")
    .select("id, status, channel_slug, format, content_payload, audit_notes, audit_category, audit_iterations, created_at, image_url, video_url, media_status, variant_group_id, retry_count, retry_after, topic_id")
    .eq("workspace_id", ws)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ pieces: data ?? [] });
});

// PATCH /v1/queue/:id — attach media / update payload fields on a piece
queueRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const ws = c.get("workspaceId");
  const json = await c.req.json().catch(() => ({}));
  const schema = z.object({
    image_url: z.string().url().nullable().optional(),
    video_url: z.string().url().nullable().optional(),
    media_status: z.enum(["none", "pending", "ready", "failed"]).optional(),
    content_payload_patch: z.record(z.unknown()).optional(),
  });
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const sb = getSupabaseAdmin();
  const { data: piece, error: loadErr } = await sb
    .from("content_pieces")
    .select("id, content_payload, image_url, video_url, media_status, status, scheduled_for")
    .eq("workspace_id", ws)
    .eq("id", id)
    .single();
  if (loadErr || !piece) throw new HTTPException(404, { message: "Not found" });

  const payload =
    piece.content_payload && typeof piece.content_payload === "object" && !Array.isArray(piece.content_payload)
      ? { ...(piece.content_payload as Record<string, unknown>) }
      : {};

  if (parsed.data.content_payload_patch) {
    Object.assign(payload, parsed.data.content_payload_patch);
  }
  if (parsed.data.image_url !== undefined) {
    if (parsed.data.image_url) payload.image_url = parsed.data.image_url;
    else delete payload.image_url;
  }
  if (parsed.data.video_url !== undefined) {
    if (parsed.data.video_url) payload.video_url = parsed.data.video_url;
    else delete payload.video_url;
  }

  const mediaStatus =
    parsed.data.media_status ??
    (parsed.data.image_url || parsed.data.video_url ? "ready" : undefined);

  const { data: updated, error } = await sb
    .from("content_pieces")
    .update({
      ...(parsed.data.image_url !== undefined ? { image_url: parsed.data.image_url } : {}),
      ...(parsed.data.video_url !== undefined ? { video_url: parsed.data.video_url } : {}),
      ...(mediaStatus ? { media_status: mediaStatus } : {}),
      content_payload: payload,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", ws)
    .eq("id", id)
    .select("id, image_url, video_url, media_status, content_payload, status, scheduled_for")
    .single();
  if (error) throw new HTTPException(500, { message: error.message });

  // Autopilot: operator marking media ready can auto-queue campaign pieces
  if (mediaStatus === "ready" || mediaStatus === "none") {
    await maybeAutoQueuePiece(ws, id);
  }

  const { data: refreshed } = await sb
    .from("content_pieces")
    .select("id, image_url, video_url, media_status, content_payload, status")
    .eq("id", id)
    .single();

  return c.json({ piece: refreshed ?? updated });
});

// GET /v1/queue/:id/publish-pack — one-click export for TikTok / Instagram / Facebook
queueRoutes.get("/:id/publish-pack", async (c) => {
  const id = c.req.param("id");
  const ws = c.get("workspaceId");
  const sb = getSupabaseAdmin();

  const { data: piece, error } = await sb
    .from("content_pieces")
    .select("id, channel_slug, content_payload, image_url, video_url, media_status")
    .eq("workspace_id", ws)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new HTTPException(500, { message: error.message });
  if (!piece) throw new HTTPException(404, { message: "Not found" });

  const channel = String(piece.channel_slug ?? "");
  if (!MANUAL_PUBLISH_CHANNELS.has(channel)) {
    // Derived from the set so this message can't drift as channels move between
    // automated and manual.
    const manual = [...MANUAL_PUBLISH_CHANNELS].join(" / ") || "(none)";
    throw new HTTPException(400, {
      message: `Publish Pack is only for manual channels: ${manual} (got '${channel}')`,
    });
  }

  // Reddit's pack needs to name the subreddit to post into. Read the current
  // round-robin target without advancing it — building a pack is a read.
  let subreddit: string | null = null;
  if (channel === "reddit") {
    const { data: ch } = await sb.from("channels")
      .select("cadence_config").eq("workspace_id", ws).eq("slug", "reddit").maybeSingle();
    const cadence = (ch?.cadence_config ?? {}) as { subreddits?: string[]; subreddit_index?: number };
    const subs = cadence.subreddits ?? [];
    if (subs.length) subreddit = subs[(cadence.subreddit_index ?? 0) % subs.length];
  }

  const payload =
    piece.content_payload && typeof piece.content_payload === "object" && !Array.isArray(piece.content_payload)
      ? (piece.content_payload as Record<string, unknown>)
      : {};

  return c.json(
    buildPublishPack({
      id: piece.id,
      channel,
      payload,
      videoUrl: piece.video_url,
      imageUrl: piece.image_url,
      mediaStatus: piece.media_status,
      subreddit,
    }),
  );
});

// 3A-6: Retry a failed piece — resets status to queued with a fresh scheduled_for
queueRoutes.post("/:id/retry", async (c) => {
  const id = c.req.param("id");
  const ws = c.get("workspaceId");
  const sb = getSupabaseAdmin();

  const { data: piece, error: loadErr } = await sb
    .from("content_pieces")
    .select("id, status, retry_count")
    .eq("workspace_id", ws)
    .eq("id", id)
    .single();
  if (loadErr || !piece) throw new HTTPException(404, { message: "Not found" });
  if (piece.status !== "failed") {
    throw new HTTPException(400, { message: `Cannot retry piece with status '${piece.status}' — only 'failed' pieces can be retried` });
  }

  const { error } = await sb.from("content_pieces").update({
    status:      "queued",
    retry_count: 0,          // reset counter for manual retry
    retry_after: null,
    scheduled_for: new Date().toISOString(),
    updated_at:  new Date().toISOString(),
  }).eq("workspace_id", ws).eq("id", id);
  if (error) throw new HTTPException(500, { message: error.message });

  return c.json({ ok: true });
});

// POST /v1/queue/:id/force-approve — explicit operator override for a rejected
// draft. This never hides the audit result: it stamps the override into both
// the payload and audit notes, then returns the piece to the normal media gate.
queueRoutes.post("/:id/force-approve", async (c) => {
  const id = c.req.param("id");
  const ws = c.get("workspaceId");
  const parsed = z.object({ reason: z.string().trim().max(500).optional() })
    .safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });
  const reason = parsed.data.reason || "Operator confirmed content accuracy";
  const sb = getSupabaseAdmin();
  const { data: piece, error: loadErr } = await sb
    .from("content_pieces")
    .select("id,status,content_payload,audit_notes,media_status")
    .eq("workspace_id", ws)
    .eq("id", id)
    .single();
  if (loadErr || !piece) throw new HTTPException(404, { message: "Not found" });
  if (piece.status !== "rejected") {
    throw new HTTPException(400, { message: `Only rejected pieces can be force-approved (current status: '${piece.status}')` });
  }

  const now = new Date().toISOString();
  const payload = piece.content_payload && typeof piece.content_payload === "object" && !Array.isArray(piece.content_payload)
    ? { ...(piece.content_payload as Record<string, unknown>) }
    : {};
  payload.manual_approval = { approved_at: now, reason };
  const notes = [`[force-approved] ${reason}`, piece.audit_notes].filter(Boolean).join("\n").slice(0, 1000);
  const { error } = await sb
    .from("content_pieces")
    .update({
      status: "approved",
      scheduled_for: now,
      locked_at: null,
      content_payload: payload,
      audit_notes: notes,
      updated_at: now,
    })
    .eq("workspace_id", ws)
    .eq("id", id);
  if (error) throw new HTTPException(500, { message: error.message });

  // Media remains an independent gate. Ready/text-only pieces are queued now;
  // media-pending pieces remain approved until their asset becomes ready.
  await maybeAutoQueuePiece(ws, id);
  const { data: updated } = await sb
    .from("content_pieces")
    .select("id,status,media_status,scheduled_for")
    .eq("workspace_id", ws)
    .eq("id", id)
    .single();
  await logActivity({
    source: "queue",
    source_type: "system",
    event_type: "piece_force_approved",
    summary: `Force-approved content piece ${id}: ${reason}`.slice(0, 500),
    payload: { content_piece_id: id, reason, media_status: updated?.media_status ?? piece.media_status },
    workspace_id: ws,
  });
  return c.json({ ok: true, piece: updated });
});

// POST /v1/queue/:id/reject — soft-dismiss (keep row, hide from publish path)
queueRoutes.post("/:id/reject", async (c) => {
  const id = c.req.param("id");
  const ws = c.get("workspaceId");
  const sb = getSupabaseAdmin();
  const json = await c.req.json().catch(() => ({}));
  const reason =
    typeof (json as { reason?: unknown }).reason === "string"
      ? String((json as { reason: string }).reason).slice(0, 500)
      : "Manually dismissed from Queue";

  const { data: piece, error: loadErr } = await sb
    .from("content_pieces")
    .select("id, status, audit_notes")
    .eq("workspace_id", ws)
    .eq("id", id)
    .single();
  if (loadErr || !piece) throw new HTTPException(404, { message: "Not found" });
  if (piece.status === "publishing") {
    throw new HTTPException(409, { message: "Cannot dismiss a piece that is currently publishing" });
  }
  if (piece.status === "rejected") {
    return c.json({ ok: true, status: "rejected" });
  }
  if (!REMOVABLE_STATUSES.has(piece.status)) {
    throw new HTTPException(400, {
      message: `Cannot dismiss piece with status '${piece.status}'`,
    });
  }

  const notes = [piece.audit_notes, `[dismissed] ${reason}`].filter(Boolean).join("\n").slice(0, 1000);
  const { error } = await sb
    .from("content_pieces")
    .update({
      status: "rejected",
      scheduled_for: null,
      locked_at: null,
      audit_notes: notes,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", ws)
    .eq("id", id);
  if (error) throw new HTTPException(500, { message: error.message });

  await logActivity({
    source: "queue",
    source_type: "adapter",
    event_type: "piece_dismissed",
    summary: `Dismissed content piece ${id}`,
    payload: { content_piece_id: id, previous_status: piece.status },
    workspace_id: ws,
  });

  return c.json({ ok: true, status: "rejected" });
});

// DELETE /v1/queue/:id — permanently remove a piece the operator does not want
queueRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const ws = c.get("workspaceId");
  const sb = getSupabaseAdmin();

  const { data: piece, error: loadErr } = await sb
    .from("content_pieces")
    .select("id, status, channel_slug")
    .eq("workspace_id", ws)
    .eq("id", id)
    .single();
  if (loadErr || !piece) throw new HTTPException(404, { message: "Not found" });
  if (piece.status === "publishing") {
    throw new HTTPException(409, {
      message: "Cannot delete a piece that is currently publishing — wait for it to finish or fail",
    });
  }
  if (!REMOVABLE_STATUSES.has(piece.status)) {
    throw new HTTPException(400, {
      message: `Cannot delete piece with status '${piece.status}'`,
    });
  }

  const { error } = await sb
    .from("content_pieces")
    .delete()
    .eq("workspace_id", ws)
    .eq("id", id);
  if (error) throw new HTTPException(500, { message: error.message });

  try {
    await scrubCampaignPublishedPieces(sb, ws, id);
  } catch (scrubErr) {
    console.warn(
      `[queue] campaign scrub failed for ${id}:`,
      scrubErr instanceof Error ? scrubErr.message : scrubErr,
    );
  }

  await logActivity({
    source: "queue",
    source_type: "adapter",
    event_type: "piece_deleted",
    summary: `Deleted content piece ${id} (${piece.channel_slug})`,
    payload: { content_piece_id: id, previous_status: piece.status, channel: piece.channel_slug },
    workspace_id: ws,
  });

  return c.json({ ok: true, deleted: id });
});
