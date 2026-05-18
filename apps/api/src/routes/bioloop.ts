import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { runBioLoop } from "../services/bioloop.js";
import { getSupabaseAdmin } from "../lib/supabase.js";

export const biloopRoutes = new Hono();

// POST /v1/bioloop/run — manually trigger a BioLoop weight update cycle
biloopRoutes.post("/run", async (c) => {
  try {
    const result = await runBioLoop();
    return c.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HTTPException(500, { message: msg });
  }
});

// GET /v1/bioloop/weights — list current generation weights
biloopRoutes.get("/weights", async (c) => {
  const channel = c.req.query("channel");
  const sb = getSupabaseAdmin();
  let query = sb
    .from("generation_weights")
    .select("channel_slug, pattern_key, weight, sample_size, last_updated")
    .order("channel_slug")
    .order("weight", { ascending: false });

  if (channel) query = query.eq("channel_slug", channel);

  const { data, error } = await query;
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ weights: data ?? [] });
});
