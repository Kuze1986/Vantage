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
import { generateContent } from '../services/kuze.js';
import { auditContent } from '../services/ilita.js';
import { channelFormatMap } from '@vantage/prompts';
import type { ChannelSlug } from '@vantage/prompts';

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
// AI Timeline Generation
// ============================================================================

const CONTENT_TYPES = ['promotional', 'educational', 'engagement', 'behind_the_scenes', 'mixed'] as const;
const CHANNELS = ['x', 'linkedin', 'reddit'] as const;

const generatedDaySchema = z.object({
  messaging_pillar_id: z.string().optional(),
  content_type: z.enum(CONTENT_TYPES).optional(),
  primary_channel: z.enum(CHANNELS),
  secondary_channels: z.array(z.enum(CHANNELS)).optional(),
  content_idea: z.object({ title: z.string(), outline: z.string() }),
});

const generatedTimelineSchema = z.object({ days: z.array(generatedDaySchema) });

// POST /v1/campaigns/:id/timeline/generate — AI-lay out the full timeline
campaignRoutes.post('/:id/timeline/generate', async (c) => {
  const campaignId = c.req.param('id');
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const sb = getSupabaseAdmin();

  const { data: campaign, error: campaignError } = await sb
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('workspace_id', workspaceId)
    .single();

  if (campaignError || !campaign) {
    throw new HTTPException(404, { message: 'Campaign not found' });
  }

  const cadence = (campaign.cadence_config ?? {}) as { weeks?: number; periodsPerWeek?: number };
  const weeks = Math.max(1, Number(cadence.weeks ?? 3));
  const periodsPerWeek = Math.max(1, Number(cadence.periodsPerWeek ?? 1));
  const total = Math.min(weeks * periodsPerWeek, 60); // hard cap

  const pillars = (campaign.messaging_pillars ?? []) as { id: string; name: string; tone?: string; description?: string }[];
  const channelMix = (campaign.channel_mix ?? {}) as Record<string, unknown>;
  const availableChannels = CHANNELS.filter((ch) => ch in channelMix);
  const channels = availableChannels.length ? availableChannels : [...CHANNELS];

  // Compute the scheduled date for each content day (evenly spread across the run).
  const startMs = Date.parse(`${campaign.start_date}T00:00:00Z`);
  const endMs = Date.parse(`${campaign.end_date}T00:00:00Z`);
  const span = Math.max(endMs - startMs, 0);
  const dateFor = (i: number): string => {
    const t = total <= 1 ? startMs : startMs + Math.round((span * i) / (total - 1));
    return new Date(t).toISOString().slice(0, 10);
  };

  const provider = getPreferredLLMProvider(
    typeof campaign.llm_provider === 'string' ? campaign.llm_provider : undefined,
  );

  const prompt = `You are a senior social-media campaign strategist. Design a ${total}-day content plan for this campaign.

Campaign: ${campaign.name}
${campaign.description ? `Goal: ${campaign.description}` : ''}
Runs ${campaign.start_date} to ${campaign.end_date} (${weeks} weeks, ${periodsPerWeek} post(s) per week).

Messaging pillars (use their id values):
${pillars.length ? pillars.map((p) => `- ${p.id}: ${p.name}${p.tone ? ` (tone: ${p.tone})` : ''}${p.description ? ` — ${p.description}` : ''}`).join('\n') : '- (none defined; leave messaging_pillar_id empty)'}

Available channels: ${channels.join(', ')}
Content types: ${CONTENT_TYPES.join(', ')}

Return JSON: {"days":[{ "messaging_pillar_id": <one of the pillar ids or omit>, "content_type": <one of the content types>, "primary_channel": <one of the available channels>, "secondary_channels": [<other channels>], "content_idea": { "title": <short post idea>, "outline": <2-3 sentence brief of the post> } }]}

Produce exactly ${total} day objects, sequenced as a coherent narrative arc (awareness → consideration → conversion). Vary channels and pillars sensibly. Respond with ONLY the JSON object.`;

  let generated: z.infer<typeof generatedTimelineSchema>;
  try {
    generated = await provider.generateStructured(
      prompt,
      { description: 'Campaign content timeline', schema: generatedTimelineSchema },
      { max_tokens: 4000, temperature: 0.7 },
    );
  } catch (e) {
    throw new HTTPException(502, {
      message: `Timeline generation failed: ${e instanceof Error ? e.message : 'unknown error'}`,
    });
  }

  const pillarIds = new Set(pillars.map((p) => p.id));
  const days = generated.days.slice(0, total).map((d, i) => ({
    campaign_id: campaignId,
    day_number: i,
    date_scheduled: dateFor(i),
    messaging_pillar_id: d.messaging_pillar_id && pillarIds.has(d.messaging_pillar_id) ? d.messaging_pillar_id : null,
    content_type: d.content_type ?? 'mixed',
    primary_channel: channels.includes(d.primary_channel) ? d.primary_channel : channels[0],
    secondary_channels: (d.secondary_channels ?? []).filter((ch) => channels.includes(ch) && ch !== d.primary_channel),
    content_ideas: [{ id: crypto.randomUUID(), title: d.content_idea.title, outline: d.content_idea.outline }],
    published_pieces: [],
  }));

  if (!days.length) {
    throw new HTTPException(502, { message: 'Timeline generation returned no days' });
  }

  // Replace any existing timeline, then insert the fresh plan.
  await sb.from('campaign_timeline').delete().eq('campaign_id', campaignId);
  const { data: inserted, error: insertError } = await sb
    .from('campaign_timeline')
    .insert(days)
    .select();

  if (insertError) {
    throw new HTTPException(500, { message: insertError.message });
  }

  await logActivity({
    source: 'campaigns',
    source_type: 'adapter',
    event_type: 'campaign_timeline_generated',
    summary: `AI generated ${days.length}-day timeline for ${campaign.name}`,
    payload: { campaign_id: campaignId, days_count: days.length },
  });

  return c.json({ timeline: inserted ?? [] }, 201);
});

// POST /v1/campaigns/:id/launch — generate + audit a content piece per timeline day
campaignRoutes.post('/:id/launch', async (c) => {
  const campaignId = c.req.param('id');
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const sb = getSupabaseAdmin();

  const { data: campaign, error: campaignError } = await sb
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('workspace_id', workspaceId)
    .single();

  if (campaignError || !campaign) {
    throw new HTTPException(404, { message: 'Campaign not found' });
  }

  const { data: timeline } = await sb
    .from('campaign_timeline')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('day_number', { ascending: true });

  if (!timeline?.length) {
    throw new HTTPException(400, { message: 'Generate a timeline before launching' });
  }

  // Brand voice for generation (first row, like the cadence engine).
  const { data: voices } = await sb.from('brand_voice').select('*').limit(1);
  const voice = voices?.[0];
  const brandVoiceStr = voice
    ? JSON.stringify({
        name: voice.name,
        description: voice.description,
        per_channel_tone: voice.per_channel_tone,
        off_topics: voice.off_topics,
      })
    : '{}';

  const created: { content_piece_id: string; channel: string; day_number: number }[] = [];
  const failures: { day_number: number; error: string }[] = [];

  for (const day of timeline) {
    const idea = (day.content_ideas as { title?: string; outline?: string }[] | null)?.[0];
    if (!idea?.title) {
      failures.push({ day_number: day.day_number, error: 'No content idea on this day' });
      continue;
    }
    const channel = day.primary_channel as ChannelSlug;
    try {
      // Each idea becomes a topic so the existing content pipeline can own the piece.
      const { data: topic, error: topicErr } = await sb
        .from('topics')
        .insert({
          source_product: 'campaign',
          source_ref: campaignId,
          vertical: null,
          topic_text: `${idea.title}\n\n${idea.outline ?? ''}`.trim(),
          context_payload: { campaign_id: campaignId, day_number: day.day_number },
        })
        .select('id')
        .single();
      if (topicErr || !topic) throw new Error(topicErr?.message ?? 'Failed to create topic');

      const gen = await generateContent({
        channel,
        topic_text: `${idea.title}\n\n${idea.outline ?? ''}`.trim(),
        vertical: null,
        brand_voice: brandVoiceStr,
      });

      let auditNotes: string | null = null;
      try {
        const audit = await auditContent({
          content: gen.text_preview || JSON.stringify(gen.content_payload),
          format: gen.format,
          brand_voice: brandVoiceStr,
        });
        auditNotes = `[${audit.verdict}] ${audit.feedback}`.slice(0, 1000);
      } catch {
        // Audit is best-effort; the piece is still produced for review.
      }

      const scheduledFor = `${day.date_scheduled}T09:00:00Z`;
      const { data: piece, error: pieceErr } = await sb
        .from('content_pieces')
        .insert({
          topic_id: topic.id,
          channel_slug: channel,
          format: gen.format,
          content_payload: gen.content_payload,
          status: 'approved', // approved drafts: user reviews + schedules from the Queue
          audit_notes: auditNotes,
          audit_iterations: 0,
          scheduled_for: scheduledFor,
        })
        .select('id')
        .single();
      if (pieceErr || !piece) throw new Error(pieceErr?.message ?? 'Failed to create content piece');

      // Link the generated piece back onto the timeline day.
      const published = Array.isArray(day.published_pieces) ? day.published_pieces : [];
      published.push({ content_piece_id: piece.id, channel, status: 'approved' });
      await sb
        .from('campaign_timeline')
        .update({ published_pieces: published, updated_at: new Date().toISOString() })
        .eq('id', day.id);

      created.push({ content_piece_id: piece.id, channel, day_number: day.day_number });
    } catch (e) {
      failures.push({ day_number: day.day_number, error: e instanceof Error ? e.message : 'unknown error' });
    }
  }

  if (created.length) {
    await sb
      .from('campaigns')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .eq('workspace_id', workspaceId);
  }

  await logActivity({
    source: 'campaigns',
    source_type: 'adapter',
    event_type: 'campaign_launched',
    summary: `Launched ${campaign.name}: ${created.length} piece(s) queued for review`,
    payload: { campaign_id: campaignId, created: created.length, failed: failures.length },
  });

  return c.json({ launched: created.length, failed: failures.length, pieces: created, failures }, 201);
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
