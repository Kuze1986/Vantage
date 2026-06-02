/**
 * Campaign Builder Routes
 * RESTful API for creating, reading, and managing multi-week social campaigns
 * with daily granularity, messaging pillars, and channel targets.
 *
 * Routes:
 *  POST   /v1/campaigns                 - Create new campaign
 *  GET    /v1/campaigns                 - List campaigns for workspace
 *  GET    /v1/campaigns/:id             - Get campaign details
 *  PATCH  /v1/campaigns/:id             - Update campaign
 *  DELETE /v1/campaigns/:id             - Delete campaign
 *
 *  GET    /v1/campaigns/:id/timeline    - Get timeline for campaign
 *  POST   /v1/campaigns/:id/timeline    - Add day(s) to timeline
 *  PATCH  /v1/campaigns/:id/timeline/:day - Update timeline day
 *
 *  GET    /v1/campaigns/:id/kpi         - Get KPI tracking for campaign
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabase.js';
import { logActivity } from '../lib/activity.js';
import { getPreferredLLMProvider } from '../lib/llm-providers/index.js';

export const campaignRoutes = new Hono();

// ============================================================================
// Schemas
// ============================================================================

const messagingPillarSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tone: z.string(),
  keyMessages: z.array(z.string()),
  targetAudience: z.string(),
});

const channelMixSchema = z.object({
  x: z.object({ daily: z.number().int().positive() }).optional(),
  linkedin: z.object({ daily: z.number().int().positive() }).optional(),
  reddit: z.object({ daily: z.number().int().positive() }).optional(),
});

const cadenceConfigSchema = z.object({
  weeks: z.number().int().positive(),
  periodsPerWeek: z.number().int().positive(),
  customPeriods: z
    .array(
      z.object({
        name: z.string(),
        daysOfWeek: z.array(z.number().int().min(0).max(6)),
      })
    )
    .optional(),
});

const kpiTargetsSchema = z.object({
  impressions: z.number().int().nonnegative().optional(),
  engagements: z.number().int().nonnegative().optional(),
  follows: z.number().int().nonnegative().optional(),
  viralityScore: z.number().nonnegative().optional(),
});

const createCampaignSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  start_date: z.string().date(),
  end_date: z.string().date(),
  cadence_config: cadenceConfigSchema,
  messaging_pillars: z.array(messagingPillarSchema),
  channel_mix: channelMixSchema,
  kpi_targets: kpiTargetsSchema,
});

const updateCampaignSchema = createCampaignSchema.partial().omit({
  start_date: true,
  end_date: true,
});

const contentIdeaSchema = z.object({
  id: z.string(),
  title: z.string(),
  outline: z.string(),
  demoforgeScript: z.string().optional(),
  notes: z.string().optional(),
});

const timelineDaySchema = z.object({
  day_number: z.number().int().nonnegative(),
  date_scheduled: z.string().date(),
  messaging_pillar_id: z.string().optional(),
  content_type: z
    .enum(['promotional', 'educational', 'engagement', 'behind_the_scenes', 'mixed'])
    .optional(),
  primary_channel: z.enum(['x', 'linkedin', 'reddit']),
  secondary_channels: z.array(z.enum(['x', 'linkedin', 'reddit'])).optional(),
  content_ideas: z.array(contentIdeaSchema).optional(),
});

// ============================================================================
// Campaign CRUD
// ============================================================================

// POST /v1/campaigns — create new campaign
campaignRoutes.post('/', async (c) => {
  const json = await c.req.json().catch(() => ({}));
  const parsed = createCampaignSchema.safeParse(json);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }

  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const userId = c.get('user').id;

  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from('campaigns').insert({
    workspace_id: workspaceId,
    created_by: userId,
    ...parsed.data,
    cadence_config: parsed.data.cadence_config,
    messaging_pillars: parsed.data.messaging_pillars,
    channel_mix: parsed.data.channel_mix,
    kpi_targets: parsed.data.kpi_targets,
  }).select().single();

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await logActivity({
    source: 'campaigns',
    source_type: 'adapter',
    event_type: 'campaign_created',
    summary: `Campaign created: ${parsed.data.name}`,
    payload: { campaign_id: (data as any)?.id, name: parsed.data.name },
  });

  return c.json(data, 201);
});

// GET /v1/campaigns — list campaigns for workspace
campaignRoutes.get('/', async (c) => {
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);
  const status = c.req.query('status');

  const sb = getSupabaseAdmin();
  let query = sb
    .from('campaigns')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ campaigns: data ?? [] });
});

// GET /v1/campaigns/:id — get campaign details
campaignRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .single();

  if (error || !data) {
    throw new HTTPException(404, { message: 'Campaign not found' });
  }

  return c.json(data);
});

// PATCH /v1/campaigns/:id — update campaign
campaignRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const json = await c.req.json().catch(() => ({}));
  const parsed = updateCampaignSchema.safeParse(json);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from('campaigns')
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select();

  if (error || !data?.length) {
    throw new HTTPException(error ? 500 : 404, { message: error?.message || 'Campaign not found' });
  }

  await logActivity({
    source: 'campaigns',
    source_type: 'adapter',
    event_type: 'campaign_updated',
    summary: `Campaign updated: ${parsed.data.name || id}`,
    payload: { campaign_id: id },
  });

  return c.json(data[0]);
});

// DELETE /v1/campaigns/:id — delete campaign
campaignRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from('campaigns')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await logActivity({
    source: 'campaigns',
    source_type: 'adapter',
    event_type: 'campaign_deleted',
    summary: `Campaign deleted: ${id}`,
    payload: { campaign_id: id },
  });

  return c.json({ success: true }, 200);
});

// ============================================================================
// Campaign Timeline
// ============================================================================

// GET /v1/campaigns/:id/timeline — get timeline for campaign
campaignRoutes.get('/:id/timeline', async (c) => {
  const campaignId = c.req.param('id');
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const sb = getSupabaseAdmin();

  // Verify campaign exists and belongs to workspace
  const { data: campaign, error: campaignError } = await sb
    .from('campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('workspace_id', workspaceId)
    .single();

  if (campaignError || !campaign) {
    throw new HTTPException(404, { message: 'Campaign not found' });
  }

  const { data, error } = await sb
    .from('campaign_timeline')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('day_number', { ascending: true });

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ timeline: data ?? [] });
});

// POST /v1/campaigns/:id/timeline — add days to timeline
campaignRoutes.post('/:id/timeline', async (c) => {
  const campaignId = c.req.param('id');
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const json = await c.req.json().catch(() => ({}));

  // Accept either a single day object or an array of days
  const days = Array.isArray(json) ? json : [json];
  const parsed = z.array(timelineDaySchema).safeParse(days);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }

  const sb = getSupabaseAdmin();

  // Verify campaign exists
  const { data: campaign, error: campaignError } = await sb
    .from('campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('workspace_id', workspaceId)
    .single();

  if (campaignError || !campaign) {
    throw new HTTPException(404, { message: 'Campaign not found' });
  }

  // Insert timeline entries
  const { data, error } = await sb.from('campaign_timeline').insert(
    parsed.data.map((day) => ({
      campaign_id: campaignId,
      ...day,
      secondary_channels: day.secondary_channels ?? [],
      content_ideas: day.content_ideas ?? [],
    }))
  );

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await logActivity({
    source: 'campaigns',
    source_type: 'adapter',
    event_type: 'campaign_timeline_updated',
    summary: `Added ${parsed.data.length} day(s) to campaign timeline`,
    payload: { campaign_id: campaignId, days_count: parsed.data.length },
  });

  return c.json({ timeline_entries: data ?? [] }, 201);
});

// PATCH /v1/campaigns/:id/timeline/:day — update timeline day
campaignRoutes.patch('/:id/timeline/:day', async (c) => {
  const campaignId = c.req.param('id');
  const dayNumber = Number(c.req.param('day'));
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const json = await c.req.json().catch(() => ({}));

  const sb = getSupabaseAdmin();

  // Verify campaign exists
  const { data: campaign, error: campaignError } = await sb
    .from('campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('workspace_id', workspaceId)
    .single();

  if (campaignError || !campaign) {
    throw new HTTPException(404, { message: 'Campaign not found' });
  }

  // Update timeline entry
  const { data, error } = await sb
    .from('campaign_timeline')
    .update({
      ...json,
      updated_at: new Date().toISOString(),
    })
    .eq('campaign_id', campaignId)
    .eq('day_number', dayNumber)
    .select();

  if (error || !data?.length) {
    throw new HTTPException(error ? 500 : 404, {
      message: error?.message || 'Timeline day not found',
    });
  }

  return c.json(data[0]);
});

// ============================================================================
// Campaign KPI Tracking
// ============================================================================

// GET /v1/campaigns/:id/kpi — get KPI tracking for campaign
campaignRoutes.get('/:id/kpi', async (c) => {
  const campaignId = c.req.param('id');
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const sb = getSupabaseAdmin();

  // Verify campaign exists
  const { data: campaign, error: campaignError } = await sb
    .from('campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('workspace_id', workspaceId)
    .single();

  if (campaignError || !campaign) {
    throw new HTTPException(404, { message: 'Campaign not found' });
  }

  const { data, error } = await sb
    .from('campaign_kpi_tracking')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('date_tracked', { ascending: true });

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ kpi_tracking: data ?? [] });
});
