import { Hono } from "hono";
import { z } from "zod";
import { listNextTopics, refreshTopicsFromShift } from "../services/source.js";

export const sourceRoutes = new Hono();

sourceRoutes.get("/topics", async (c) => {
  const limit = z.coerce.number().min(1).max(100).parse(c.req.query("limit") ?? "20");
  const topics = await listNextTopics(limit);
  return c.json({ topics });
});

sourceRoutes.post("/refresh", async (c) => {
  const result = await refreshTopicsFromShift();
  return c.json(result);
});
