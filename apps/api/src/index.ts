import "dotenv/config";
// Node.js < 22 has no native WebSocket — polyfill before supabase-js loads.
import { WebSocket as _WS } from "ws";
if (!("WebSocket" in globalThis)) (globalThis as Record<string, unknown>).WebSocket = _WS;
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { authMiddleware } from "./lib/auth.js";
import { logActivity } from "./lib/activity.js";
import { sourceRoutes } from "./routes/source.js";
import { generateRoutes } from "./routes/generate.js";
import { auditRoutes } from "./routes/audit.js";
import { publishRoutes } from "./routes/publish.js";
import { scheduleRoutes } from "./routes/schedule.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { webhooksRoutes } from "./routes/webhooks.js";
import { channelsAuthedRoutes } from "./routes/channels.js";
import { queueRoutes } from "./routes/queue.js";
import { subscribersRoutes } from "./routes/subscribers.js";
import { biloopRoutes } from "./routes/bioloop.js";
import { musicRoutes } from "./routes/music.js";
import { demoforgeRoutes } from "./routes/demoforge.js";
import { settingsRoutes } from "./routes/settings.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { captionsRoutes } from "./routes/captions.js";
import { emailTemplatesRoutes } from "./routes/email-templates.js";
import { soundEffectsRoutes } from "./routes/sound-effects.js";
import { campaignRoutes } from "./routes/campaigns.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { intelligenceRoutes } from "./routes/intelligence.js";
import { audienceRoutes } from "./routes/audience.js";
import { oauthCallbackGet } from "./routes/oauth-callback.js";
import { startCadenceEngine } from "./services/scheduler.js";

const app = new Hono();

const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  "*",
  cors({
    origin: (origin) => (corsOrigins.includes(origin) ? origin : corsOrigins[0]),
    allowHeaders: ["Content-Type", "Authorization", "x-workspace-id"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

app.route("/v1/webhooks", webhooksRoutes);
app.get("/v1/channels/:slug/auth/callback", (c) => oauthCallbackGet(c));

const authedV1 = new Hono();
authedV1.use("*", authMiddleware);
authedV1.route("/source", sourceRoutes);
authedV1.route("/generate", generateRoutes);
authedV1.route("/audit", auditRoutes);
authedV1.route("/publish", publishRoutes);
authedV1.route("/schedule", scheduleRoutes);
authedV1.route("/dashboard", dashboardRoutes);
authedV1.route("/channels", channelsAuthedRoutes);
authedV1.route("/queue", queueRoutes);
authedV1.route("/subscribers", subscribersRoutes);
authedV1.route("/bioloop", biloopRoutes);
authedV1.route("/music", musicRoutes);
authedV1.route("/sound-effects", soundEffectsRoutes);
authedV1.route("/demoforge", demoforgeRoutes);
authedV1.route("/workspaces", workspaceRoutes);
authedV1.route("/campaigns", campaignRoutes);
authedV1.route("/intelligence", intelligenceRoutes);
authedV1.route("/audience", audienceRoutes);
authedV1.route("/settings", settingsRoutes);
authedV1.route("/analytics", analyticsRoutes);
authedV1.route("/captions", captionsRoutes);
authedV1.route("/email-templates", emailTemplatesRoutes);

app.route("/v1", authedV1);

app.onError(async (err, c) => {
  const status = err instanceof HTTPException ? err.status : 500;
  const message = err instanceof Error ? err.message : "Unknown error";
  try {
    await logActivity({
      source: "vantage-api",
      source_type: "system",
      event_type: "error",
      summary: message.slice(0, 500),
      payload: { path: c.req.path, status, stack: err instanceof Error ? err.stack : undefined },
    });
  } catch {
    console.error("logActivity failed", err);
  }
  console.error(err);
  return c.json({ error: message }, status);
});

const port = Number(process.env.PORT ?? 8787);
console.log(`vantage-api listening on ${port}`);
serve({ fetch: app.fetch, port });

startCadenceEngine();
