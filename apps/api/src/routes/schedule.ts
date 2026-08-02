import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { scheduleContentPiece } from "../services/scheduler.js";

const bodySchema = z.object({
  content_piece_id: z.string().uuid(),
  scheduled_for: z.string().optional(),
  force: z.boolean().optional(),
});

export const scheduleRoutes = new Hono();

scheduleRoutes.post("/", async (c) => {
  const json = await c.req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });
  try {
    await scheduleContentPiece(
      c.get("workspaceId"),
      parsed.data.content_piece_id,
      parsed.data.scheduled_for,
      { force: parsed.data.force },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Media") || msg.includes("Social Kit") || msg.includes("Can only schedule")) {
      throw new HTTPException(400, { message: msg });
    }
    throw e;
  }
  return c.json({ ok: true });
});
