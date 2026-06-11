import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { runBioLoop } from "../services/bioloop.js";
import {
  analyzeVirality,
  recognizeViralPatterns,
  generateViralRecommendation,
  detectEarlyViralSignals,
  calculateSegmentViralityLift,
} from "../lib/bioloop.js";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { logActivity } from "../lib/activity.js";

export const biloopRoutes = new Hono();

// POST /v1/bioloop/run — manually trigger a BioLoop weight update cycle
biloopRoutes.post("/run", async (c) => {
  try {
    const result = await runBioLoop(c.get("workspaceId"));
    return c.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HTTPException(500, { message: msg });
  }
});

// GET /v1/bioloop/weights — list current generation weights
biloopRoutes.get("/weights", async (c) => {
  const ws = c.get("workspaceId");
  const channel = c.req.query("channel");
  const sb = getSupabaseAdmin();
  let query = sb
    .from("generation_weights")
    .select("channel_slug, pattern_key, weight, sample_size, last_updated")
    .eq("workspace_id", ws)
    .order("channel_slug")
    .order("weight", { ascending: false });

  if (channel) query = query.eq("channel_slug", channel);

  const { data, error } = await query;
  if (error) throw new HTTPException(500, { message: error.message });
  return c.json({ weights: data ?? [] });
});

// POST /v1/bioloop/analyze — analyze post for virality
const analyzeSchema = z.object({
  postContent: z.string().min(1),
  platform: z.enum(["x", "linkedin", "reddit"]),
  impressions: z.number().int().nonnegative(),
  engagements: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative(),
  reposts: z.number().int().nonnegative(),
  replies: z.number().int().nonnegative(),
  postedAgoHours: z.number().positive(),
  accountFollowers: z.number().int().nonnegative().optional(),
});

biloopRoutes.post("/analyze", async (c) => {
  try {
    const body = await c.req.json();
    const input = analyzeSchema.parse(body);

    const analysis = await analyzeVirality(input);

    const sb = getSupabaseAdmin();
    const workspaceId = c.get("workspaceId");

    // Persist signal to database
    const { data: signal, error } = await sb
      .from("viral_signals")
      .insert({
        workspace_id: workspaceId,
        source_platform: input.platform,
        source_post_id: `${input.platform}_${Date.now()}`,
        source_account_id: "auto_analyzed",
        source_account_name: "auto_analysis",
        post_content: input.postContent,
        posted_at: new Date(),
        impressions: input.impressions,
        engagements: input.engagements,
        likes: input.likes,
        reposts_shares: input.reposts,
        replies: input.replies,
        virality_score: analysis.virality_score,
        velocity_metrics: analysis.velocity_metrics,
        engagement_type: analysis.engagement_type,
        viral_characteristics: analysis.viral_characteristics,
        replicability_score: analysis.replicability_score,
      })
      .select()
      .single();

    if (error) throw new HTTPException(500, { message: error.message });

    await logActivity({
      source: "bioloop",
      source_type: "agent",
      event_type: "virality_analyzed",
      summary: `Analyzed post on ${input.platform} — virality score: ${(analysis.virality_score * 100).toFixed(0)}%`,
      payload: { signal_id: signal?.id, ...analysis },
    });

    return c.json({ signal, analysis });
  } catch (e) {
    if (e instanceof z.ZodError) {
      throw new HTTPException(400, { message: "Invalid request body" });
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new HTTPException(500, { message: msg });
  }
});

// GET /v1/bioloop/signals — list detected viral signals
biloopRoutes.get("/signals", async (c) => {
  try {
    const platform = c.req.query("platform") as
      | "x"
      | "linkedin"
      | "reddit"
      | undefined;
    const minVirality = c.req.query("min_virality");
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);

    const sb = getSupabaseAdmin();
    const workspaceId = c.get("workspaceId");

    let query = sb
      .from("viral_signals")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("analyzed_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (platform) query = query.eq("source_platform", platform);
    if (minVirality) {
      const min = parseFloat(minVirality);
      if (!isNaN(min)) query = query.gte("virality_score", min);
    }

    const { data, error, count } = await query;
    if (error) throw new HTTPException(500, { message: error.message });

    return c.json({ signals: data ?? [], total: count, limit, offset });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HTTPException(500, { message: msg });
  }
});

// POST /v1/bioloop/patterns/detect — recognize patterns from viral posts
const detectPatternsSchema = z.object({
  platform: z.enum(["x", "linkedin", "reddit"]),
  segmentId: z.string().uuid().optional(),
  minViralityScore: z.number().min(0).max(1).optional(),
});

biloopRoutes.post("/patterns/detect", async (c) => {
  try {
    const body = await c.req.json();
    const { platform, segmentId, minViralityScore } =
      detectPatternsSchema.parse(body);

    const sb = getSupabaseAdmin();
    const workspaceId = c.get("workspaceId");

    // Fetch top viral posts for pattern analysis
    let query = sb
      .from("viral_signals")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("source_platform", platform)
      .order("virality_score", { ascending: false })
      .limit(50);

    if (minViralityScore) {
      query = query.gte("virality_score", minViralityScore);
    }

    const { data: viralPosts, error: fetchError } = await query;
    if (fetchError) throw new HTTPException(500, { message: fetchError.message });

    if (!viralPosts || viralPosts.length < 3) {
      throw new HTTPException(400, {
        message: "Insufficient viral posts for pattern detection (need at least 3)",
      });
    }

    // Recognize patterns using service
    const patterns = await recognizeViralPatterns({
      viralPosts: viralPosts.map((p) => ({
        content: p.post_content || "",
        virality_score: p.virality_score || 0,
        engagement_type: p.engagement_type || "unknown",
        characteristics: p.viral_characteristics || {},
      })),
      platform,
      segmentName: segmentId ? `segment_${segmentId}` : undefined,
    });

    // Persist patterns to database
    const insertData = patterns.map((pattern: any) => ({
      workspace_id: workspaceId,
      segment_id: segmentId || null,
      source_platform: platform,
      pattern_window_days: 7,
      pattern_name: pattern.pattern_name,
      pattern_description: "",
      sample_size: viralPosts.length,
      characteristics: pattern.pattern_characteristics,
      success_indicators: pattern.success_indicators,
      reproduction_success_rate: pattern.reproduction_likelihood,
      confidence_score: 0.8,
    }));

    const { data: savedPatterns, error: insertError } = await sb
      .from("virality_patterns")
      .insert(insertData)
      .select();

    if (insertError) throw new HTTPException(500, { message: insertError.message });

    await logActivity({
      source: "bioloop",
      source_type: "agent",
      event_type: "patterns_detected",
      summary: `Detected ${patterns.length} viral patterns on ${platform}`,
      payload: { patterns: patterns.map((p: any) => p.pattern_name), sample_size: viralPosts.length },
    });

    return c.json({ patterns: savedPatterns });
  } catch (e) {
    if (e instanceof z.ZodError) {
      throw new HTTPException(400, { message: "Invalid request body" });
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new HTTPException(500, { message: msg });
  }
});

// GET /v1/bioloop/patterns — list identified viral patterns
biloopRoutes.get("/patterns", async (c) => {
  try {
    const platform = c.req.query("platform") as
      | "x"
      | "linkedin"
      | "reddit"
      | undefined;
    const segmentId = c.req.query("segment_id");
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);

    const sb = getSupabaseAdmin();
    const workspaceId = c.get("workspaceId");

    let query = sb
      .from("virality_patterns")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("reproduction_success_rate", { ascending: false })
      .range(offset, offset + limit - 1);

    if (platform) query = query.eq("source_platform", platform);
    if (segmentId) query = query.eq("segment_id", segmentId);

    const { data, error, count } = await query;
    if (error) throw new HTTPException(500, { message: error.message });

    return c.json({ patterns: data ?? [], total: count, limit, offset });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HTTPException(500, { message: msg });
  }
});

// POST /v1/bioloop/recommendations — generate viral strategy
const recommendationSchema = z.object({
  campaignTheme: z.string().min(1),
  campaignId: z.string().uuid().optional(),
  segmentId: z.string().uuid(),
  competitiveViralityBaseline: z.number().min(0).max(1).default(0.3),
});

biloopRoutes.post("/recommendations", async (c) => {
  try {
    const body = await c.req.json();
    const input = recommendationSchema.parse(body);

    const sb = getSupabaseAdmin();
    const workspaceId = c.get("workspaceId");

    // Fetch segment preferences and patterns
    const { data: segment, error: segError } = await sb
      .from("segments")
      .select("*, segment_preferences(*)")
      .eq("id", input.segmentId)
      .single();

    if (segError || !segment) {
      throw new HTTPException(404, { message: "Segment not found" });
    }

    const { data: patterns, error: patError } = await sb
      .from("virality_patterns")
      .select("*")
      .eq("workspace_id", workspaceId)
      .limit(5);

    if (patError) throw new HTTPException(500, { message: patError.message });

    // Generate recommendation using service
    const recommendation = await generateViralRecommendation({
      campaignTheme: input.campaignTheme,
      segmentName: segment.segment_type || "general",
      segmentPreferences: segment.segment_preferences?.[0] || {},
      identifiedPatterns: (patterns || []).map((p) => ({
        pattern_name: p.pattern_name,
        pattern_characteristics: p.characteristics,
        success_indicators: p.success_indicators || [],
        reproduction_likelihood: p.reproduction_success_rate || 0.5,
        best_timing: { days_of_week: [], hours_of_day: [] },
        risk_factors: [],
      })),
      competitive_virality_baseline: input.competitiveViralityBaseline,
    });

    // Persist recommendation
    const { data: saved, error: insertError } = await sb
      .from("virality_recommendations")
      .insert({
        workspace_id: workspaceId,
        campaign_id: input.campaignId || null,
        segment_id: input.segmentId,
        title: recommendation.title,
        description: recommendation.strategy_description,
        strategy: recommendation,
        expected_virality_score: recommendation.expected_virality_score,
        expected_engagement_lift: recommendation.expected_engagement_lift,
        implementation_difficulty: recommendation.implementation_difficulty,
        viral_sustainability: recommendation.sustainability,
        segment_match_score: 0.8,
        status: "new",
        generated_by: "claude",
      })
      .select()
      .single();

    if (insertError) throw new HTTPException(500, { message: insertError.message });

    await logActivity({
      source: "bioloop",
      source_type: "agent",
      event_type: "recommendation_generated",
      summary: `Generated viral strategy for campaign "${input.campaignTheme}"`,
      payload: { recommendation_id: saved?.id, segment_id: input.segmentId },
    });

    return c.json({ recommendation: saved });
  } catch (e) {
    if (e instanceof z.ZodError) {
      throw new HTTPException(400, { message: "Invalid request body" });
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new HTTPException(500, { message: msg });
  }
});

// GET /v1/bioloop/recommendations — list recommendations
biloopRoutes.get("/recommendations", async (c) => {
  try {
    const status = c.req.query("status");
    const campaignId = c.req.query("campaign_id");
    const segmentId = c.req.query("segment_id");
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);

    const sb = getSupabaseAdmin();
    const workspaceId = c.get("workspaceId");

    let query = sb
      .from("virality_recommendations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("generated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq("status", status);
    if (campaignId) query = query.eq("campaign_id", campaignId);
    if (segmentId) query = query.eq("segment_id", segmentId);

    const { data, error, count } = await query;
    if (error) throw new HTTPException(500, { message: error.message });

    return c.json({ recommendations: data ?? [], total: count, limit, offset });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new HTTPException(500, { message: msg });
  }
});

// POST /v1/bioloop/boost-signals/detect — detect early viral signals
const boostSignalsSchema = z.object({
  postId: z.string(),
  platform: z.enum(["x", "linkedin", "reddit"]),
  engagements: z.number().int().nonnegative(),
  engagementsLastHour: z.number().int().nonnegative(),
  engagementsLastTwoHours: z.number().int().nonnegative(),
  topEngagerFollowerCount: z.number().int().nonnegative(),
});

biloopRoutes.post("/boost-signals/detect", async (c) => {
  try {
    const body = await c.req.json();
    const input = boostSignalsSchema.parse(body);

    const sb = getSupabaseAdmin();
    const workspaceId = c.get("workspaceId");

    // Get historical average for comparison
    const { data: recentSignals, error: fetchError } = await sb
      .from("viral_signals")
      .select("velocity_metrics")
      .eq("workspace_id", workspaceId)
      .eq("source_platform", input.platform)
      .order("analyzed_at", { ascending: false })
      .limit(20);

    if (fetchError) throw new HTTPException(500, { message: fetchError.message });

    const avgEngagementPerHour =
      (recentSignals?.reduce(
        (sum, s) => sum + ((s.velocity_metrics as any)?.engagement_rate_per_hour || 0),
        0
      ) || 0) / (recentSignals?.length || 1) || 1;

    const avgTopEngagerFollowers =
      (recentSignals?.length || 1) > 0 ? 50000 : 10000; // Fallback estimate

    // Detect early signals
    const { signals, viral_probability } = detectEarlyViralSignals(
      {
        engagements: input.engagements,
        engagementsLastHour: input.engagementsLastHour,
        engagementsLastTwoHours: input.engagementsLastTwoHours,
        topEngagerFollowerCount: input.topEngagerFollowerCount,
      },
      {
        engagementsPerHour: avgEngagementPerHour,
        avgTopEngagerFollowers: avgTopEngagerFollowers,
      }
    );

    // Persist boost signal
    const { data: boostSignal, error: insertError } = await sb
      .from("virality_boost_signals")
      .insert({
        workspace_id: workspaceId,
        post_id: input.postId,
        platform: input.platform,
        signals: Object.entries(signals).map(([key, value]) => ({
          signal_type: key,
          score: value ? 1 : 0,
          detected_at: new Date(),
        })),
        viral_probability: viral_probability,
        recommended_action:
          viral_probability > 0.7 ? "amplify" : viral_probability > 0.5 ? "watch" : "participate",
      })
      .select()
      .single();

    if (insertError) throw new HTTPException(500, { message: insertError.message });

    await logActivity({
      source: "bioloop",
      source_type: "agent",
      event_type: "boost_signals_detected",
      summary: `Detected early viral signals on ${input.platform} post — ${(viral_probability * 100).toFixed(0)}% probability`,
      payload: { boost_signal_id: boostSignal?.id, signals, viral_probability },
    });

    return c.json({ boostSignal, signals, viral_probability });
  } catch (e) {
    if (e instanceof z.ZodError) {
      throw new HTTPException(400, { message: "Invalid request body" });
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new HTTPException(500, { message: msg });
  }
});
