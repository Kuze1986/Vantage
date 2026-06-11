import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { scheduleContentPiece } from "../services/scheduler.js";

const bodySchema = z.object({
  content_piece_id: z.string().uuid(),
  scheduled_for: z.string().optional(),
});

export const scheduleRoutes = new Hono();

scheduleRoutes.post("/", async (c) => {
  const json = await c.req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });
  await scheduleContentPiece(c.get("workspaceId"), parsed.data.content_piece_id, parsed.data.scheduled_for);
  return c.json({ ok: true });
});
