/**
 * BioLoop Virality Signals Service
 * Multi-platform trend detection, viral pattern recognition, and segment-aware virality analysis
 */

import { z } from 'zod';
import { getPreferredLLMProvider } from './llm-providers/index.js';
import type { StructuredSchema } from './llm-providers/types.js';

// ============================================================================
// Types
// ============================================================================

export interface ViralSignal {
  id: string;
  source_platform: 'x' | 'linkedin' | 'reddit';
  source_account_name: string;
  post_content: string;
  virality_score: number;
  velocity_metrics: Record<string, number>;
  engagement_type: string;
  viral_characteristics: Record<string, any>;
  replicability_score: number;
}

export interface ViralityPattern {
  id: string;
  pattern_name: string;
  source_platform: string;
  avg_virality_score: number;
  median_engagement_rate: number;
  reproduction_success_rate: number;
  characteristics: Record<string, any>;
}

export interface ViralityRecommendation {
  id: string;
  title: string;
  description: string;
  strategy: Record<string, any>;
  expected_virality_score: number;
  expected_engagement_lift: number;
  segment_match_score: number;
}

// ============================================================================
// Virality Detection
// ============================================================================

const viralityAnalysisSchema = z.object({
  virality_score: z.number().min(0).max(1),
  velocity_metrics: z.object({
    engagement_rate_per_hour: z.number(),
    growth_acceleration: z.number(),
    momentum_score: z.number(),
  }),
  engagement_type: z.enum(['organic_share', 'reply_driven', 'algorithm_amplified', 'community_amplified']),
  viral_characteristics: z.object({
    format: z.enum(['thread', 'video', 'image', 'text', 'mixed']),
    hooks: z.array(z.string()),
    emotional_triggers: z.array(z.string()),
    controversy_level: z.number().min(0).max(1),
  }),
  replicability_score: z.number().min(0).max(1),
  distinguishing_factors: z.array(z.string()),
});

type ViralityAnalysisOutput = z.infer<typeof viralityAnalysisSchema>;

interface AnalyzeViralityInput {
  postContent: string;
  impressions: number;
  engagements: number;
  likes: number;
  reposts: number;
  replies: number;
  postedAgoHours: number;
  platform: 'x' | 'linkedin' | 'reddit';
  accountFollowers?: number;
}

/**
 * Analyze a post to determine if it exhibits viral characteristics (growth beyond engagement)
 * Distinguishes between: high engagement (within expected range) vs. viral (exponential growth)
 */
export async function analyzeVirality(input: AnalyzeViralityInput): Promise<ViralityAnalysisOutput> {
  const provider = getPreferredLLMProvider();

  const engagementRate = input.impressions > 0 ? (input.engagements / input.impressions) * 100 : 0;
  const repostRate = input.impressions > 0 ? (input.reposts / input.impressions) * 100 : 0;
  const hourlyEngagement = input.postedAgoHours > 0 ? input.engagements / input.postedAgoHours : 0;

  // Platform baselines for expected engagement
  const platformBaselines: Record<string, { engagementRate: number; repostRate: number }> = {
    x: { engagementRate: 2.5, repostRate: 0.8 }, // X baseline
    linkedin: { engagementRate: 1.2, repostRate: 0.4 }, // LinkedIn is lower engagement
    reddit: { engagementRate: 5.0, repostRate: 2.0 }, // Reddit upvote-heavy
  };

  const baseline = platformBaselines[input.platform];
  const engagementMultiplier = engagementRate / baseline.engagementRate;
  const repostMultiplier = repostRate / baseline.repostRate;

  const prompt = `
Analyze this social media post to distinguish VIRALITY from normal engagement.

Post (${input.platform}):
"${input.postContent.substring(0, 200)}${input.postContent.length > 200 ? '...' : ''}"

Metrics:
- Impressions: ${input.impressions.toLocaleString()}
- Engagement Rate: ${engagementRate.toFixed(2)}% (Platform baseline: ${baseline.engagementRate}%, Multiple: ${engagementMultiplier.toFixed(1)}x)
- Reposts/Shares: ${input.reposts} (${repostRate.toFixed(2)}%, Platform baseline: ${baseline.repostRate}%, Multiple: ${repostMultiplier.toFixed(1)}x)
- Replies: ${input.replies}
- Likes: ${input.likes}
- Time: ${input.postedAgoHours} hours ago
- Engagement Rate Velocity: ${hourlyEngagement.toFixed(1)} engagements/hour
${input.accountFollowers ? `- Account Followers: ${input.accountFollowers.toLocaleString()}` : ''}

Virality != High Engagement. Virality = exponential growth + momentum beyond expected baseline.
If engagement multiples are 2-3x+ baseline and trending upward, it's showing viral signals.

Determine:
1. Virality score (0-1): Is this showing VIRAL growth or just normal high engagement?
2. Velocity metrics: engagement rate per hour, acceleration of growth, momentum
3. Engagement type: What's driving it? (organic shares, conversation replies, algorithm, community consensus)
4. Content format and emotional hooks that trigger sharing
5. Replicability: How reproducible is this viral pattern? (0-1)
6. Distinguishing factors that made this post go viral

Return valid JSON:
{
  virality_score: number (0=normal engagement, 1=extreme viral growth),
  velocity_metrics: {
    engagement_rate_per_hour: number,
    growth_acceleration: number (positive=accelerating, 0=linear, negative=decelerating),
    momentum_score: number (0-1: likelihood to continue growing)
  },
  engagement_type: enum,
  viral_characteristics: {
    format: enum,
    hooks: [concrete hooks observed],
    emotional_triggers: [emotions that drove sharing],
    controversy_level: number (0=none, 1=highly controversial)
  },
  replicability_score: number (0-1: can we repeat this?),
  distinguishing_factors: [what made this different]
}
`;

  const schema: StructuredSchema<ViralityAnalysisOutput> = {
    description: 'Virality analysis distinguishing viral growth from normal engagement',
    schema: viralityAnalysisSchema as unknown as z.ZodType<ViralityAnalysisOutput>,
  };

  return provider.generateStructured<ViralityAnalysisOutput>(prompt, schema, {
    temperature: 0.6,
    max_tokens: 1200,
  });
}

// ============================================================================
// Pattern Recognition
// ============================================================================

const patternSchema = z.object({
  pattern_name: z.string(),
  pattern_characteristics: z.object({
    format: z.string(),
    hooks: z.array(z.string()),
    tone: z.string(),
    typical_length: z.string(),
    call_to_action: z.string().optional(),
  }),
  success_indicators: z.array(
    z.object({
      indicator: z.string(),
      importance: z.enum(['critical', 'high', 'medium']),
      threshold: z.string(),
    })
  ),
  reproduction_likelihood: z.number().min(0).max(1),
  best_timing: z.object({
    days_of_week: z.array(z.string()),
    hours_of_day: z.array(z.number()),
  }),
  risk_factors: z.array(z.string()),
});

type PatternOutput = z.infer<typeof patternSchema>;

interface RecognizePatternInput {
  viralPosts: Array<{
    content: string;
    virality_score: number;
    engagement_type: string;
    characteristics: Record<string, any>;
  }>;
  platform: string;
  segmentName?: string;
}

/**
 * Recognize patterns across viral posts to identify replicable viral templates
 */
export async function recognizeViralPatterns(input: RecognizePatternInput): Promise<PatternOutput[]> {
  const provider = getPreferredLLMProvider();

  const topPosts = input.viralPosts
    .sort((a, b) => b.virality_score - a.virality_score)
    .slice(0, 8)
    .map(
      (p) =>
        `[${p.engagement_type}] Virality: ${(p.virality_score * 100).toFixed(0)}%\n"${p.content.substring(0, 100)}..."`
    )
    .join('\n\n');

  const prompt = `
Analyze these viral posts from ${input.platform} to identify replicable patterns.

${input.segmentName ? `Segment: ${input.segmentName}` : 'General audience'}

Top Viral Posts:
${topPosts}

Identify 2-3 distinct viral patterns present across these posts.

For each pattern, provide:
1. Pattern name (e.g., "question_driven_threads", "contrarian_takes", "emotional_story")
2. Characteristics: format, hooks, tone, typical length, CTA
3. Success indicators (critical/high/medium importance)
4. Likelihood of reproduction (0-1: how often does this pattern work?)
5. Optimal timing (best days/hours to post)
6. Risk factors (what could make it fail)

Return valid JSON:
[
  {
    pattern_name: string,
    pattern_characteristics: { format, hooks, tone, typical_length, call_to_action? },
    success_indicators: [{ indicator, importance, threshold }],
    reproduction_likelihood: number,
    best_timing: { days_of_week: [...], hours_of_day: [...] },
    risk_factors: [...]
  }
]

Be specific and actionable.
`;

  const schema: StructuredSchema<PatternOutput[]> = {
    description: 'Viral patterns identified from top posts',
    schema: z.array(patternSchema) as unknown as z.ZodType<PatternOutput[]>,
  };

  const result = await provider.generateStructured<PatternOutput[]>(prompt, schema, {
    temperature: 0.7,
    max_tokens: 2000,
  });

  return result;
}

// ============================================================================
// Virality Recommendations
// ============================================================================

const recommendationSchema = z.object({
  title: z.string(),
  strategy_description: z.string(),
  pattern_to_follow: z.string(),
  recommended_format: z.string(),
  recommended_hooks: z.array(z.string()),
  recommended_tone: z.string(),
  optimal_posting_day: z.string(),
  optimal_posting_hour: z.number(),
  call_to_action: z.string(),
  expected_virality_score: z.number().min(0).max(1),
  expected_engagement_lift: z.number().int(),
  implementation_difficulty: z.enum(['low', 'medium', 'high']),
  sustainability: z.enum(['one_time', 'short_term', 'sustained']),
  critical_success_factors: z.array(z.string()),
  risk_mitigation: z.array(z.string()),
});

type RecommendationOutput = z.infer<typeof recommendationSchema>;

interface GenerateViralRecommendationInput {
  campaignTheme: string;
  segmentName: string;
  segmentPreferences: Record<string, any>;
  identifiedPatterns: PatternOutput[];
  competitive_virality_baseline: number; // Average virality in competitive set
}

/**
 * Generate segment-specific viral content strategy recommendations
 */
export async function generateViralRecommendation(
  input: GenerateViralRecommendationInput
): Promise<RecommendationOutput> {
  const provider = getPreferredLLMProvider();

  const patternsStr = input.identifiedPatterns
    .map((p) => `- ${p.pattern_name}: ${p.pattern_characteristics.hooks.join(', ')}`)
    .join('\n');

  const prompt = `
Generate a specific viral content recommendation for a campaign.

Campaign: "${input.campaignTheme}"
Target Segment: "${input.segmentName}"

Segment Preferences:
- Content types: ${input.segmentPreferences.preferred_content_types?.join(', ') || 'general'}
- Tones: ${input.segmentPreferences.preferred_tones?.join(', ') || 'professional'}
- Posting times: ${input.segmentPreferences.optimal_posting_times?.best_days?.join(', ') || 'any'} at ${input.segmentPreferences.optimal_posting_times?.best_hours?.join(', ') || 'any'} hours

Identified Viral Patterns:
${patternsStr}

Competitive Baseline (avg virality): ${(input.competitive_virality_baseline * 100).toFixed(0)}%

Create ONE specific, actionable viral strategy that:
1. Aligns with segment preferences
2. Follows a proven viral pattern
3. Targets the campaign theme
4. Can realistically achieve 2x+ baseline virality

Be specific about what makes it viral, not just engaging.

Return valid JSON:
{
  title: string (short title),
  strategy_description: string,
  pattern_to_follow: string,
  recommended_format: string,
  recommended_hooks: [...specific hooks],
  recommended_tone: string,
  optimal_posting_day: string,
  optimal_posting_hour: number,
  call_to_action: string,
  expected_virality_score: number,
  expected_engagement_lift: integer (percent),
  implementation_difficulty: enum,
  sustainability: enum,
  critical_success_factors: [...],
  risk_mitigation: [...]
}
`;

  const schema: StructuredSchema<RecommendationOutput> = {
    description: 'Viral content strategy recommendation',
    schema: recommendationSchema as unknown as z.ZodType<RecommendationOutput>,
  };

  return provider.generateStructured<RecommendationOutput>(prompt, schema, {
    temperature: 0.7,
    max_tokens: 1500,
  });
}

// ============================================================================
// Early Viral Detection (ML-ready)
// ============================================================================

interface EarlyViralSignals {
  velocity_spike: boolean; // Engagement accelerating beyond baseline
  engagement_clustering: boolean; // Replies/shares clustered in time
  authority_endorsement: boolean; // High-follower accounts sharing
  sentiment_shift: boolean; // Sudden positive sentiment increase
  cross_platform_spillover: boolean; // Spreading to other platforms
}

/**
 * Detect early signals that a post might go viral
 * Designed to trigger real-time alerts before viral wave peaks
 */
export function detectEarlyViralSignals(
  currentMetrics: {
    engagements: number;
    engagementsLastHour: number;
    engagementsLastTwoHours: number;
    topEngagerFollowerCount: number;
  },
  historicalAverage: {
    engagementsPerHour: number;
    avgTopEngagerFollowers: number;
  }
): { signals: EarlyViralSignals; viral_probability: number } {
  const signals: EarlyViralSignals = {
    velocity_spike: currentMetrics.engagementsLastHour > historicalAverage.engagementsPerHour * 3,
    engagement_clustering: currentMetrics.engagementsLastHour > currentMetrics.engagementsLastTwoHours * 0.8, // Recent concentration
    authority_endorsement: currentMetrics.topEngagerFollowerCount > historicalAverage.avgTopEngagerFollowers * 2,
    sentiment_shift: false, // Would require sentiment API integration
    cross_platform_spillover: false, // Would require cross-platform monitoring
  };

  // Calculate viral probability (0-1)
  const signalCount = Object.values(signals).filter(Boolean).length;
  const baselineProbability = Math.min(
    (currentMetrics.engagementsLastHour / (historicalAverage.engagementsPerHour * 2)) * 0.5,
    0.5
  );
  const signalBoost = (signalCount / Object.keys(signals).length) * 0.5;
  const viral_probability = Math.min(baselineProbability + signalBoost, 1.0);

  return { signals, viral_probability };
}

// ============================================================================
// Segment-Aware Virality Weighting
// ============================================================================

/**
 * Calculate segment-specific virality impact
 * Different segments have different viral thresholds and patterns
 */
export function calculateSegmentViralityLift(
  baseViralityScore: number,
  segmentCharacteristics: {
    engagement_pattern: Record<string, any>;
    size: number;
    churn_rate: number;
  },
  viralityPattern: PatternOutput
): {
  adjusted_virality_score: number;
  lift_percentage: number;
  segment_match_strength: number;
} {
  // Base segment characteristics affect viral potential
  const sizeBoost = Math.min(Math.log(segmentCharacteristics.size + 1) / 10, 0.2); // Larger segments amplify
  const retentionBoost = (1 - segmentCharacteristics.churn_rate) * 0.15; // More stable segments spread more
  const patternMatch = viralityPattern.reproduction_likelihood; // How well pattern matches segment

  const segment_match_strength = (sizeBoost + retentionBoost + patternMatch) / 3;
  const lift_percentage = segment_match_strength * 100;
  const adjusted_virality_score = Math.min(baseViralityScore * (1 + segment_match_strength), 1.0);

  return {
    adjusted_virality_score,
    lift_percentage: Math.round(lift_percentage),
    segment_match_strength,
  };
}
