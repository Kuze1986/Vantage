import { Hono } from "hono";
import { z } from "zod";
import { listNextTopics, refreshAllSources } from "../services/source.js";
import { refreshTopicsFromPulse } from "../services/pulse.js";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { listShiftPacks, getShiftPack } from "../lib/shift-packs.js";

export const sourceRoutes = new Hono();

// GET /v1/source/shift-packs — list curated Shift packs (same catalog as campaigns meta)
sourceRoutes.get("/shift-packs", async (c) => {
  return c.json({ packs: listShiftPacks() });
});

// POST /v1/source/shift-packs — inspect a pack (seed intake preview)
sourceRoutes.post("/shift-packs", async (c) => {
  const json = await c.req.json().catch(() => ({}));
  const packId = typeof (json as { pack_id?: string }).pack_id === "string"
    ? (json as { pack_id: string }).pack_id
    : "";
  const pack = getShiftPack(packId);
  if (!pack) return c.json({ error: `Unknown pack: ${packId}` }, 404);
  return c.json({ pack });
});

sourceRoutes.get("/topics", async (c) => {
  const ws = c.get("workspaceId");
  const limit = z.coerce.number().min(1).max(100).parse(c.req.query("limit") ?? "20");
  const topics = await listNextTopics(ws, limit);
  return c.json({ topics });
});

// Pull from Shift + Scripta
sourceRoutes.post("/refresh", async (c) => {
  const ws = c.get("workspaceId");
  const result = await refreshAllSources(ws);
  return c.json(result);
});

// Pulse Reactor: pull ranked external signals into topics
sourceRoutes.post("/pulse", async (c) => {
  const ws = c.get("workspaceId");
  // Load configured subreddits from the Reddit channel for vertical-aware scanning
  const sb = getSupabaseAdmin();
  const { data: ch } = await sb
    .from("channels")
    .select("cadence_config")
    .eq("workspace_id", ws)
    .eq("slug", "reddit")
    .maybeSingle();
  const subreddits: string[] = (ch?.cadence_config as { subreddits?: string[] } | null)?.subreddits ?? [];

  const result = await refreshTopicsFromPulse(ws, subreddits);
  return c.json(result);
});
