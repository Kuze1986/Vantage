/**
 * Intelligence-insights generator
 *
 * generateInsights() (lib/intelligence.ts) has existed since the strategic-intelligence
 * migration but was never called anywhere in the codebase — intelligence_insights has
 * always been empty. This wires it to real data on a schedule.
 */

import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";
import { generateInsights, type CompetitivePost, type TrendingContent } from "../lib/intelligence.js";

const MIN_IMPRESSIONS_TO_ANALYZE = 100; // skip campaigns with too little data for a meaningful comparison

export async function generateAndStoreInsights(
  workspaceId: string,
  campaignId: string,
): Promise<{ inserted: number; skipped?: string }> {
  const sb = getSupabaseAdmin();

  const { data: campaign, error: campaignErr } = await sb
    .from("campaigns")
    .select("id, name, messaging_pillars")
    .eq("id", campaignId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (campaignErr || !campaign) return { inserted: 0, skipped: "campaign not found" };

  const { data: kpiRows } = await sb
    .from("campaign_kpi_tracking")
    .select("impressions, engagements")
    .eq("campaign_id", campaignId)
    .eq("source", "all");

  const impressions = (kpiRows ?? []).reduce((sum, r) => sum + (Number(r.impressions) || 0), 0);
  const engagements = (kpiRows ?? []).reduce((sum, r) => sum + (Number(r.engagements) || 0), 0);
  if (impressions < MIN_IMPRESSIONS_TO_ANALYZE) {
    return { inserted: 0, skipped: `insufficient data (${impressions} impressions < ${MIN_IMPRESSIONS_TO_ANALYZE})` };
  }
  const engagementRate = impressions > 0 ? engagements / impressions : 0;

  const { data: posts } = await sb
    .from("competitive_posts")
    .select("id, source_platform, source_account_name, post_content, posted_at, impressions, engagements, likes, reposts, replies, follows")
    .eq("workspace_id", workspaceId)
    .order("engagements", { ascending: false })
    .limit(5);

  const { data: trendRows } = await sb
    .from("trending_content")
    .select("id, trend_name, trend_category, trend_status, total_mentions, unique_sources, average_engagement_rate, key_messaging")
    .eq("workspace_id", workspaceId)
    .order("detected_at", { ascending: false })
    .limit(5);

  const pillars = Array.isArray(campaign.messaging_pillars) ? campaign.messaging_pillars : [];
  const messagingPillars = (pillars as { name?: string; description?: string }[])
    .filter((p) => p?.name)
    .map((p) => ({ name: String(p.name), description: String(p.description ?? "") }));

  let result;
  try {
    result = await generateInsights({
      campaignName: String(campaign.name),
      currentPerformance: { impressions, engagements, engagementRate },
      competitorPosts: (posts ?? []) as unknown as CompetitivePost[],
      trends: (trendRows ?? []) as unknown as TrendingContent[],
      messagingPillars,
    });
  } catch (err) {
    console.warn(`[insights-generator] generation failed for campaign ${campaignId}:`, err instanceof Error ? err.message : err);
    return { inserted: 0, skipped: "generation failed" };
  }

  const rows = result.insights.map((insight) => ({
    workspace_id:          workspaceId,
    campaign_id:           campaignId,
    insight_type:          insight.insight_type,
    title:                 insight.title,
    description:           insight.description,
    recommended_actions:   insight.recommended_actions,
    confidence_score:      insight.confidence_score,
    expected_impact:       insight.expected_impact,
    generated_by:          "claude",
  }));

  if (!rows.length) return { inserted: 0 };

  const { error: insErr } = await sb.from("intelligence_insights").insert(rows);
  if (insErr) {
    console.warn(`[insights-generator] insert failed for campaign ${campaignId}:`, insErr.message);
    return { inserted: 0, skipped: insErr.message };
  }

  await logActivity({
    source:       "insights-generator",
    source_type:  "system",
    event_type:   "insights_generated",
    summary:      `Generated ${rows.length} insight(s) for campaign "${campaign.name}"`,
    payload:      { campaign_id: campaignId, count: rows.length },
    workspace_id: workspaceId,
  });

  return { inserted: rows.length };
}

/** Runs generateAndStoreInsights for every active campaign in a workspace. */
export async function generateInsightsForWorkspace(workspaceId: string): Promise<{ campaignsProcessed: number; totalInserted: number }> {
  const sb = getSupabaseAdmin();
  const { data: campaigns } = await sb
    .from("campaigns")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("status", "active");

  let totalInserted = 0;
  for (const c of campaigns ?? []) {
    const { inserted } = await generateAndStoreInsights(workspaceId, c.id as string);
    totalInserted += inserted;
  }
  return { campaignsProcessed: campaigns?.length ?? 0, totalInserted };
}
