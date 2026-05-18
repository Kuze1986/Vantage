import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";

export const subscribersRoutes = new Hono();

const subscriberSchema = z.object({
  email: z.string().email(),
  name:  z.string().optional(),
  tags:  z.array(z.string()).optional(),
});

// GET /v1/subscribers — list all subscribers
subscribersRoutes.get("/", async (c) => {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("newsletter_subscribers")
    .select("id, email, name, tags, subscribed_at, unsubscribed_at")
    .order("subscribed_at", { ascending: false });
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ subscribers: data ?? [] });
});

// POST /v1/subscribers — add subscriber
subscribersRoutes.post("/", async (c) => {
  const json = await c.req.json().catch(() => ({}));
  const parsed = subscriberSchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("newsletter_subscribers")
    .upsert({ ...parsed.data, unsubscribed_at: null }, { onConflict: "email" })
    .select("id, email")
    .single();
  if (error) throw new HTTPException(500, { message: error.message });

  await logActivity({
    source: "subscribers", source_type: "system",
    event_type: "subscriber_added",
    summary: `Subscriber added: ${parsed.data.email}`,
    payload: { email: parsed.data.email },
  });

  return c.json({ ok: true, subscriber: data }, 201);
});

// DELETE /v1/subscribers/:id — unsubscribe (soft delete)
subscribersRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("newsletter_subscribers")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new HTTPException(500, { message: error.message });

  await logActivity({
    source: "subscribers", source_type: "system",
    event_type: "subscriber_removed",
    summary: `Subscriber unsubscribed (id: ${id})`,
    payload: { id },
  });

  return c.json({ ok: true });
});
