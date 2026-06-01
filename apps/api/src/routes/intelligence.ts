/**
 * Strategic Intelligence Routes
 * Competitive monitoring, trend detection, and AI-powered insights
 *
 * Routes:
 *  GET    /v1/intelligence/posts       - List tracked competitive posts
 *  POST   /v1/intelligence/posts       - Add/sync competitive post
 *  GET    /v1/intelligence/trends      - Get detected trends
 *  GET    /v1/intelligence/insights    - Get AI-generated insights
 *  GET    /v1/intelligence/benchmarks  - Get competitive benchmarks
 *  GET    /v1/intelligence/sources     - List monitoring sources
 *  POST   /v1/intelligence/sources     - Add monitoring source
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabase.js';
import { logActivity } from '../lib/activity.js';
import {
  analyzeCompetitivePost,
  detectTrends,
  generateInsights,
  generateBenchmarkAnalysis,
} from '../lib/intelligence.js';

export const intelligenceRoutes = new Hono();

// ============================================================================
// Schemas
// ============================================================================

const competitivePostSchema = z.object({
  source_platform: z.enum(['x', 'linkedin', 'reddit']),
  source_account_id: z.string(),
  source_account_name: z.string(),
  source_account_url: z.string().optional(),
  post_id: z.string(),
  post_url: z.string().url(),
  post_title: z.string().optional(),
  post_content: z.string(),
  posted_at: z.string().datetime().optional(),
  impressions: z.number().int().nonnegative(),
  engagements: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative(),
  reposts: z.number().int().nonnegative(),
  replies: z.number().int().nonnegative(),
  follows: z.number().int().nonnegative(),
});

const monitoringSourceSchema = z.object({
  source_type: z.enum(['competitor', 'influencer', 'industry_leader', 'partner', 'keyword']),
  source_platform: z.enum(['x', 'linkedin', 'reddit']),
  source_identifier: z.string(),
  source_name: z.string().optional(),
  source_url: z.string().url().optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  categories: z.array(z.string()).optional(),
});

// ============================================================================
// Competitive Posts
// ============================================================================

// GET /v1/intelligence/posts — list tracked competitive posts
intelligenceRoutes.get('/posts', async (c) => {
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);
  const platform = c.req.query('platform');
  const minRelevance = Number(c.req.query('min_relevance') ?? '0');

  const sb = getSupabaseAdmin();
  let query = sb
    .from('competitive_posts')
    .select('*')
    .eq('workspace_id', workspaceId)
    .gte('relevance_score', minRelevance)
    .order('posted_at', { ascending: false })
    .limit(limit);

  if (platform) {
    query = query.eq('source_platform', platform);
  }

  const { data, error } = await query;
  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ posts: data ?? [] });
});

// POST /v1/intelligence/posts — add/sync competitive post
intelligenceRoutes.post('/posts', async (c) => {
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const json = await c.req.json().catch(() => ({}));
  const parsed = competitivePostSchema.safeParse(json);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }

  // Analyze the post to extract insights
  let analysis;
  try {
    analysis = await analyzeCompetitivePost({
      id: parsed.data.post_id,
      source_platform: parsed.data.source_platform,
      source_account_name: parsed.data.source_account_name,
      post_content: parsed.data.post_content,
      posted_at: parsed.data.posted_at || new Date().toISOString(),
      impressions: parsed.data.impressions,
      engagements: parsed.data.engagements,
      likes: parsed.data.likes,
      reposts: parsed.data.reposts,
      replies: parsed.data.replies,
      follows: parsed.data.follows,
    });
  } catch (err) {
    console.error('Failed to analyze post:', err);
    analysis = null;
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from('competitive_posts').insert({
    workspace_id: workspaceId,
    ...parsed.data,
    content_themes: analysis?.themes ?? [],
    sentiment: analysis?.sentiment ?? 'neutral',
    virality_indicators: analysis?.virality_indicators,
    relevance_score: (analysis?.engagement_potential ?? 0).toFixed(2),
  });

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await logActivity({
    source: 'intelligence',
    source_type: 'adapter',
    event_type: 'competitive_post_tracked',
    summary: `Tracked post from @${parsed.data.source_account_name}`,
    payload: { post_id: parsed.data.post_id, platform: parsed.data.source_platform },
  });

  return c.json((data as any)?.[0], 201);
});

// ============================================================================
// Trends
// ============================================================================

// GET /v1/intelligence/trends — get detected trends
intelligenceRoutes.get('/trends', async (c) => {
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const status = c.req.query('status');
  const minRelevance = Number(c.req.query('min_relevance') ?? '0');
  const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);

  const sb = getSupabaseAdmin();
  let query = sb
    .from('trending_content')
    .select('*')
    .eq('workspace_id', workspaceId)
    .gte('relevance_score', minRelevance)
    .order('detected_at', { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq('trend_status', status);
  }

  const { data, error } = await query;
  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ trends: data ?? [] });
});

// POST /v1/intelligence/trends/detect — trigger trend detection
intelligenceRoutes.post('/trends/detect', async (c) => {
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const daysWindow = Math.min(Number(c.req.query('days') ?? '7'), 30);

  const sb = getSupabaseAdmin();

  // Get recent competitive posts
  const { data: posts, error: postsError } = await sb
    .from('competitive_posts')
    .select('*')
    .eq('workspace_id', workspaceId)
    .gte('posted_at', new Date(Date.now() - daysWindow * 24 * 60 * 60 * 1000).toISOString())
    .order('engagements', { ascending: false })
    .limit(50);

  if (postsError || !posts?.length) {
    throw new HTTPException(
      404,
      { message: 'No recent posts to analyze' }
    );
  }

  // Detect trends using LLM
  let trendResults;
  try {
    trendResults = await detectTrends(posts as any, daysWindow);
  } catch (err) {
    console.error('Trend detection failed:', err);
    throw new HTTPException(500, { message: 'Failed to detect trends' });
  }

  // Store detected trends
  const trends = trendResults.detected_trends.map((trend) => ({
    workspace_id: workspaceId,
    trend_name: trend.trend_name,
    trend_category: trend.category,
    trend_status: trend.status,
    detected_at: new Date(),
    key_messaging: trend.key_messages,
    sentiment_breakdown: trend.sentiment_breakdown,
    recommended_use_cases: trend.recommended_use_cases,
    total_mentions: posts.length, // Rough estimate
    unique_sources: new Set(posts.map((p: any) => p.source_account_id)).size,
  }));

  const { data, error } = await sb.from('trending_content').insert(trends);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await logActivity({
    source: 'intelligence',
    source_type: 'system',
    event_type: 'trends_detected',
    summary: `Detected ${trends.length} trends from ${posts.length} posts`,
    payload: { trend_count: trends.length, post_count: posts.length },
  });

  return c.json({ trends: data ?? [] }, 201);
});

// ============================================================================
// Insights
// ============================================================================

// GET /v1/intelligence/insights — get insights
intelligenceRoutes.get('/insights', async (c) => {
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const campaignId = c.req.query('campaign_id');
  const type = c.req.query('type');
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);

  const sb = getSupabaseAdmin();
  let query = sb
    .from('intelligence_insights')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (campaignId) query = query.eq('campaign_id', campaignId);
  if (type) query = query.eq('insight_type', type);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ insights: data ?? [] });
});

// ============================================================================
// Benchmarks
// ============================================================================

// GET /v1/intelligence/benchmarks — get competitive benchmarks
intelligenceRoutes.get('/benchmarks', async (c) => {
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const limit = Math.min(Number(c.req.query('limit') ?? '10'), 50);

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from('competitive_benchmarks')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('period_start', { ascending: false })
    .limit(limit);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ benchmarks: data ?? [] });
});

// ============================================================================
// Monitoring Sources
// ============================================================================

// GET /v1/intelligence/sources — list monitoring sources
intelligenceRoutes.get('/sources', async (c) => {
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const isActive = c.req.query('active');
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);

  const sb = getSupabaseAdmin();
  let query = sb
    .from('monitoring_sources')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('priority', { ascending: true })
    .limit(limit);

  if (isActive === 'true') {
    query = query.eq('is_active', true);
  } else if (isActive === 'false') {
    query = query.eq('is_active', false);
  }

  const { data, error } = await query;
  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ sources: data ?? [] });
});

// POST /v1/intelligence/sources — add monitoring source
intelligenceRoutes.post('/sources', async (c) => {
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const json = await c.req.json().catch(() => ({}));
  const parsed = monitoringSourceSchema.safeParse(json);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from('monitoring_sources').insert({
    workspace_id: workspaceId,
    ...parsed.data,
    categories: parsed.data.categories ?? [],
  });

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await logActivity({
    source: 'intelligence',
    source_type: 'adapter',
    event_type: 'monitoring_source_added',
    summary: `Added monitoring source: ${parsed.data.source_name || parsed.data.source_identifier}`,
    payload: { source_type: parsed.data.source_type, platform: parsed.data.source_platform },
  });

  return c.json((data as any)?.[0], 201);
});
