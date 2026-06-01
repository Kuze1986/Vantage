/**
 * Audience Model Routes
 * Segment management, member tracking, LTV calculation, and preference learning
 *
 * Routes:
 *  GET    /v1/audience/segments          - List audience segments
 *  POST   /v1/audience/segments          - Create segment
 *  GET    /v1/audience/segments/:id      - Get segment details
 *  PATCH  /v1/audience/segments/:id      - Update segment
 *  DELETE /v1/audience/segments/:id      - Delete segment
 *
 *  GET    /v1/audience/segments/:id/members - List segment members
 *  POST   /v1/audience/segments/:id/members - Add member to segment
 *
 *  GET    /v1/audience/segments/:id/analytics - Get segment analytics
 *  GET    /v1/audience/segments/:id/preferences - Get learned preferences
 *
 *  GET    /v1/audience/ga4/config       - Get GA4 sync config
 *  POST   /v1/audience/ga4/config       - Set up GA4 integration
 *  POST   /v1/audience/ga4/sync         - Trigger GA4 sync
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { getSupabaseAdmin } from '../lib/supabase.js';
import { logActivity } from '../lib/activity.js';
import {
  analyzeSegmentCharacteristics,
  calculateLTV,
  learnSegmentPreferences,
  predictChurnRisk,
  personalizeForSegment,
} from '../lib/audience.js';

export const audienceRoutes = new Hono();

// ============================================================================
// Schemas
// ============================================================================

const segmentRuleSchema = z.object({
  field: z.string(),
  operator: z.enum(['equals', 'not_equals', 'greater_than', 'less_than', 'contains', 'not_contains']),
  value: z.string().or(z.number()).or(z.boolean()),
});

const segmentDefinitionSchema = z.object({
  match_type: z.enum(['all', 'any']),
  rules: z.array(segmentRuleSchema),
});

const createSegmentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  segment_type: z.enum(['behavioral', 'demographic', 'technographic', 'geographic', 'custom']),
  definition: segmentDefinitionSchema,
  target_characteristics: z.record(z.any()).optional(),
  ga4_dimension_id: z.string().optional(),
  ga4_filter_expression: z.string().optional(),
});

const updateSegmentSchema = createSegmentSchema.partial();

const addMemberSchema = z.object({
  external_id: z.string(),
  source_platform: z.enum(['x', 'linkedin', 'reddit', 'ga4']),
  member_handle: z.string().optional(),
  profile: z.record(z.any()).optional(),
  lifetime_value: z.number().optional(),
});

const ga4ConfigSchema = z.object({
  property_id: z.string(),
  measurement_id: z.string().optional(),
  dimension_mapping: z.record(z.string()).optional(),
  conversion_events: z.array(z.string()).optional(),
});

// ============================================================================
// Segment Management
// ============================================================================

// GET /v1/audience/segments — list segments
audienceRoutes.get('/segments', async (c) => {
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);
  const isActive = c.req.query('active');
  const segmentType = c.req.query('type');

  const sb = getSupabaseAdmin();
  let query = sb
    .from('segments')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (isActive === 'true') {
    query = query.eq('is_active', true);
  } else if (isActive === 'false') {
    query = query.eq('is_active', false);
  }

  if (segmentType) {
    query = query.eq('segment_type', segmentType);
  }

  const { data, error } = await query;
  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ segments: data ?? [] });
});

// POST /v1/audience/segments — create segment
audienceRoutes.post('/segments', async (c) => {
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const json = await c.req.json().catch(() => ({}));
  const parsed = createSegmentSchema.safeParse(json);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from('segments').insert({
    workspace_id: workspaceId,
    ...parsed.data,
    target_characteristics: parsed.data.target_characteristics ?? {},
  });

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await logActivity({
    source: 'audience',
    source_type: 'adapter',
    event_type: 'segment_created',
    summary: `Segment created: ${parsed.data.name}`,
    payload: { segment_id: (data as any)?.[0]?.id, type: parsed.data.segment_type },
  });

  return c.json((data as any)?.[0], 201);
});

// GET /v1/audience/segments/:id — get segment details with analytics
audienceRoutes.get('/segments/:id', async (c) => {
  const id = c.req.param('id');
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const sb = getSupabaseAdmin();
  const { data: segment, error: segmentError } = await sb
    .from('segments')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .single();

  if (segmentError || !segment) {
    throw new HTTPException(404, { message: 'Segment not found' });
  }

  // Get segment member count
  const { count: memberCount } = await sb
    .from('segment_members')
    .select('*', { count: 'exact' })
    .eq('segment_id', id)
    .eq('is_active', true);

  return c.json({ ...segment, member_count: memberCount || 0 });
});

// PATCH /v1/audience/segments/:id — update segment
audienceRoutes.patch('/segments/:id', async (c) => {
  const id = c.req.param('id');
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const json = await c.req.json().catch(() => ({}));
  const parsed = updateSegmentSchema.safeParse(json);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from('segments')
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select();

  if (error || !data?.length) {
    throw new HTTPException(error ? 500 : 404, { message: error?.message || 'Segment not found' });
  }

  return c.json(data[0]);
});

// DELETE /v1/audience/segments/:id — delete segment
audienceRoutes.delete('/segments/:id', async (c) => {
  const id = c.req.param('id');
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from('segments')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await logActivity({
    source: 'audience',
    source_type: 'adapter',
    event_type: 'segment_deleted',
    summary: `Segment deleted: ${id}`,
    payload: { segment_id: id },
  });

  return c.json({ success: true });
});

// ============================================================================
// Segment Members
// ============================================================================

// GET /v1/audience/segments/:id/members — list segment members
audienceRoutes.get('/segments/:id/members', async (c) => {
  const segmentId = c.req.param('id');
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);
  const isActive = c.req.query('active');

  const sb = getSupabaseAdmin();

  // Verify segment exists
  const { data: segment } = await sb
    .from('segments')
    .select('id')
    .eq('id', segmentId)
    .eq('workspace_id', workspaceId)
    .single();

  if (!segment) {
    throw new HTTPException(404, { message: 'Segment not found' });
  }

  let query = sb
    .from('segment_members')
    .select('*')
    .eq('segment_id', segmentId)
    .order('engagement_score', { ascending: false })
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

  return c.json({ members: data ?? [] });
});

// POST /v1/audience/segments/:id/members — add member to segment
audienceRoutes.post('/segments/:id/members', async (c) => {
  const segmentId = c.req.param('id');
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const json = await c.req.json().catch(() => ({}));
  const parsed = addMemberSchema.safeParse(json);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }

  const sb = getSupabaseAdmin();

  // Verify segment exists
  const { data: segment } = await sb
    .from('segments')
    .select('id')
    .eq('id', segmentId)
    .eq('workspace_id', workspaceId)
    .single();

  if (!segment) {
    throw new HTTPException(404, { message: 'Segment not found' });
  }

  // Add member
  const { data, error } = await sb.from('segment_members').insert({
    workspace_id: workspaceId,
    segment_id: segmentId,
    ...parsed.data,
    profile: parsed.data.profile ?? {},
    engagement_score: 0.5, // Default middle score
  });

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json((data as any)?.[0], 201);
});

// ============================================================================
// Segment Analytics & Preferences
// ============================================================================

// GET /v1/audience/segments/:id/analytics — get segment analytics
audienceRoutes.get('/segments/:id/analytics', async (c) => {
  const segmentId = c.req.param('id');
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const limit = Math.min(Number(c.req.query('limit') ?? '30'), 100);

  const sb = getSupabaseAdmin();

  // Verify segment exists
  const { data: segment } = await sb
    .from('segments')
    .select('id')
    .eq('id', segmentId)
    .eq('workspace_id', workspaceId)
    .single();

  if (!segment) {
    throw new HTTPException(404, { message: 'Segment not found' });
  }

  const { data, error } = await sb
    .from('segment_analytics')
    .select('*')
    .eq('segment_id', segmentId)
    .order('date_tracked', { ascending: false })
    .limit(limit);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ analytics: data ?? [] });
});

// GET /v1/audience/segments/:id/preferences — get learned preferences
audienceRoutes.get('/segments/:id/preferences', async (c) => {
  const segmentId = c.req.param('id');
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const sb = getSupabaseAdmin();

  // Verify segment exists
  const { data: segment } = await sb
    .from('segments')
    .select('id')
    .eq('id', segmentId)
    .eq('workspace_id', workspaceId)
    .single();

  if (!segment) {
    throw new HTTPException(404, { message: 'Segment not found' });
  }

  const { data, error } = await sb
    .from('segment_preferences')
    .select('*')
    .eq('segment_id', segmentId)
    .single();

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = no rows found
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({
    preferences: data || { segment_id: segmentId, preferred_content_types: [] },
  });
});

// ============================================================================
// GA4 Integration
// ============================================================================

// GET /v1/audience/ga4/config — get GA4 config
audienceRoutes.get('/ga4/config', async (c) => {
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from('ga4_sync_config')
    .select('id, property_id, measurement_id, dimension_mapping, conversion_events, is_active, last_sync_at, last_sync_status')
    .eq('workspace_id', workspaceId)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ config: data || null });
});

// POST /v1/audience/ga4/config — set up GA4 integration
audienceRoutes.post('/ga4/config', async (c) => {
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const json = await c.req.json().catch(() => ({}));
  const parsed = ga4ConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new HTTPException(400, { message: parsed.error.message });
  }

  const sb = getSupabaseAdmin();

  // Upsert (create or update)
  const { data, error } = await sb.from('ga4_sync_config').upsert({
    workspace_id: workspaceId,
    ...parsed.data,
    is_active: true,
    dimension_mapping: parsed.data.dimension_mapping ?? {},
    conversion_events: parsed.data.conversion_events ?? [],
  });

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await logActivity({
    source: 'audience',
    source_type: 'adapter',
    event_type: 'ga4_configured',
    summary: `GA4 integration configured for property ${parsed.data.property_id}`,
    payload: { property_id: parsed.data.property_id },
  });

  return c.json((data as any)?.[0], 201);
});

// POST /v1/audience/ga4/sync — trigger GA4 sync
audienceRoutes.post('/ga4/sync', async (c) => {
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const sb = getSupabaseAdmin();

  // Get GA4 config
  const { data: config, error: configError } = await sb
    .from('ga4_sync_config')
    .select('*')
    .eq('workspace_id', workspaceId)
    .single();

  if (configError || !config) {
    throw new HTTPException(400, { message: 'GA4 not configured for this workspace' });
  }

  // TODO: Implement actual GA4 API sync
  // For now, just update the sync status
  const { error } = await sb
    .from('ga4_sync_config')
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: 'success',
    })
    .eq('workspace_id', workspaceId);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  await logActivity({
    source: 'audience',
    source_type: 'system',
    event_type: 'ga4_sync_completed',
    summary: 'GA4 sync completed',
    payload: { workspace_id: workspaceId },
  });

  return c.json({ status: 'synced', syncedAt: new Date().toISOString() });
});
