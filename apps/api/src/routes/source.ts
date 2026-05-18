import { Hono } from "hono";
import { z } from "zod";
import { listNextTopics, refreshAllSources } from "../services/source.js";
import { refreshTopicsFromPulse } from "../services/pulse.js";
import { getSupabaseAdmin } from "../lib/supabase.js";

export const sourceRoutes = new Hono();

sourceRoutes.get("/topics", async (c) => {
  const limit = z.coerce.number().min(1).max(100).parse(c.req.query("limit") ?? "20");
  const topics = await listNextTopics(limit);
  return c.json({ topics });
});

// Pull from Shift + Scripta
sourceRoutes.post("/refresh", async (c) => {
  const result = await refreshAllSources();
  return c.json(result);
});

// Pulse Reactor: pull ranked external signals into topics
sourceRoutes.post("/pulse", async (c) => {
  // Load configured subreddits from the Reddit channel for vertical-aware scanning
  const sb = getSupabaseAdmin();
  const { data: ch } = await sb
    .from("channels")
    .select("cadence_config")
    .eq("slug", "reddit")
    .maybeSingle();
  const subreddits: string[] = (ch?.cadence_config as { subreddits?: string[] } | null)?.subreddits ?? [];

  const result = await refreshTopicsFromPulse(subreddits);
  return c.json(result);
});
