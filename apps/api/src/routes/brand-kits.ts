import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getSupabaseAdmin } from "../lib/supabase.js";

export const brandKitsRoutes = new Hono();

const SELECT_COLS =
  "id, name, logo_url, logo_storage_path, primary_color, secondary_color, accent_color, font_heading, font_body, created_at, updated_at";

// GET /v1/brand-kits — list brand kits for the current workspace
brandKitsRoutes.get("/", async (c) => {
  const ws = c.get("workspaceId");
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("brand_kits")
    .select(SELECT_COLS)
    .eq("workspace_id", ws)
    .order("name");
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ kits: data ?? [] });
});

// GET /v1/brand-kits/:id — get a single brand kit
brandKitsRoutes.get("/:id", async (c) => {
  const ws = c.get("workspaceId");
  const id = c.req.param("id");
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("brand_kits")
    .select(SELECT_COLS)
    .eq("id", id)
    .eq("workspace_id", ws)
    .single();
  if (error || !data) throw new HTTPException(404, { message: "Brand kit not found" });
  return c.json({ kit: data });
});

const brandKitSchema = z.object({
  name: z.string().min(1).max(120),
  logo_url: z.string().url().optional(),
  logo_storage_path: z.string().optional(),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  secondary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  font_heading: z.enum(["mono", "sans", "display"]).optional(),
  font_body: z.enum(["mono", "sans", "display"]).optional(),
});

const logoUploadSchema = z.object({
  data_url: z.string().min(1),
});

function parseDataUrl(dataUrl: string): { buffer: Buffer; contentType: string; ext: string } {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) throw new HTTPException(400, { message: "data_url must be a base64 data URL (image/png or image/jpeg)" });
  const contentType = m[1]!.toLowerCase();
  if (!contentType.startsWith("image/")) {
    throw new HTTPException(400, { message: "Logo must be an image data URL" });
  }
  const ext =
    contentType.includes("png") ? "png"
    : contentType.includes("webp") ? "webp"
    : contentType.includes("gif") ? "gif"
    : "jpg";
  const buffer = Buffer.from(m[2]!, "base64");
  if (buffer.length > 5 * 1024 * 1024) {
    throw new HTTPException(400, { message: "Logo must be 5MB or smaller" });
  }
  return { buffer, contentType, ext };
}

async function uploadLogoForKit(
  workspaceId: string,
  kitId: string,
  dataUrl: string,
): Promise<{ logo_storage_path: string; logo_url: string }> {
  const { buffer, contentType, ext } = parseDataUrl(dataUrl);
  const sb = getSupabaseAdmin();
  const path = `brand-kits/${workspaceId}/${kitId}.${ext}`;
  const { error: upErr } = await sb.storage
    .from("vantage-media")
    .upload(path, buffer, { contentType, upsert: true });
  if (upErr) throw new HTTPException(500, { message: `Logo upload failed: ${upErr.message}` });
  const { data: urlData } = sb.storage.from("vantage-media").getPublicUrl(path);
  return { logo_storage_path: path, logo_url: urlData.publicUrl };
}

// POST /v1/brand-kits — create a brand kit (optional logo data_url)
brandKitsRoutes.post("/", async (c) => {
  const ws = c.get("workspaceId");
  const json = await c.req.json().catch(() => ({}));
  const logoDataUrl =
    typeof (json as { data_url?: unknown }).data_url === "string"
      ? (json as { data_url: string }).data_url
      : undefined;
  const parsed = brandKitSchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("brand_kits")
    .insert({ ...parsed.data, workspace_id: ws })
    .select(SELECT_COLS)
    .single();

  if (error || !data) throw new HTTPException(500, { message: error?.message ?? "Failed to create brand kit" });

  if (logoDataUrl) {
    const logo = await uploadLogoForKit(ws, data.id as string, logoDataUrl);
    const { data: updated, error: upErr } = await sb
      .from("brand_kits")
      .update(logo)
      .eq("id", data.id)
      .eq("workspace_id", ws)
      .select(SELECT_COLS)
      .single();
    if (upErr || !updated) throw new HTTPException(500, { message: upErr?.message ?? "Logo save failed" });
    return c.json({ ok: true, kit: updated }, 201);
  }

  return c.json({ ok: true, kit: data }, 201);
});

// PATCH /v1/brand-kits/:id — update a brand kit
brandKitsRoutes.patch("/:id", async (c) => {
  const ws = c.get("workspaceId");
  const id = c.req.param("id");
  const json = await c.req.json().catch(() => ({}));
  const parsed = brandKitSchema.partial().safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("brand_kits")
    .update(parsed.data)
    .eq("id", id)
    .eq("workspace_id", ws)
    .select(SELECT_COLS)
    .single();

  if (error || !data) throw new HTTPException(404, { message: error?.message ?? "Brand kit not found" });
  return c.json({ ok: true, kit: data });
});

// POST /v1/brand-kits/:id/logo — upload logo data URL → Storage + kit fields
brandKitsRoutes.post("/:id/logo", async (c) => {
  const ws = c.get("workspaceId");
  const id = c.req.param("id");
  const json = await c.req.json().catch(() => ({}));
  const parsed = logoUploadSchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const sb = getSupabaseAdmin();
  const { data: existing } = await sb
    .from("brand_kits")
    .select("id")
    .eq("id", id)
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!existing) throw new HTTPException(404, { message: "Brand kit not found" });

  const logo = await uploadLogoForKit(ws, id, parsed.data.data_url);
  const { data, error } = await sb
    .from("brand_kits")
    .update(logo)
    .eq("id", id)
    .eq("workspace_id", ws)
    .select(SELECT_COLS)
    .single();
  if (error || !data) throw new HTTPException(500, { message: error?.message ?? "Logo save failed" });
  return c.json({ ok: true, kit: data });
});

// DELETE /v1/brand-kits/:id — delete a brand kit
brandKitsRoutes.delete("/:id", async (c) => {
  const ws = c.get("workspaceId");
  const id = c.req.param("id");
  const sb = getSupabaseAdmin();

  const { data: existing } = await sb
    .from("brand_kits")
    .select("id, logo_storage_path")
    .eq("id", id)
    .eq("workspace_id", ws)
    .maybeSingle();
  if (!existing) throw new HTTPException(404, { message: "Brand kit not found" });

  if (typeof existing.logo_storage_path === "string" && existing.logo_storage_path) {
    await sb.storage.from("vantage-media").remove([existing.logo_storage_path]).catch(() => undefined);
  }

  const { error } = await sb
    .from("brand_kits")
    .delete()
    .eq("id", id)
    .eq("workspace_id", ws);
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ ok: true });
});
