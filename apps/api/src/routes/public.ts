/**
 * Unauthenticated, public routes — landing page data.
 *
 * The marketing landing renders pre-login, so it cannot use anything under
 * `/v1` (behind authMiddleware) the way the rest of the app does. This is
 * mounted outside the authed group in index.ts, the same way /v1/webhooks is.
 */
import { Hono } from "hono";
import { getSupabaseAdmin } from "../lib/supabase.js";

export const publicRoutes = new Hono();

export interface ProofStat {
  value: string;
  label: string;
  spark: number[];
  color?: string;
}

const PROOF_DAYS = 30;
const CACHE_TTL_MS = 10 * 60 * 1000;

let cache: { at: number; stats: ProofStat[] } | null = null;

// Exported for unit tests — pure and worth testing directly rather than only
// through the route.
export function dayKeys(days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return out;
}

export function bucketByDay(keys: string[], timestamps: (string | null)[]): number[] {
  const counts = new Map(keys.map((k) => [k, 0]));
  for (const ts of timestamps) {
    if (!ts) continue;
    const day = ts.slice(0, 10);
    if (counts.has(day)) counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return keys.map((k) => counts.get(k) ?? 0);
}

/**
 * The landing page's Proof section used to show fabricated ad-buying metrics
 * (ROAS, CPA) — figures Vantage has never tracked and nothing in the schema
 * produces. This computes what the pipeline actually did for a given
 * workspace over the trailing window: real numbers, starting small, true.
 */
async function computeProof(workspaceId: string): Promise<ProofStat[]> {
  const sb = getSupabaseAdmin();
  const since = new Date(Date.now() - PROOF_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const keys = dayKeys(PROOF_DAYS);

  const [piecesRes, engagementRes, campaignsRes] = await Promise.all([
    sb.from("content_pieces")
      .select("published_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "published")
      .gte("published_at", since),
    sb.from("engagement_events")
      .select("occurred_at")
      .eq("workspace_id", workspaceId)
      .gte("occurred_at", since),
    sb.from("campaigns").select("id").eq("workspace_id", workspaceId),
  ]);

  const pieces = (piecesRes.data ?? []) as { published_at: string | null }[];
  const engagement = (engagementRes.data ?? []) as { occurred_at: string | null }[];
  const campaignIds = ((campaignsRes.data ?? []) as { id: string }[]).map((c) => c.id);

  // campaign_kpi_tracking has no workspace_id of its own (only campaign_id),
  // and PostgREST embedding can't infer the relationship through the public
  // views (see lib/workspace.ts's listWorkspacesForUser for the same
  // constraint) — so this is two queries, not one embedded select.
  let conversionsByDay = new Map<string, number>();
  let totalConversions = 0;
  if (campaignIds.length) {
    const { data } = await sb
      .from("campaign_kpi_tracking")
      .select("date_tracked, conversions")
      .in("campaign_id", campaignIds)
      .gte("date_tracked", since.slice(0, 10));
    for (const row of (data ?? []) as { date_tracked: string; conversions: number | null }[]) {
      const n = row.conversions ?? 0;
      totalConversions += n;
      conversionsByDay.set(row.date_tracked, (conversionsByDay.get(row.date_tracked) ?? 0) + n);
    }
  }

  const pieceSpark = bucketByDay(keys, pieces.map((p) => p.published_at));
  const engagementSpark = bucketByDay(keys, engagement.map((e) => e.occurred_at));
  const conversionSpark = keys.map((k) => conversionsByDay.get(k) ?? 0);
  const engagementRate = pieces.length ? engagement.length / pieces.length : 0;

  return [
    { value: String(pieces.length), label: `PIECES PUBLISHED · ${PROOF_DAYS}D`, spark: pieceSpark, color: "var(--nx-accent)" },
    { value: String(engagement.length), label: `ENGAGEMENT EVENTS · ${PROOF_DAYS}D`, spark: engagementSpark, color: "var(--nx-green)" },
    { value: `${engagementRate.toFixed(2)}x`, label: "ENGAGEMENT PER PIECE", spark: engagementSpark, color: "var(--nx-accent-2)" },
    { value: String(totalConversions), label: `SHIFT SIGNUPS ATTRIBUTED · ${PROOF_DAYS}D`, spark: conversionSpark, color: "var(--nx-silver)" },
  ];
}

// GET /v1/public/proof — landing page "Field Telemetry" stats. Unauthenticated
// by design (mounted outside authMiddleware); PUBLIC_PROOF_WORKSPACE_ID names
// which workspace's numbers are shown, so a workspace never gets surfaced on
// the public site without the operator explicitly pointing at it.
publicRoutes.get("/proof", async (c) => {
  c.header("Cache-Control", "public, max-age=300");

  const workspaceId = process.env.PUBLIC_PROOF_WORKSPACE_ID?.trim();
  if (!workspaceId) return c.json({ stats: [] });

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return c.json({ stats: cache.stats });
  }

  try {
    const stats = await computeProof(workspaceId);
    cache = { at: Date.now(), stats };
    return c.json({ stats });
  } catch {
    // Fail soft — this is a public, unauthenticated endpoint that a marketing
    // page depends on; a DB hiccup must not take the landing page down with
    // it. Serve the last good cache (even if stale) rather than an error.
    return c.json({ stats: cache?.stats ?? [] });
  }
});
