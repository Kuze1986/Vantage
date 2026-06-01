// routes/email-templates.ts — CRUD for email/newsletter templates (3C-6)
// GET    /v1/email-templates         — list all templates
// POST   /v1/email-templates         — create a template
// GET    /v1/email-templates/:id     — get one template
// PATCH  /v1/email-templates/:id     — update name / description / blocks
// DELETE /v1/email-templates/:id     — delete a template

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";

const blockSchema = z.object({
  id:      z.string(),
  type:    z.enum(['header', 'hero', 'text', 'button', 'image', 'divider', 'footer']),
  props:   z.record(z.unknown()),
});

const templateBody = z.object({
  name:        z.string().min(1).max(120),
  description: z.string().max(400).optional(),
  blocks:      z.array(blockSchema).optional(),
});

export const emailTemplatesRoutes = new Hono();

emailTemplatesRoutes.get("/", async (c) => {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("email_templates")
    .select("id, name, description, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ templates: data ?? [] });
});

emailTemplatesRoutes.post("/", async (c) => {
  const json   = await c.req.json().catch(() => ({}));
  const parsed = templateBody.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("email_templates")
    .insert({ name: parsed.data.name, description: parsed.data.description ?? '', blocks: parsed.data.blocks ?? [] })
    .select("*")
    .single();
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ template: data }, 201);
});

emailTemplatesRoutes.get("/:id", async (c) => {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("email_templates")
    .select("*")
    .eq("id", c.req.param("id"))
    .single();
  if (error || !data) throw new HTTPException(404, { message: "Template not found" });
  return c.json({ template: data });
});

emailTemplatesRoutes.patch("/:id", async (c) => {
  const json   = await c.req.json().catch(() => ({}));
  const parsed = templateBody.partial().safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("email_templates")
    .update(parsed.data)
    .eq("id", c.req.param("id"))
    .select("*")
    .single();
  if (error || !data) throw new HTTPException(404, { message: "Template not found" });
  return c.json({ template: data });
});

emailTemplatesRoutes.delete("/:id", async (c) => {
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("email_templates")
    .delete()
    .eq("id", c.req.param("id"));
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ ok: true });
});
