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
import type { ChannelSlug } from '@vantage/prompts';
import {
  buildDemoForgePayload,
  DEFAULT_BRAND_ID,
  listDemoForgeTemplates,
  PRODUCT_STILL_MODE_ROTATION,
  resolveBrandId,
  resolveTemplateId,
} from '../lib/demoforge-templates.js';
import { loadProductProfile } from '../lib/product-profile.js';
import { launchStatusForMedia } from '../lib/auto-queue.js';
import { listShiftPacks, getShiftPack } from '../lib/shift-packs.js';
import { syncCampaignKpis } from '../lib/campaign-kpi.js';

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

/** Social channels allowed in campaign mix / timeline (email is out of scope). */
const CAMPAIGN_CHANNELS = [
  'x',
  'linkedin',
  'reddit',
  'threads',
  'bluesky',
  'tiktok',
  'instagram',
  'facebook',
] as const;

const channelDailySchema = z.object({ daily: z.number().int().positive() }).optional();
const channelMixSchema = z
  .object({
    x: channelDailySchema,
    linkedin: channelDailySchema,
    reddit: channelDailySchema,
    threads: channelDailySchema,
    bluesky: channelDailySchema,
    tiktok: channelDailySchema,
    instagram: channelDailySchema,
    facebook: channelDailySchema,
  })
  .refine((mix) => Object.values(mix).some((v) => v != null && typeof v.daily === 'number'), {
    message: 'channel_mix must include at least one channel with a daily target',
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
  conversion: z.number().int().nonnegative().optional(),
});

const VISUAL_TYPES = ['demo_video', 'product_still', 'social_graphic', 'none'] as const;

const createCampaignSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  start_date: z.string().date(),
  end_date: z.string().date(),
  cadence_config: cadenceConfigSchema,
  messaging_pillars: z.array(messagingPillarSchema),
  channel_mix: channelMixSchema,
  kpi_targets: kpiTargetsSchema,
  default_brand_id: z.string().min(1).nullable().optional(),
  default_demoforge_template_id: z.string().min(1).nullable().optional(),
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
  visual_type: z.enum(VISUAL_TYPES).optional(),
  demoforge_template_id: z.string().optional(),
  brand_id: z.string().optional(),
});

const timelineDaySchema = z.object({
  day_number: z.number().int().nonnegative(),
  date_scheduled: z.string().date(),
  messaging_pillar_id: z.string().optional(),
  content_type: z
    .enum(['promotional', 'educational', 'engagement', 'behind_the_scenes', 'mixed'])
    .optional(),
  primary_channel: z.enum(CAMPAIGN_CHANNELS),
  secondary_channels: z.array(z.enum(CAMPAIGN_CHANNELS)).optional(),
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

// GET /v1/campaigns/meta/shift-packs — curated Shift content packs
campaignRoutes.get('/meta/shift-packs', async (c) => {
  return c.json({ packs: listShiftPacks() });
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

// DELETE /v1/campaigns/:id/timeline/:day — remove a single timeline day
campaignRoutes.delete('/:id/timeline/:day', async (c) => {
  const campaignId = c.req.param('id');
  const dayNumber = Number(c.req.param('day'));
  const workspaceId = c.req.header('x-workspace-id');
  if (!workspaceId) {
    throw new HTTPException(400, { message: 'x-workspace-id header is required' });
  }

  const sb = getSupabaseAdmin();

  const { data: campaign, error: campaignError } = await sb
    .from('campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('workspace_id', workspaceId)
    .single();

  if (campaignError || !campaign) {
    throw new HTTPException(404, { message: 'Campaign not found' });
  }

  const { error } = await sb
    .from('campaign_timeline')
    .delete()
    .eq('campaign_id', campaignId)
    .eq('day_number', dayNumber);

  if (error) {
    throw new HTTPException(500, { message: error.message });
  }

  return c.json({ success: true });
});

// ============================================================================
// AI Timeline Generation
// ============================================================================

const CONTENT_TYPES = ['promotional', 'educational', 'engagement', 'behind_the_scenes', 'mixed'] as const;
const CHANNELS = CAMPAIGN_CHANNELS;

// The LLM frequently drifts on these fields (e.g. emits a numeric pillar index
// instead of the UUID, or an off-enum channel/content_type). Validation here is
// intentionally permissive — the downstream normalization below re-checks every
// value against the real pillar ids / channels and supplies safe fallbacks, so a
// single bad field must not reject the entire timeline.
const generatedDaySchema = z.object({
  messaging_pillar_id: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
  content_type: z.enum(CONTENT_TYPES).optional().catch(undefined),
  primary_channel: z.enum(CHANNELS).optional().catch(undefined),
  // Soft parse — normalization fills secondaries from channel_mix regardless.
  secondary_channels: z.array(z.string()).optional().catch([]),
  content_idea: z.object({
    title: z.string(),
    outline: z.string(),
    visual_type: z.enum(VISUAL_TYPES).optional().catch(undefined),
    demoforge_template_id: z.string().optional().nullable(),
    brand_id: z.string().optional().nullable(),
  }),
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

  const templates = listDemoForgeTemplates();
  const templateList = templates.length
    ? templates.map((t) => `${t.id} (${t.format}${t.name ? ` — ${t.name}` : ''})`).join('; ')
    : 'shift-queue-modes (tiktok), shift-ube-university-demo (linkedin), shift-queue-reel (tiktok)';

  const prompt = `You are a senior social-media campaign strategist. Design a ${total}-day content plan for this campaign.

Campaign: ${campaign.name}
${campaign.description ? `Goal: ${campaign.description}` : ''}
Runs ${campaign.start_date} to ${campaign.end_date} (${weeks} weeks, ${periodsPerWeek} post(s) per week).

Messaging pillars (use their id values):
${pillars.length ? pillars.map((p) => `- ${p.id}: ${p.name}${p.tone ? ` (tone: ${p.tone})` : ''}${p.description ? ` — ${p.description}` : ''}`).join('\n') : '- (none defined; leave messaging_pillar_id empty)'}

Available channels (ALL must appear in the plan): ${channels.join(', ')}
Channel daily targets (guidance): ${channels.map((ch) => {
    const cfg = channelMix[ch] as { daily?: number } | undefined;
    return `${ch}:${cfg?.daily ?? 1}/day`;
  }).join(', ')}
Content types: ${CONTENT_TYPES.join(', ')}
Visual types: ${VISUAL_TYPES.join(', ')}
DemoForge templates (prefer product visuals; Shift templates are defaults, others allowed): ${templateList}
Default Social Kit brand when omitted: ${DEFAULT_BRAND_ID}

For promotional/educational days prefer visual_type demo_video or product_still. Use social_graphic for quote/OG-style stills. Use none only for pure text engagement posts.
When visual_type is product_still, omit demoforge_template_id (server defaults to shift-product-stills: Queue modes → Sweep hero). For demo_video, prefer channel Shift templates or omit for channel default.

CRITICAL: For every day, set primary_channel to one available channel (rotate across days) and set secondary_channels to EVERY other available channel. Launch creates one piece per listed channel.

Return JSON: {"days":[{ "messaging_pillar_id": <one of the pillar ids or omit>, "content_type": <one of the content types>, "primary_channel": <one of the available channels>, "secondary_channels": [<all other available channels>], "content_idea": { "title": <short post idea>, "outline": <2-3 sentence brief of the post>, "visual_type": <visual type>, "demoforge_template_id": <template id or omit>, "brand_id": <brand id or omit> } }]}

Produce exactly ${total} day objects, sequenced as a coherent narrative arc (awareness → consideration → conversion). Rotate primary_channel through the available set. Respond with ONLY the JSON object.`;

  type GeneratedTimeline = z.infer<typeof generatedTimelineSchema>;
  let generated: GeneratedTimeline;
  try {
    generated = await provider.generateStructured<GeneratedTimeline>(
      prompt,
      {
        description: 'Campaign content timeline',
        schema: generatedTimelineSchema as unknown as z.ZodSchema<GeneratedTimeline>,
      },
      { max_tokens: 4000, temperature: 0.7 },
    );
  } catch (e) {
    throw new HTTPException(502, {
      message: `Timeline generation failed: ${e instanceof Error ? e.message : 'unknown error'}`,
    });
  }

  const pillarIds = new Set(pillars.map((p) => p.id));
  const days = generated.days.slice(0, total).map((d, i) => {
    // Rotate primary through the mix so every enabled channel gets a lead day.
    const rotatedPrimary = channels[i % channels.length];
    const primary =
      d.primary_channel && channels.includes(d.primary_channel)
        ? d.primary_channel
        : rotatedPrimary;
    // Always cross-post to every other enabled channel — LLM often leaves secondaries empty.
    const secondary_channels = channels.filter((ch) => ch !== primary);
    return {
      campaign_id: campaignId,
      day_number: i,
      date_scheduled: dateFor(i),
      messaging_pillar_id: d.messaging_pillar_id && pillarIds.has(d.messaging_pillar_id) ? d.messaging_pillar_id : null,
      content_type: d.content_type ?? 'mixed',
      primary_channel: primary,
      secondary_channels,
      content_ideas: [{
        id: crypto.randomUUID(),
        title: d.content_idea.title,
        outline: d.content_idea.outline,
        visual_type: d.content_idea.visual_type ?? (
          d.content_type === 'engagement' ? 'none' : 'demo_video'
        ),
        demoforge_template_id: d.content_idea.demoforge_template_id ?? undefined,
        brand_id: d.content_idea.brand_id ?? undefined,
      }],
      published_pieces: [],
    };
  });

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

// POST /v1/campaigns/:id/launch — generate + audit a content piece per day channel
// (primary_channel + each secondary_channel)
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

  // Optional { day_numbers: [...] } restricts generation to specific days.
  const body = await c.req.json().catch(() => ({}));
  const dayFilter: number[] | null = Array.isArray(body?.day_numbers)
    ? body.day_numbers.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
    : null;

  const { data: allDays } = await sb
    .from('campaign_timeline')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('day_number', { ascending: true });

  if (!allDays?.length) {
    throw new HTTPException(400, { message: 'Generate a timeline before launching' });
  }

  const timeline = dayFilter ? allDays.filter((d) => dayFilter.includes(d.day_number)) : allDays;
  if (!timeline.length) {
    throw new HTTPException(400, { message: 'No matching timeline days to generate' });
  }

  // Brand voice for generation (first row, like the cadence engine).
  const { data: voices } = await sb.from('brand_voice').select('*').eq('workspace_id', workspaceId).limit(1);
  const voice = voices?.[0];
  const brandVoiceStr = voice
    ? JSON.stringify({
        name: voice.name,
        description: voice.description,
        per_channel_tone: voice.per_channel_tone,
        off_topics: voice.off_topics,
      })
    : '{}';

  type Idea = {
    title?: string;
    outline?: string;
    visual_type?: string;
    demoforge_template_id?: string;
    brand_id?: string;
    demoforgeScript?: string;
  };

  const created: {
    content_piece_id: string;
    channel: string;
    day_number: number;
    media_status: string;
    status: string;
    demoforge_job_id?: string;
  }[] = [];
  const failures: { day_number: number; channel?: string; error: string }[] = [];

  const campaignDefaultBrand =
    typeof campaign.default_brand_id === 'string' ? campaign.default_brand_id : null;
  const campaignDefaultTemplate =
    typeof campaign.default_demoforge_template_id === 'string'
      ? campaign.default_demoforge_template_id
      : null;

  const productProfile = await loadProductProfile(workspaceId);
  const demoBaseUrl = productProfile.product_base_url || undefined;
  const allowedChannels = new Set<string>(CAMPAIGN_CHANNELS);

  for (const day of timeline) {
    const idea = (day.content_ideas as Idea[] | null)?.[0];
    if (!idea?.title) {
      failures.push({ day_number: day.day_number, error: 'No content idea on this day' });
      continue;
    }

    const secondary = Array.isArray(day.secondary_channels)
      ? (day.secondary_channels as unknown[])
      : [];
    // Prefer timeline secondaries; if empty (legacy timelines), expand from campaign channel_mix.
    const mixChannels = CHANNELS.filter((ch) => ch in ((campaign.channel_mix ?? {}) as Record<string, unknown>));
    const fallbackChannels = mixChannels.length ? mixChannels : [...CHANNELS];
    const listed = [day.primary_channel, ...secondary]
      .filter((ch): ch is string => typeof ch === 'string' && allowedChannels.has(ch));
    const channelsForDay = (
      listed.length > 1
        ? listed
        : [day.primary_channel, ...fallbackChannels.filter((ch) => ch !== day.primary_channel)]
    )
      .filter((ch): ch is string => typeof ch === 'string' && allowedChannels.has(ch))
      .filter((ch, i, arr) => arr.indexOf(ch) === i) as ChannelSlug[];

    if (!channelsForDay.length) {
      failures.push({ day_number: day.day_number, error: 'No valid channels on this day' });
      continue;
    }

    const visualType = (VISUAL_TYPES as readonly string[]).includes(idea.visual_type ?? '')
      ? (idea.visual_type as (typeof VISUAL_TYPES)[number])
      : day.content_type === 'engagement'
        ? 'none'
        : 'demo_video';
    const brandId = resolveBrandId({
      ideaBrandId: idea.brand_id,
      campaignDefaultBrandId: campaignDefaultBrand,
    });
    const topicText = `${idea.title}\n\n${idea.outline ?? ''}`.trim();
    const published = Array.isArray(day.published_pieces) ? [...day.published_pieces] : [];

    for (const channel of channelsForDay) {
      const templateId = resolveTemplateId({
        ideaTemplateId: idea.demoforge_template_id,
        campaignDefaultTemplateId: campaignDefaultTemplate,
        channel,
        visualType,
      });

      try {
        // Each channel gets its own topic so the content pipeline can own the piece.
        const { data: topic, error: topicErr } = await sb
          .from('topics')
          .insert({
            workspace_id: workspaceId,
            source_product: 'campaign',
            source_ref: campaignId,
            vertical: null,
            topic_text: topicText,
            context_payload: {
              campaign_id: campaignId,
              day_number: day.day_number,
              visual_type: visualType,
              demoforge_template_id: templateId,
              brand_id: brandId,
              channel,
            },
          })
          .select('id')
          .single();
        if (topicErr || !topic) throw new Error(topicErr?.message ?? 'Failed to create topic');

        const gen = await generateContent({
          workspace_id: workspaceId,
          channel,
          topic_text: topicText,
          vertical: null,
          brand_voice: brandVoiceStr,
        });

        let auditNotes: string | null = null;
        let auditCategory: string | null = null;
        let auditPassed = true;
        try {
          const audit = await auditContent({
            content: gen.text_preview || JSON.stringify(gen.content_payload),
            format: gen.format,
            brand_voice: brandVoiceStr,
            workspace_id: workspaceId,
          });
          auditNotes = `[${audit.verdict}] ${audit.feedback}`.slice(0, 1000);
          auditPassed = audit.verdict === 'pass';
          auditCategory = audit.verdict === 'fail' ? audit.category : null;
        } catch (auditErr) {
          // Treat audit outage as soft-fail: still produce piece for review, do not auto-queue.
          auditPassed = false;
          auditNotes = `[audit_error] ${auditErr instanceof Error ? auditErr.message : 'audit failed'}`.slice(0, 1000);
        }

        const payload: Record<string, unknown> = {
          ...gen.content_payload,
          brand_id: brandId,
          visual_type: visualType,
          demoforge_template_id: templateId,
        };
        if (visualType === 'social_graphic') {
          payload.needs_social_kit = true;
        }
        // product_still: prefer final Sweep diagram keyframe as the attached image.
        if (visualType === 'product_still') {
          payload.product_still_modes = [...PRODUCT_STILL_MODE_ROTATION];
          payload.thumbnail_preference = 'last';
        }

        let mediaStatus: 'none' | 'pending' | 'failed' = visualType === 'none' ? 'none' : 'pending';

        const scheduledFor = `${day.date_scheduled}T09:00:00Z`;
        // Audit fail → rejected (not queued). Pass + media ready → queued (autopilot).
        // Pass + media pending → approved until DemoForge / Social Kit write-back.
        const pieceStatus = !auditPassed
          ? 'rejected'
          : launchStatusForMedia(mediaStatus);

        const { data: piece, error: pieceErr } = await sb
          .from('content_pieces')
          .insert({
            workspace_id: workspaceId,
            topic_id: topic.id,
            channel_slug: channel,
            format: gen.format,
            content_payload: payload,
            status: pieceStatus,
            audit_notes: auditNotes,
            audit_category: auditCategory,
            audit_iterations: 0,
            scheduled_for: auditPassed ? scheduledFor : null,
            media_status: mediaStatus,
          })
          .select('id')
          .single();
        if (pieceErr || !piece) throw new Error(pieceErr?.message ?? 'Failed to create content piece');

        let demoforgeJobId: string | undefined;

        // Enqueue DemoForge for video / product stills (async — does not block launch).
        if (auditPassed && (visualType === 'demo_video' || visualType === 'product_still')) {
          try {
            const dfPayload = buildDemoForgePayload(templateId, demoBaseUrl, {
              // Stills stay silent/clean; videos keep captions + grade.
              captions: visualType !== 'product_still',
              colorPreset: visualType === 'product_still' ? 'clean' : 'cinematic',
            });
            const base = process.env.DEMOFORGE_URL?.trim();
            if (!base) throw new Error('DEMOFORGE_URL is not configured');
            let dfUrl = base;
            if (!dfUrl.startsWith('http://') && !dfUrl.startsWith('https://')) dfUrl = `https://${dfUrl}`;
            dfUrl = dfUrl.replace(/\/$/, '');
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            const secret = process.env.DEMOFORGE_SECRET?.trim();
            if (secret) headers['x-demoforge-secret'] = secret;
            const res = await fetch(`${dfUrl}/jobs`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                ...dfPayload,
                workspace_id: workspaceId,
                content_piece_id: piece.id,
              }),
            });
            const text = await res.text();
            let body: unknown = null;
            try { body = text ? JSON.parse(text) : null; } catch { body = text; }
            if (!res.ok) {
              const msg =
                typeof body === 'object' && body && 'error' in body
                  ? String((body as { error: string }).error)
                  : text || `demoforge ${res.status}`;
              throw new Error(msg);
            }
            demoforgeJobId =
              typeof body === 'object' && body && 'job_id' in body
                ? String((body as { job_id: string }).job_id)
                : undefined;
            payload.demoforge_job_id = demoforgeJobId;
            await sb
              .from('content_pieces')
              .update({ content_payload: payload, updated_at: new Date().toISOString() })
              .eq('id', piece.id);
          } catch (mediaErr) {
            mediaStatus = 'failed';
            const msg = mediaErr instanceof Error ? mediaErr.message : 'DemoForge enqueue failed';
            payload.media_error = msg.slice(0, 500);
            await sb
              .from('content_pieces')
              .update({
                media_status: 'failed',
                content_payload: payload,
                audit_notes: [auditNotes, `[media] ${msg}`].filter(Boolean).join('\n').slice(0, 1000),
                updated_at: new Date().toISOString(),
              })
              .eq('id', piece.id);
          }
        }

        published.push({
          content_piece_id: piece.id,
          channel,
          status: pieceStatus,
          media_status: mediaStatus,
          demoforge_job_id: demoforgeJobId,
        });
        created.push({
          content_piece_id: piece.id,
          channel,
          day_number: day.day_number,
          media_status: mediaStatus,
          status: pieceStatus,
          demoforge_job_id: demoforgeJobId,
        });
      } catch (e) {
        failures.push({
          day_number: day.day_number,
          channel,
          error: e instanceof Error ? e.message : 'unknown error',
        });
      }
    }

    // Persist all pieces generated for this day (primary + secondary channels).
    await sb
      .from('campaign_timeline')
      .update({ published_pieces: published, updated_at: new Date().toISOString() })
      .eq('id', day.id);
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

// POST /v1/campaigns/:id/add-pack — append Shift pack items as timeline days
campaignRoutes.post('/:id/add-pack', async (c) => {
  const campaignId = c.req.param('id');
  const workspaceId = c.req.header('x-workspace-id') ?? c.get('workspaceId');
  if (!workspaceId) throw new HTTPException(400, { message: 'x-workspace-id header is required' });

  const json = await c.req.json().catch(() => ({}));
  const parsed = z
    .object({
      pack_id: z.string().min(1),
      item_ids: z.array(z.string()).optional(),
    })
    .safeParse(json);
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });

  const pack = getShiftPack(parsed.data.pack_id);
  if (!pack) throw new HTTPException(404, { message: `Unknown pack: ${parsed.data.pack_id}` });

  const items = parsed.data.item_ids?.length
    ? pack.items.filter((i) => parsed.data.item_ids!.includes(i.id))
    : pack.items;
  if (!items.length) throw new HTTPException(400, { message: 'No pack items selected' });

  const sb = getSupabaseAdmin();
  const { data: campaign, error: campaignError } = await sb
    .from('campaigns')
    .select('id, start_date, end_date, messaging_pillars')
    .eq('id', campaignId)
    .eq('workspace_id', workspaceId)
    .single();
  if (campaignError || !campaign) throw new HTTPException(404, { message: 'Campaign not found' });

  const { data: existing } = await sb
    .from('campaign_timeline')
    .select('day_number, date_scheduled')
    .eq('campaign_id', campaignId)
    .order('day_number', { ascending: false })
    .limit(1);

  let nextDay = (existing?.[0]?.day_number ?? -1) + 1;
  let cursor = existing?.[0]?.date_scheduled
    ? new Date(`${existing[0].date_scheduled}T12:00:00Z`)
    : new Date(`${campaign.start_date}T12:00:00Z`);
  if (existing?.[0]?.date_scheduled) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const pillars = Array.isArray(campaign.messaging_pillars) ? campaign.messaging_pillars : [];
  const pillarId =
    pillars.length && typeof pillars[0] === 'object' && pillars[0] && 'id' in pillars[0]
      ? String((pillars[0] as { id: string }).id)
      : undefined;

  const rows = items.map((item) => {
    const dateScheduled = cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const channel = (item.primary_channel && CAMPAIGN_CHANNELS.includes(item.primary_channel as typeof CAMPAIGN_CHANNELS[number]))
      ? item.primary_channel
      : 'x';
    const day = {
      campaign_id: campaignId,
      day_number: nextDay++,
      date_scheduled: dateScheduled,
      messaging_pillar_id: pillarId,
      content_type: 'mixed' as const,
      primary_channel: channel,
      secondary_channels: [] as string[],
      content_ideas: [
        {
          id: item.id,
          title: item.title,
          outline: item.outline,
          visual_type: item.visual_type,
          demoforge_template_id: item.demoforge_template_id,
          notes: `From pack ${pack.id}`,
        },
      ],
      published_pieces: [],
    };
    return day;
  });

  const { data, error } = await sb.from('campaign_timeline').insert(rows).select();
  if (error) throw new HTTPException(500, { message: error.message });

  await logActivity({
    source: 'campaigns',
    source_type: 'adapter',
    event_type: 'campaign_pack_added',
    summary: `Added pack ${pack.id} (${rows.length} day(s)) to campaign ${campaignId}`,
    payload: { campaign_id: campaignId, pack_id: pack.id, added: rows.length },
  });

  return c.json({ added: rows.length, timeline: data ?? [] }, 201);
});

// POST /v1/campaigns/:id/refill-evergreen — append due recycle topics as timeline days
campaignRoutes.post('/:id/refill-evergreen', async (c) => {
  const campaignId = c.req.param('id');
  const workspaceId = c.req.header('x-workspace-id') ?? c.get('workspaceId');
  if (!workspaceId) throw new HTTPException(400, { message: 'x-workspace-id header is required' });

  const sb = getSupabaseAdmin();
  const { data: campaign, error: campaignError } = await sb
    .from('campaigns')
    .select('id, start_date, messaging_pillars')
    .eq('id', campaignId)
    .eq('workspace_id', workspaceId)
    .single();
  if (campaignError || !campaign) throw new HTTPException(404, { message: 'Campaign not found' });

  const nowIso = new Date().toISOString();
  const { data: topics, error: topicErr } = await sb
    .from('topics')
    .select('id, topic_text, recycle_after')
    .eq('workspace_id', workspaceId)
    .not('recycle_after', 'is', null)
    .lte('recycle_after', nowIso)
    .order('recycle_after', { ascending: true })
    .limit(14);
  if (topicErr) throw new HTTPException(500, { message: topicErr.message });
  if (!topics?.length) {
    return c.json({ added: 0, message: 'No evergreen topics due for recycle' });
  }

  const { data: existing } = await sb
    .from('campaign_timeline')
    .select('day_number, date_scheduled')
    .eq('campaign_id', campaignId)
    .order('day_number', { ascending: false })
    .limit(1);

  let nextDay = (existing?.[0]?.day_number ?? -1) + 1;
  let cursor = existing?.[0]?.date_scheduled
    ? new Date(`${existing[0].date_scheduled}T12:00:00Z`)
    : new Date(`${campaign.start_date}T12:00:00Z`);
  if (existing?.[0]?.date_scheduled) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const pillars = Array.isArray(campaign.messaging_pillars) ? campaign.messaging_pillars : [];
  const pillarId =
    pillars.length && typeof pillars[0] === 'object' && pillars[0] && 'id' in pillars[0]
      ? String((pillars[0] as { id: string }).id)
      : undefined;

  const rows = topics.map((t) => {
    const dateScheduled = cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    return {
      campaign_id: campaignId,
      day_number: nextDay++,
      date_scheduled: dateScheduled,
      messaging_pillar_id: pillarId,
      content_type: 'engagement' as const,
      primary_channel: 'linkedin',
      secondary_channels: ['x'],
      content_ideas: [
        {
          id: `evergreen-${t.id}`,
          title: String(t.topic_text).slice(0, 120),
          outline: `Evergreen recycle of topic ${t.id}: ${t.topic_text}`,
          visual_type: 'demo_video',
          demoforge_template_id: 'shift-queue-modes',
          notes: 'evergreen refill',
          source_topic_id: t.id,
        },
      ],
      published_pieces: [],
    };
  });

  const { data, error } = await sb.from('campaign_timeline').insert(rows).select();
  if (error) throw new HTTPException(500, { message: error.message });

  // Clear recycle_after so topics aren't re-added until BioLoop marks them again
  await sb
    .from('topics')
    .update({ recycle_after: null })
    .in(
      'id',
      topics.map((t) => t.id),
    );

  await logActivity({
    source: 'campaigns',
    source_type: 'adapter',
    event_type: 'campaign_evergreen_refilled',
    summary: `Refilled ${rows.length} evergreen day(s) on campaign ${campaignId}`,
    payload: { campaign_id: campaignId, added: rows.length },
  });

  return c.json({ added: rows.length, timeline: data ?? [] }, 201);
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

  // Optional backfill when UI requests a fresh sync
  if (c.req.query('sync') === '1') {
    await syncCampaignKpis(campaignId).catch(() => 0);
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
