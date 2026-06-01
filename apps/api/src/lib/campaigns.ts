/**
 * Campaign Builder Service
 * Utilities for campaign generation, content idea creation, and timeline management
 */

import { z } from 'zod';
import { getPreferredLLMProvider } from './llm-providers/index.js';
import type { StructuredSchema } from './llm-providers/types.js';

// ============================================================================
// Types
// ============================================================================

export interface MessagingPillar {
  id: string;
  name: string;
  description: string;
  tone: string;
  keyMessages: string[];
  targetAudience: string;
}

export interface ContentIdea {
  id: string;
  title: string;
  outline: string;
  demoforgeScript?: string;
  notes?: string;
}

export interface CampaignTimelineDay {
  day_number: number;
  date_scheduled: string;
  messaging_pillar_id?: string;
  content_type: 'promotional' | 'educational' | 'engagement' | 'behind_the_scenes' | 'mixed';
  primary_channel: 'x' | 'linkedin' | 'reddit';
  secondary_channels: string[];
  content_ideas: ContentIdea[];
}

// ============================================================================
// Content Idea Generation
// ============================================================================

interface GenerateContentIdeasInput {
  campaignName: string;
  messagingPillar: MessagingPillar;
  day: CampaignTimelineDay;
  brandVoice: string;
  recentContent?: string[];
}

const contentIdeaSchema = z.object({
  id: z.string(),
  title: z.string(),
  outline: z.string(),
  demoforgeScript: z.string().optional(),
  notes: z.string().optional(),
});

const contentIdeasOutputSchema = z.object({
  ideas: z.array(contentIdeaSchema),
});

type ContentIdeasOutput = z.infer<typeof contentIdeasOutputSchema>;

/**
 * Generate content ideas for a specific campaign day using the preferred LLM provider
 * Considers the messaging pillar, target channels, and brand voice
 */
export async function generateContentIdeas(
  input: GenerateContentIdeasInput
): Promise<ContentIdea[]> {
  const provider = getPreferredLLMProvider();

  const prompt = `
You are a social media content strategist working on "${input.campaignName}".

For ${input.day.date_scheduled} (${input.day.content_type} content):
- Primary channel: ${input.day.primary_channel}
- Secondary channels: ${input.day.secondary_channels.join(', ') || 'none'}
- Messaging pillar: "${input.messagingPillar.name}"
  - Key messages: ${input.messagingPillar.keyMessages.join('; ')}
  - Target audience: ${input.messagingPillar.targetAudience}
  - Tone: ${input.messagingPillar.tone}

Brand voice: ${input.brandVoice}

${
  input.recentContent && input.recentContent.length > 0
    ? `Recent content (avoid repetition):\n${input.recentContent.map((c) => `- ${c}`).join('\n')}`
    : ''
}

Generate 3 diverse content ideas. For each, provide:
1. A catchy title (5-10 words)
2. An outline of the content structure and key talking points
3. Optional: DemoForge script (if it's a video idea, describe the screens/actions)
4. Optional: Implementation notes

Return valid JSON with structure: { ideas: [{ id, title, outline, demoforgeScript?, notes? }] }
Use UUIDs for ids.
`;

  const schema: StructuredSchema<ContentIdeasOutput> = {
    description: 'Content ideas for a campaign day',
    schema: contentIdeasOutputSchema as unknown as z.ZodType<ContentIdeasOutput>,
  };

  const result = await provider.generateStructured<ContentIdeasOutput>(prompt, schema, {
    temperature: 0.7,
    max_tokens: 2000,
  });

  return result.ideas;
}

// ============================================================================
// Timeline Generation
// ============================================================================

interface GenerateTimelineInput {
  campaignName: string;
  startDate: string;
  endDate: string;
  weeksCount: number;
  messagingPillars: MessagingPillar[];
  channelMix: Record<string, { daily: number }>;
  brandVoice: string;
}

const timelineOutputSchema = z.object({
  days: z.array(
    z.object({
      day_number: z.number(),
      messaging_pillar_id: z.string(),
      content_type: z.enum(['promotional', 'educational', 'engagement', 'behind_the_scenes', 'mixed']),
      primary_channel: z.enum(['x', 'linkedin', 'reddit']),
      secondary_channels: z.array(z.enum(['x', 'linkedin', 'reddit'])),
    })
  ),
});

type TimelineOutput = z.infer<typeof timelineOutputSchema>;

/**
 * Generate a complete campaign timeline given campaign parameters
 * Balances messaging pillars, content types, and channel distribution
 */
export async function generateTimeline(input: GenerateTimelineInput): Promise<any[]> {
  const provider = getPreferredLLMProvider();

  const daysCount = Math.floor(
    (new Date(input.endDate).getTime() - new Date(input.startDate).getTime()) / (1000 * 60 * 60 * 24)
  );

  const pillarNames = input.messagingPillars.map((p) => `"${p.name}" (${p.targetAudience})`).join(', ');

  const prompt = `
You are a social media campaign strategist. Create a detailed timeline for "${input.campaignName}".

Campaign: ${daysCount} days across ${input.weeksCount} weeks
Messaging pillars: ${pillarNames}
Channel targets: ${Object.entries(input.channelMix)
    .map(([channel, config]) => `${channel} (${config.daily}/day)`)
    .join(', ')}
Brand voice: ${input.brandVoice}

For each of the ${daysCount} days, assign:
1. A messaging pillar (rotate through them strategically)
2. A content type (mix promotional, educational, engagement, behind-the-scenes)
3. A primary channel (rotate based on targets)
4. Secondary channels (cross-post where strategic)

Rules:
- Vary content types throughout the week
- Respect daily channel targets
- Keep momentum with messaging pillar rotation
- First 3 days should establish tone/pillars
- Build toward campaign objectives

Return valid JSON: { days: [{ day_number (0-based), messaging_pillar_id, content_type, primary_channel, secondary_channels }] }
`;

  const schema: StructuredSchema<TimelineOutput> = {
    description: 'Campaign timeline structure',
    schema: timelineOutputSchema as unknown as z.ZodType<TimelineOutput>,
  };

  const result = await provider.generateStructured<TimelineOutput>(prompt, schema, {
    temperature: 0.7,
    max_tokens: 3000,
  });

  // Merge with date information
  const baseDate = new Date(input.startDate);
  return result.days.map((day) => {
    const dayDate = new Date(baseDate);
    dayDate.setDate(dayDate.getDate() + day.day_number);
    return {
      ...day,
      date_scheduled: dayDate.toISOString().split('T')[0],
    };
  });
}

// ============================================================================
// Campaign Summary / Insights
// ============================================================================

interface GenerateCampaignSummaryInput {
  campaignName: string;
  messagingPillars: MessagingPillar[];
  contentTypeDistribution: Record<string, number>;
  kpiTargets: Record<string, number>;
}

const summaryOutputSchema = z.object({
  overview: z.string(),
  strategicFocus: z.array(z.string()),
  expectedOutcomes: z.array(z.string()),
  successMetrics: z.array(z.string()),
});

type SummaryOutput = z.infer<typeof summaryOutputSchema>;

/**
 * Generate a strategic summary of the campaign to guide content creation
 */
export async function generateCampaignSummary(
  input: GenerateCampaignSummaryInput
): Promise<SummaryOutput> {
  const provider = getPreferredLLMProvider();

  const prompt = `
Analyze this social media campaign and provide strategic insights.

Campaign: ${input.campaignName}
Messaging pillars: ${input.messagingPillars.map((p) => `"${p.name}"`).join(', ')}
Content types: ${Object.entries(input.contentTypeDistribution)
    .map(([type, count]) => `${type} (${count} posts)`)
    .join(', ')}
KPI targets: ${Object.entries(input.kpiTargets)
    .map(([metric, target]) => `${metric}: ${target}`)
    .join(', ')}

Provide:
1. A 2-3 sentence overview of the campaign strategy
2. 3-4 strategic focus areas
3. 3-4 expected outcomes
4. 3-4 key success metrics to track

Return valid JSON: { overview, strategicFocus: [...], expectedOutcomes: [...], successMetrics: [...] }
`;

  const schema: StructuredSchema<SummaryOutput> = {
    description: 'Campaign strategic summary',
    schema: summaryOutputSchema as unknown as z.ZodType<SummaryOutput>,
  };

  return provider.generateStructured<SummaryOutput>(prompt, schema, {
    temperature: 0.6,
    max_tokens: 1500,
  });
}
