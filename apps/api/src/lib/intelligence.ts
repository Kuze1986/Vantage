/**
 * Strategic Intelligence Service
 * Competitive monitoring, trend analysis, and AI-powered insights for campaign optimization
 */

import { z } from 'zod';
import { getPreferredLLMProvider } from './llm-providers/index.js';
import type { StructuredSchema } from './llm-providers/types.js';

// ============================================================================
// Types
// ============================================================================

export interface CompetitivePost {
  id: string;
  source_platform: 'x' | 'linkedin' | 'reddit';
  source_account_name: string;
  post_content: string;
  posted_at: string;
  impressions: number;
  engagements: number;
  likes: number;
  reposts: number;
  replies: number;
  follows: number;
}

export interface TrendingContent {
  id: string;
  trend_name: string;
  trend_category: string;
  trend_status: 'emerging' | 'peak' | 'declining' | 'sustained';
  total_mentions: number;
  unique_sources: number;
  average_engagement_rate: number;
  key_messaging: string[];
}

export interface Insight {
  id: string;
  insight_type: string;
  title: string;
  description: string;
  confidence_score: number;
  recommended_actions: Array<{ action: string; expected_impact: string; priority: string }>;
}

// ============================================================================
// Post Analysis
// ============================================================================

const contentThemesSchema = z.object({
  themes: z.array(z.string()),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  engagement_potential: z.number().min(0).max(1),
  virality_indicators: z.object({
    engagement_rate: z.number(),
    repost_rate: z.number(),
    trend_velocity: z.number(),
  }),
});

type ContentAnalysisOutput = z.infer<typeof contentThemesSchema>;

/**
 * Analyze a competitive post to extract themes, sentiment, and virality signals
 */
export async function analyzeCompetitivePost(post: CompetitivePost): Promise<ContentAnalysisOutput> {
  const provider = getPreferredLLMProvider();

  const engagementRate = post.impressions > 0 ? post.engagements / post.impressions : 0;
  const repostRate = post.impressions > 0 ? post.reposts / post.impressions : 0;

  const prompt = `
Analyze this social media post and extract strategic insights.

Platform: ${post.source_platform}
Author: @${post.source_account_name}
Content: "${post.post_content}"

Performance:
- Impressions: ${post.impressions.toLocaleString()}
- Engagements: ${post.engagements.toLocaleString()}
- Engagement Rate: ${(engagementRate * 100).toFixed(2)}%
- Reposts/Shares: ${post.reposts}
- Replies: ${post.replies}
- New Follows: ${post.follows}

Identify:
1. Main content themes/topics (e.g., "product announcement", "thought leadership", "behind-the-scenes")
2. Overall sentiment (positive/neutral/negative)
3. Predicted engagement potential (0-1 score)
4. Virality indicators including engagement rate, repost rate, and trend velocity

Return valid JSON: { themes: [...], sentiment, engagement_potential, virality_indicators: { engagement_rate, repost_rate, trend_velocity } }
`;

  const schema: StructuredSchema<ContentAnalysisOutput> = {
    description: 'Content analysis results',
    schema: contentThemesSchema as unknown as z.ZodType<ContentAnalysisOutput>,
  };

  return provider.generateStructured<ContentAnalysisOutput>(prompt, schema, {
    temperature: 0.6,
    max_tokens: 800,
  });
}

// ============================================================================
// Trend Detection
// ============================================================================

const trendDetectionSchema = z.object({
  detected_trends: z.array(
    z.object({
      trend_name: z.string(),
      category: z.enum(['product_feature', 'social_cause', 'cultural_moment', 'industry_shift', 'format_trend']),
      status: z.enum(['emerging', 'peak', 'declining', 'sustained']),
      key_messages: z.array(z.string()),
      sentiment_breakdown: z.object({
        positive: z.number(),
        neutral: z.number(),
        negative: z.number(),
      }),
      recommended_use_cases: z.array(z.string()),
    })
  ),
});

type TrendDetectionOutput = z.infer<typeof trendDetectionSchema>;

/**
 * Analyze a collection of competitive posts to detect emerging trends
 */
export async function detectTrends(
  posts: CompetitivePost[],
  timeWindowDays: number = 7
): Promise<TrendDetectionOutput> {
  const provider = getPreferredLLMProvider();

  // Group posts by theme
  const topicSummary = posts
    .slice(0, 10) // Use top 10 most engaging posts
    .map(
      (p) =>
        `${p.source_account_name}: "${p.post_content.substring(0, 100)}" (${p.engagements} engagements)`
    )
    .join('\n');

  const prompt = `
Analyze these high-performing social media posts from the last ${timeWindowDays} days and identify emerging trends.

Top Posts:
${topicSummary}

For each trend you identify:
1. Name the trend or movement
2. Categorize it (product feature, social cause, cultural moment, industry shift, content format)
3. Assess its lifecycle status (emerging, peak, declining, sustained)
4. Extract key messaging that resonates
5. Estimate sentiment distribution (positive %, neutral %, negative %)
6. Suggest how to leverage it (content idea, partnership, thought leadership, etc.)

Return valid JSON:
{
  detected_trends: [
    {
      trend_name: string,
      category: enum,
      status: enum,
      key_messages: [...],
      sentiment_breakdown: { positive, neutral, negative },
      recommended_use_cases: [...]
    }
  ]
}

Identify 3-5 most significant trends.
`;

  const schema: StructuredSchema<TrendDetectionOutput> = {
    description: 'Detected trends in competitive content',
    schema: trendDetectionSchema as unknown as z.ZodType<TrendDetectionOutput>,
  };

  return provider.generateStructured<TrendDetectionOutput>(prompt, schema, {
    temperature: 0.7,
    max_tokens: 2000,
  });
}

// ============================================================================
// Insight Generation
// ============================================================================

const insightGenerationSchema = z.object({
  insights: z.array(
    z.object({
      insight_type: z.enum([
        'competitive_gap',
        'opportunity',
        'benchmark',
        'optimization',
        'audience_insight',
        'format_recommendation',
        'timing_recommendation',
      ]),
      title: z.string(),
      description: z.string(),
      confidence_score: z.number().min(0).max(100),
      recommended_actions: z.array(
        z.object({
          action: z.string(),
          expected_impact: z.string(),
          priority: z.enum(['high', 'medium', 'low']),
        })
      ),
      expected_impact: z.object({
        engagement_increase: z.number().optional(),
        reach_increase: z.number().optional(),
        virality_lift: z.number().optional(),
      }),
    })
  ),
});

type InsightGenerationOutput = z.infer<typeof insightGenerationSchema>;

interface GenerateInsightsInput {
  campaignName: string;
  currentPerformance: {
    impressions: number;
    engagements: number;
    engagementRate: number;
  };
  competitorPosts: CompetitivePost[];
  trends: TrendingContent[];
  messagingPillars: Array<{ name: string; description: string }>;
}

/**
 * Generate strategic insights based on campaign performance vs. competitive landscape
 */
export async function generateInsights(input: GenerateInsightsInput): Promise<InsightGenerationOutput> {
  const provider = getPreferredLLMProvider();

  const topCompetitorPosts = input.competitorPosts
    .slice(0, 5)
    .map((p) => `${p.source_account_name}: ${p.post_content.substring(0, 80)}... (${p.engagements} engagements)`)
    .join('\n');

  const trendSummary = input.trends
    .slice(0, 5)
    .map((t) => `${t.trend_name} (${t.trend_status}): ${t.key_messaging.join('; ')}`)
    .join('\n');

  const prompt = `
Generate strategic insights for campaign optimization based on competitive analysis.

Campaign: "${input.campaignName}"
Current Performance:
- Impressions: ${input.currentPerformance.impressions.toLocaleString()}
- Engagements: ${input.currentPerformance.engagements.toLocaleString()}
- Engagement Rate: ${(input.currentPerformance.engagementRate * 100).toFixed(2)}%

Top Competitor Posts:
${topCompetitorPosts}

Emerging Trends:
${trendSummary}

Campaign Messaging Pillars:
${input.messagingPillars.map((p) => `- ${p.name}: ${p.description}`).join('\n')}

Analyze this data and generate 4-6 strategic insights covering:
- Competitive gaps or opportunities we're missing
- Emerging trends we can capitalize on
- Specific optimizations for our messaging
- Recommended content formats or timing
- Audience behavior insights

For each insight, provide:
1. Type (competitive_gap, opportunity, optimization, audience_insight, format_recommendation, timing_recommendation)
2. Title and detailed description
3. Confidence level (0-100)
4. Specific, actionable recommendations
5. Expected impact (% increases in engagement/reach/virality)

Return valid JSON:
{
  insights: [
    {
      insight_type: string,
      title: string,
      description: string,
      confidence_score: number,
      recommended_actions: [{ action, expected_impact, priority }],
      expected_impact: { engagement_increase?, reach_increase?, virality_lift? }
    }
  ]
}
`;

  const schema: StructuredSchema<InsightGenerationOutput> = {
    description: 'Strategic insights for campaign optimization',
    schema: insightGenerationSchema as unknown as z.ZodType<InsightGenerationOutput>,
  };

  return provider.generateStructured<InsightGenerationOutput>(prompt, schema, {
    temperature: 0.7,
    max_tokens: 2500,
  });
}

// ============================================================================
// Competitive Benchmarking
// ============================================================================

const benchmarkSchema = z.object({
  gaps: z.object({
    engagement_rate: z.number(),
    reach_growth: z.number(),
    strength_areas: z.array(z.string()),
    opportunity_areas: z.array(z.string()),
  }),
  recommendations: z.array(
    z.object({
      area: z.string(),
      current_vs_competitor: z.string(),
      suggested_tactic: z.string(),
      priority: z.enum(['high', 'medium', 'low']),
    })
  ),
});

type BenchmarkOutput = z.infer<typeof benchmarkSchema>;

interface BenchmarkInput {
  ourMetrics: {
    impressions: number;
    engagements: number;
    engagementRate: number;
    followGrowth: number;
  };
  competitorMetrics: {
    avgImpressions: number;
    avgEngagements: number;
    avgEngagementRate: number;
    avgFollowGrowth: number;
  };
  competitorCount: number;
}

/**
 * Generate competitive benchmark analysis and recommendations
 */
export async function generateBenchmarkAnalysis(input: BenchmarkInput): Promise<BenchmarkOutput> {
  const provider = getPreferredLLMProvider();

  const ourEngagementGap = input.ourMetrics.engagementRate - input.competitorMetrics.avgEngagementRate;
  const ourReachGap = input.ourMetrics.impressions - input.competitorMetrics.avgImpressions;

  const prompt = `
Analyze our performance against a cohort of ${input.competitorCount} competitors.

Our Metrics:
- Impressions: ${input.ourMetrics.impressions.toLocaleString()}
- Engagements: ${input.ourMetrics.engagements.toLocaleString()}
- Engagement Rate: ${(input.ourMetrics.engagementRate * 100).toFixed(2)}%
- Follow Growth: ${input.ourMetrics.followGrowth}

Competitor Average:
- Impressions: ${input.competitorMetrics.avgImpressions.toLocaleString()}
- Engagements: ${input.competitorMetrics.avgEngagements.toLocaleString()}
- Engagement Rate: ${(input.competitorMetrics.avgEngagementRate * 100).toFixed(2)}%
- Follow Growth: ${input.competitorMetrics.avgFollowGrowth}

Gaps:
- Engagement Rate Gap: ${(ourEngagementGap * 100).toFixed(2)}%
- Reach Gap: ${ourReachGap.toLocaleString()} impressions

Provide:
1. Gap analysis (what are we doing better/worse?)
2. Strength areas to lean into
3. Opportunity areas to improve
4. Specific tactics to close the gaps

Return valid JSON:
{
  gaps: {
    engagement_rate: number (as decimal, e.g., 0.05 for +5%),
    reach_growth: number,
    strength_areas: [...],
    opportunity_areas: [...]
  },
  recommendations: [
    {
      area: string,
      current_vs_competitor: string,
      suggested_tactic: string,
      priority: enum
    }
  ]
}
`;

  const schema: StructuredSchema<BenchmarkOutput> = {
    description: 'Competitive benchmark analysis',
    schema: benchmarkSchema as unknown as z.ZodType<BenchmarkOutput>,
  };

  return provider.generateStructured<BenchmarkOutput>(prompt, schema, {
    temperature: 0.6,
    max_tokens: 1500,
  });
}
