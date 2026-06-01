/**
 * Audience Model Service
 * Segmentation, behavioral tracking, and lifetime value calculations
 */

import { z } from 'zod';
import { getPreferredLLMProvider } from './llm-providers/index.js';
import type { StructuredSchema } from './llm-providers/types.js';

// ============================================================================
// Types
// ============================================================================

export interface Segment {
  id: string;
  name: string;
  description?: string;
  segment_type: 'behavioral' | 'demographic' | 'technographic' | 'geographic' | 'custom';
  definition: Record<string, any>;
  member_count: number;
  engagement_pattern?: Record<string, any>;
  preferences?: Record<string, any>;
  ltv_metrics?: Record<string, any>;
}

export interface SegmentMember {
  id: string;
  external_id: string;
  source_platform: 'x' | 'linkedin' | 'reddit' | 'ga4';
  member_handle?: string;
  profile?: Record<string, any>;
  total_interactions: number;
  lifetime_value: number;
  predicted_churn_risk: number;
  engagement_score: number;
}

export interface SegmentAnalytics {
  id: string;
  date_tracked: string;
  active_members: number;
  new_members: number;
  churned_members: number;
  total_impressions: number;
  total_engagements: number;
  average_engagement_rate: number;
}

// ============================================================================
// Segment Analysis
// ============================================================================

const segmentInsightSchema = z.object({
  key_characteristics: z.array(z.string()),
  engagement_patterns: z.object({
    peak_days: z.array(z.string()),
    peak_hours: z.array(z.number()),
    avg_posts_per_week: z.number(),
    preferred_content_types: z.array(z.string()),
  }),
  value_profile: z.object({
    avg_lifetime_value: z.number(),
    churn_risk: z.enum(['low', 'medium', 'high']),
    retention_tactics: z.array(z.string()),
  }),
  content_recommendations: z.array(z.string()),
});

type SegmentInsightOutput = z.infer<typeof segmentInsightSchema>;

interface AnalyzeSegmentInput {
  segmentName: string;
  memberCount: number;
  avgEngagementRate: number;
  preferredContentTypes: string[];
  topTopics: Record<string, number>;
  avgLifetimeValue: number;
  churnRate: number;
  recentBehaviors: string[];
}

/**
 * Generate insights about segment characteristics and optimal content strategy
 */
export async function analyzeSegmentCharacteristics(
  input: AnalyzeSegmentInput
): Promise<SegmentInsightOutput> {
  const provider = getPreferredLLMProvider();

  const topicSummary = Object.entries(input.topTopics)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([topic, score]) => `${topic} (${(score * 100).toFixed(0)}%)`)
    .join(', ');

  const prompt = `
Analyze this audience segment and provide strategic insights for content optimization.

Segment: "${input.segmentName}"
Size: ${input.memberCount.toLocaleString()} members
Engagement Rate: ${(input.avgEngagementRate * 100).toFixed(1)}%
Preferred Content: ${input.preferredContentTypes.join(', ')}
Top Topics: ${topicSummary}
Avg Lifetime Value: $${input.avgLifetimeValue.toFixed(2)}
Monthly Churn Rate: ${(input.churnRate * 100).toFixed(1)}%

Recent Behaviors:
${input.recentBehaviors.slice(0, 5).map((b) => `- ${b}`).join('\n')}

Provide:
1. 4-5 key characteristics that define this segment
2. Engagement patterns (peak days/hours, content preferences, posting frequency)
3. Value profile (LTV insights and churn mitigation strategies)
4. 3-4 specific content recommendations tailored to this segment

Return valid JSON:
{
  key_characteristics: [...],
  engagement_patterns: {
    peak_days: ["monday", "tuesday"],
    peak_hours: [9, 14],
    avg_posts_per_week: number,
    preferred_content_types: [...]
  },
  value_profile: {
    avg_lifetime_value: number,
    churn_risk: "low"|"medium"|"high",
    retention_tactics: [...]
  },
  content_recommendations: [...]
}
`;

  const schema: StructuredSchema<SegmentInsightOutput> = {
    description: 'Segment characteristics and content strategy',
    schema: segmentInsightSchema as unknown as z.ZodType<SegmentInsightOutput>,
  };

  return provider.generateStructured<SegmentInsightOutput>(prompt, schema, {
    temperature: 0.7,
    max_tokens: 1500,
  });
}

// ============================================================================
// LTV Calculation
// ============================================================================

interface LTVInput {
  totalRevenue: number;
  totalCustomers: number;
  timeWindowDays: number;
  churnRate: number;
  avgPurchaseValue: number;
  purchaseFrequency: number;
}

/**
 * Calculate customer lifetime value using multiple methods
 */
export function calculateLTV(input: LTVInput): {
  simple_ltv: number;
  cohort_ltv: number;
  predicted_ltv: number;
  confidence: number;
} {
  // Simple LTV = (Average Purchase Value × Purchase Frequency) / Churn Rate
  const simple_ltv = (input.avgPurchaseValue * input.purchaseFrequency) / Math.max(input.churnRate, 0.01);

  // Cohort LTV based on observed revenue over period
  const cohort_ltv = input.totalRevenue / Math.max(input.totalCustomers, 1);

  // Predicted LTV adjusts for churn trends
  const retentionRate = 1 - input.churnRate;
  const months = input.timeWindowDays / 30;
  const predicted_ltv =
    (input.avgPurchaseValue * input.purchaseFrequency * months) /
    (1 - retentionRate + 0.1); // Denominator prevents division by zero

  // Confidence based on data availability
  const confidence = Math.min(input.timeWindowDays / 90, 1.0); // More confident with 90+ days

  return {
    simple_ltv: Math.max(simple_ltv, 0),
    cohort_ltv: Math.max(cohort_ltv, 0),
    predicted_ltv: Math.max(predicted_ltv, 0),
    confidence: confidence,
  };
}

// ============================================================================
// Preference Learning
// ============================================================================

const preferenceSchema = z.object({
  preferred_content_types: z.array(z.string()),
  preferred_tones: z.array(z.string()),
  preferred_formats: z.array(z.string()),
  optimal_posting_times: z.object({
    best_days: z.array(z.string()),
    best_hours: z.array(z.number()),
  }),
  topic_interests: z.record(z.number()), // topic -> affinity score (0-1)
  preferred_cta_types: z.array(z.string()),
  post_length_preference: z.enum(['short', 'medium', 'long']),
});

type PreferenceOutput = z.infer<typeof preferenceSchema>;

interface LearnPreferencesInput {
  topEngagedPosts: Array<{
    contentType: string;
    tone: string;
    format: string;
    postedAt: string;
    engagementRate: number;
    topics: string[];
    postLength: number;
    hasCTA: boolean;
    ctaType?: string;
  }>;
  segmentName: string;
}

/**
 * Learn segment preferences from engagement patterns in top-performing content
 */
export async function learnSegmentPreferences(input: LearnPreferencesInput): Promise<PreferenceOutput> {
  const provider = getPreferredLLMProvider();

  // Analyze top posts for patterns
  const topPosts = input.topEngagedPosts
    .slice(0, 10)
    .map(
      (post) =>
        `[${post.contentType}/${post.tone}/${post.format}] Posted ${post.postedAt}: ${(post.engagementRate * 100).toFixed(1)}% engagement. Topics: ${post.topics.join(', ')}`
    )
    .join('\n');

  const prompt = `
Analyze these high-engagement posts from segment "${input.segmentName}" to identify preferences.

Top Posts (by engagement):
${topPosts}

Identify:
1. Preferred content types (thought_leadership, educational, entertaining, promotional)
2. Preferred tones (professional, casual, technical, inspirational, humorous)
3. Preferred formats (short_text, thread, video, carousel, infographic)
4. Optimal posting times (best days and hours)
5. Topic affinities (0-1 scores for each topic mentioned)
6. Preferred CTAs (link, comment, share, follow, none)
7. Post length preference (short <=140 chars, medium 140-280, long >280)

Return valid JSON:
{
  preferred_content_types: [...],
  preferred_tones: [...],
  preferred_formats: [...],
  optimal_posting_times: {
    best_days: ["monday", "tuesday"],
    best_hours: [9, 10, 14]
  },
  topic_interests: { topic: affinity_score (0-1) },
  preferred_cta_types: [...],
  post_length_preference: "short"|"medium"|"long"
}
`;

  const schema: StructuredSchema<PreferenceOutput> = {
    description: 'Learned segment preferences',
    schema: preferenceSchema as unknown as z.ZodType<PreferenceOutput>,
  };

  return provider.generateStructured<PreferenceOutput>(prompt, schema, {
    temperature: 0.6,
    max_tokens: 1200,
  });
}

// ============================================================================
// Churn Prediction (ML-ready)
// ============================================================================

interface ChurnIndicators {
  daysInactive: number;
  engagementTrend: 'increasing' | 'stable' | 'decreasing';
  recentInteractions: number;
  avgInteractionFrequency: number;
  lastPurchaseDaysAgo: number;
}

/**
 * Predict churn risk based on behavioral indicators
 * Returns 0-1 score; ready for integration with real ML models
 */
export function predictChurnRisk(indicators: ChurnIndicators): number {
  let riskScore = 0;

  // Inactivity score (0-0.4)
  const inactivityScore = Math.min(indicators.daysInactive / 180, 1.0) * 0.4;
  riskScore += inactivityScore;

  // Engagement trend score (0-0.3)
  const engagementTrendScore =
    indicators.engagementTrend === 'decreasing' ? 0.3 : indicators.engagementTrend === 'stable' ? 0.1 : 0;
  riskScore += engagementTrendScore;

  // Recent activity penalty (0-0.2)
  const recentActivityScore =
    indicators.recentInteractions === 0 ? 0.2 : Math.min(0.2 * (1 - indicators.recentInteractions / 5), 0.2);
  riskScore += recentActivityScore;

  // Purchase recency (0-0.1)
  const purchaseScore = Math.min(indicators.lastPurchaseDaysAgo / 365, 1.0) * 0.1;
  riskScore += purchaseScore;

  return Math.min(Math.max(riskScore, 0), 1.0);
}

// ============================================================================
// Segment-Based Content Personalization
// ============================================================================

const personalizationSchema = z.object({
  suggested_content_type: z.string(),
  suggested_tone: z.string(),
  suggested_format: z.string(),
  optimal_posting_day: z.string(),
  optimal_posting_hour: z.number(),
  recommended_topics: z.array(z.string()),
  cta_recommendation: z.string(),
  personalization_score: z.number().min(0).max(1),
});

type PersonalizationOutput = z.infer<typeof personalizationSchema>;

interface PersonalizeForSegmentInput {
  campaignTheme: string;
  segmentName: string;
  segmentPreferences: Record<string, any>;
  segmentTopics: Record<string, number>;
  campaignObjective: string;
}

/**
 * Generate segment-specific personalization recommendations for a campaign
 */
export async function personalizeForSegment(
  input: PersonalizeForSegmentInput
): Promise<PersonalizationOutput> {
  const provider = getPreferredLLMProvider();

  const topTopics = Object.entries(input.segmentTopics)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([topic]) => topic)
    .join(', ');

  const prompt = `
Personalize a campaign for a specific audience segment.

Campaign Theme: "${input.campaignTheme}"
Campaign Objective: "${input.campaignObjective}"
Target Segment: "${input.segmentName}"

Segment Preferences:
- Preferred content types: ${input.segmentPreferences.preferred_content_types?.join(', ') || 'general'}
- Preferred tones: ${input.segmentPreferences.preferred_tones?.join(', ') || 'professional'}
- Best posting times: ${input.segmentPreferences.optimal_posting_times?.best_days?.join(', ') || 'any'} at ${input.segmentPreferences.optimal_posting_times?.best_hours?.join(', ') || 'any'} hours
- Top interests: ${topTopics}

Recommend:
1. Most effective content type for this segment and theme
2. Optimal tone for this segment
3. Best format for delivery
4. Best day to post
5. Best hour to post
6. 2-3 topics most relevant to this segment
7. Most effective CTA for this segment
8. Personalization confidence score (0-1)

Return valid JSON:
{
  suggested_content_type: string,
  suggested_tone: string,
  suggested_format: string,
  optimal_posting_day: string,
  optimal_posting_hour: number,
  recommended_topics: [...],
  cta_recommendation: string,
  personalization_score: number
}
`;

  const schema: StructuredSchema<PersonalizationOutput> = {
    description: 'Segment-specific personalization recommendations',
    schema: personalizationSchema as unknown as z.ZodType<PersonalizationOutput>,
  };

  return provider.generateStructured<PersonalizationOutput>(prompt, schema, {
    temperature: 0.7,
    max_tokens: 900,
  });
}
